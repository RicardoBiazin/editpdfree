/*
 * Anotacoes: caixa de texto, nota, destaque/sublinhado/tachado, caneta,
 * formas, e selecionar/mover/excluir.
 *
 * Toda coordenada que entra aqui ja' esta' no ESPACO PAGINA (o que o leitor ve,
 * ja' girado) -- e' o espaco da API de anotacoes do MuPDF.js. A conversao da
 * tela e' trabalho de `coordenadas.ts`, e so' dele.
 *
 * Armadilha do MuPDF.js: `getRect()` LEVANTA excecao em anotacao sem /Rect
 * proprio (Ink, Line, Polygon...). Para saber onde a anotacao esta', use
 * `getBounds()`.
 */

import * as mupdf from "mupdf";
import {
  deslocamentoPaginaParaPdf, intersecta, normalizar, quadDoRetangulo, uniao,
  type Ponto, type Quad, type Retangulo,
} from "./coordenadas.ts";
import { geometria, rotacaoDaPagina, type Sessao } from "./documento.ts";

export type Cor = [number, number, number];

export interface Estilo {
  cor: Cor;
  espessura: number;
  opacidade: number;
  tamanhoFonte: number;
}

export const ESTILO_PADRAO: Estilo = { cor: [0.85, 0.1, 0.1], espessura: 2, opacidade: 1, tamanhoFonte: 12 };

const NOMES_TIPO: Record<string, string> = {
  Text: "Nota", FreeText: "Caixa de texto", Highlight: "Destaque", Underline: "Sublinhado",
  StrikeOut: "Tachado", Squiggly: "Ondulado", Ink: "Desenho", Square: "Retângulo",
  Circle: "Elipse", Line: "Linha", Polygon: "Polígono", PolyLine: "Linha poligonal",
  Stamp: "Carimbo", Link: "Link", Redact: "Tarja pendente", FileAttachment: "Anexo",
  Caret: "Circunflexo",
};

export interface InfoAnotacao {
  id: number;
  tipo: string;
  nome: string;
  limites: Retangulo;
  movel: boolean;
  texto: string;
}

function limitarOpacidade(v: number): number {
  return Math.max(0.05, Math.min(1, v));
}

/** A anotacao guarda so' uma referencia a pagina: manter `p` numa variavel
 *  enquanto se usa a anotacao (vale para o PyMuPDF e, por prudencia, aqui). */
export function acharAnotacao(p: mupdf.PDFPage, id: number): mupdf.PDFAnnotation {
  for (const a of p.getAnnotations()) {
    if (a.getObject().asIndirect() === id) return a;
  }
  throw new Error("Anotação não encontrada.");
}

const MARCACOES = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);

export function listarAnotacoes(p: mupdf.PDFPage): InfoAnotacao[] {
  const lista: InfoAnotacao[] = [];
  for (const a of p.getAnnotations()) {
    const tipo = a.getType();
    if (tipo === "Popup" || tipo === "Link") continue;
    lista.push({
      id: a.getObject().asIndirect(), tipo, nome: NOMES_TIPO[tipo] ?? tipo,
      limites: a.getBounds() as Retangulo,
      movel: !MARCACOES.has(tipo),
      texto: a.getContents() ?? "",
    });
  }
  return lista;
}

export function textoLivre(s: Sessao, pagina: number, rect: Retangulo, texto: string, estilo: Estilo): number {
  if (!texto.trim()) throw new Error("Digite o texto.");
  return s.operacao("Inserir caixa de texto", () => {
    const p = s.pagina(pagina);
    let r = normalizar(rect);
    // Caixa pequena demais corta o texto sem aviso: garante as linhas na fonte
    // escolhida e uma largura minima razoavel.
    const linhas = texto.split("\n");
    const minAltura = estilo.tamanhoFonte * 1.35 * linhas.length + 4;
    const maior = Math.max(...linhas.map((l) => l.length));
    const minLargura = Math.max(40, maior * estilo.tamanhoFonte * 0.56 + 8);
    if (r[3] - r[1] < minAltura) r = [r[0], r[1], r[2], r[1] + minAltura];
    if (r[2] - r[0] < minLargura) r = [r[0], r[1], r[0] + minLargura, r[3]];
    const a = p.createAnnotation("FreeText");
    a.setRect(r);
    a.setContents(texto);
    a.setDefaultAppearance("Helv", estilo.tamanhoFonte, estilo.cor);
    a.setBorderWidth(0);
    a.setOpacity(limitarOpacidade(estilo.opacidade));
    // Em pagina girada o texto precisa sair de pe' para o leitor: /Rotate da
    // anotacao igual ao da pagina (conferido renderizando a 90 graus).
    const rot = rotacaoDaPagina(p);
    if (rot) a.getObject().put("Rotate", rot);
    a.update();
    return a.getObject().asIndirect();
  });
}

export function nota(s: Sessao, pagina: number, ponto: Ponto, texto: string, estilo: Estilo): number {
  return s.operacao("Inserir nota", () => {
    const p = s.pagina(pagina);
    const a = p.createAnnotation("Text");
    a.setRect([ponto[0], ponto[1], ponto[0] + 20, ponto[1] + 20]);
    a.setContents(texto);
    a.setIcon("Note");
    a.setColor(estilo.cor);
    a.update();
    return a.getObject().asIndirect();
  });
}

interface Linha { rect: Retangulo; palavras: Retangulo[] }

/** Linhas de texto com as caixas de cada palavra, no espaco pagina. */
export function linhasComPalavras(p: mupdf.PDFPage): Linha[] {
  const st = p.toStructuredText("preserve-whitespace");
  const linhas: Linha[] = [];
  let atual: Linha | null = null;
  let palavra: Retangulo | null = null;
  const fecharPalavra = () => {
    if (atual && palavra) atual.palavras.push(palavra);
    palavra = null;
  };
  try {
    st.walk({
      beginLine(bbox) {
        atual = { rect: bbox as Retangulo, palavras: [] };
      },
      onChar(c, _origem, _fonte, _tam, quad) {
        if (!atual) return;
        if (/\s/.test(c)) {
          fecharPalavra();
          return;
        }
        const q = quad as Quad;
        const r: Retangulo = [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]),
          Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
        palavra = palavra ? uniao(palavra, r) : r;
      },
      endLine() {
        fecharPalavra();
        if (atual && atual.palavras.length) linhas.push(atual);
        atual = null;
      },
    });
  } finally {
    st.destroy();
  }
  return linhas;
}

/** Quadrilateros das palavras tocadas pelo retangulo: UM por linha (uniao das
 *  palavras tocadas), nao um por palavra -- por palavra o destaque sai em
 *  gomos com buracos entre elas. */
export function quadsDasPalavras(p: mupdf.PDFPage, rect: Retangulo): Quad[] {
  const alvo = normalizar(rect);
  const quads: Quad[] = [];
  for (const l of linhasComPalavras(p)) {
    let caixa: Retangulo | null = null;
    for (const w of l.palavras) {
      if (intersecta(w, alvo)) caixa = caixa ? uniao(caixa, w) : w;
    }
    if (caixa) quads.push(quadDoRetangulo(caixa));
  }
  return quads;
}

const TIPOS_MARCACAO = {
  destacar: ["Highlight", "Destacar texto"],
  sublinhar: ["Underline", "Sublinhar texto"],
  tachar: ["StrikeOut", "Tachar texto"],
} as const;

export type TipoMarcacao = keyof typeof TIPOS_MARCACAO;

/** Destaque/sublinhado/tachado nas palavras dentro de `rect`. Devolve false
 *  (sem alterar nada) se nao havia texto ali. */
export function marcarTexto(s: Sessao, pagina: number, rect: Retangulo, tipo: TipoMarcacao,
  estilo: Estilo): boolean {
  const [subtipo, descricao] = TIPOS_MARCACAO[tipo];
  const quads = quadsDasPalavras(s.pagina(pagina), rect);
  if (!quads.length) return false;
  s.operacao(descricao, () => {
    const p = s.pagina(pagina);
    const a = p.createAnnotation(subtipo);
    a.setQuadPoints(quads);
    a.setColor(estilo.cor);
    a.setOpacity(limitarOpacidade(tipo === "destacar" ? Math.min(estilo.opacidade, 1) : estilo.opacidade));
    a.update();
  });
  return true;
}

export function caneta(s: Sessao, pagina: number, tracos: Ponto[][], estilo: Estilo): number | null {
  const validos = tracos.filter((t) => t.length > 1);
  if (!validos.length) return null;
  return s.operacao("Desenho à mão livre", () => {
    const p = s.pagina(pagina);
    const a = p.createAnnotation("Ink");
    a.setInkList(validos);
    a.setColor(estilo.cor);
    a.setBorderWidth(estilo.espessura);
    a.setOpacity(limitarOpacidade(estilo.opacidade));
    a.update();
    return a.getObject().asIndirect();
  });
}

export type TipoForma = "retangulo" | "elipse" | "linha" | "seta";

const NOMES_FORMA: Record<TipoForma, string> = {
  retangulo: "Retângulo", elipse: "Elipse", linha: "Linha", seta: "Seta",
};

export function forma(s: Sessao, pagina: number, tipo: TipoForma, inicio: Ponto, fim: Ponto,
  estilo: Estilo): number {
  if (Math.hypot(fim[0] - inicio[0], fim[1] - inicio[1]) < 2) {
    throw new Error("Arraste para desenhar a forma.");
  }
  return s.operacao(NOMES_FORMA[tipo], () => {
    const p = s.pagina(pagina);
    let a: mupdf.PDFAnnotation;
    if (tipo === "retangulo" || tipo === "elipse") {
      a = p.createAnnotation(tipo === "retangulo" ? "Square" : "Circle");
      a.setRect(normalizar([inicio[0], inicio[1], fim[0], fim[1]]));
    } else {
      a = p.createAnnotation("Line");
      a.setLine(inicio, fim);
      if (tipo === "seta") {
        a.setLineEndingStyles("None", "ClosedArrow");
        a.setInteriorColor(estilo.cor);
      }
    }
    a.setColor(estilo.cor);
    a.setBorderWidth(estilo.espessura);
    a.setOpacity(limitarOpacidade(estilo.opacidade));
    a.update();
    return a.getObject().asIndirect();
  });
}

/** A anotacao sob o ponto -- a de cima, se houver varias. */
export function anotacaoEm(p: mupdf.PDFPage, ponto: Ponto, folga = 3): InfoAnotacao | null {
  let achada: InfoAnotacao | null = null;
  for (const a of listarAnotacoes(p)) {
    const r = a.limites;
    if (ponto[0] >= r[0] - folga && ponto[0] <= r[2] + folga
      && ponto[1] >= r[1] - folga && ponto[1] <= r[3] + folga) achada = a;
  }
  return achada;
}

export function excluirAnotacao(s: Sessao, pagina: number, id: number): void {
  s.operacao("Excluir anotação", () => {
    const p = s.pagina(pagina);
    const a = acharAnotacao(p, id);
    p.deleteAnnotation(a);
  });
}

/**
 * Desloca a anotacao em (dx, dy) pontos no espaco pagina.
 *
 * Mexe direto nas chaves do objeto (/Rect e a geometria: /L, /Vertices,
 * /InkList, /CL) e NAO regenera a aparencia: a aparencia e' mapeada sobre o
 * /Rect, entao ela se move intacta -- inclusive a de anotacoes criadas por
 * outros programas, que uma regeneracao redesenharia do jeito do MuPDF.
 * O arquivo guarda o espaco PDF (sem rotacao, y para cima): o deslocamento
 * passa por `deslocamentoPaginaParaPdf`.
 */
export function moverAnotacao(s: Sessao, pagina: number, id: number, dx: number, dy: number): void {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  const p0 = s.pagina(pagina);
  const tipo = acharAnotacao(p0, id).getType();
  if (MARCACOES.has(tipo)) throw new Error("Marcações de texto ficam presas ao texto.");
  s.operacao("Mover anotação", () => {
    const p = s.pagina(pagina);
    const a = acharAnotacao(p, id);
    const [px, py] = deslocamentoPaginaParaPdf(geometria(p), dx, dy);
    const obj = a.getObject();
    for (const chave of ["Rect", "L", "Vertices", "CL", "InkList"]) {
      const v = obj.get(chave);
      if (v.isArray()) obj.put(chave, deslocarArray(s.doc, v, px, py));
    }
    // A nota leva junto o popup dela.
    const popup = obj.get("Popup");
    if (popup.isDictionary() && popup.get("Rect").isArray()) {
      popup.put("Rect", deslocarArray(s.doc, popup.get("Rect"), px, py));
    }
  });
}

/** Soma (dx, dy) aos pares x y de um array PDF, inclusive aninhado (/InkList). */
function deslocarArray(doc: mupdf.PDFDocument, arr: mupdf.PDFObject, dx: number, dy: number): mupdf.PDFObject {
  const novo = doc.newArray();
  let numeros = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr.get(i);
    if (v.isArray()) {
      novo.push(deslocarArray(doc, v, dx, dy));
    } else if (v.isNumber()) {
      novo.push(v.asNumber() + (numeros % 2 === 0 ? dx : dy));
      numeros++;
    } else {
      novo.push(v);
    }
  }
  return novo;
}
