/*
 * Escrever no CONTEUDO da pagina (nao em anotacao): texto, imagem, assinatura.
 *
 * Imagem e assinatura entram no conteudo: e' o que se espera de uma assinatura,
 * que nao deve sair com um clique em "excluir anotacao".
 *
 * As posicoes chegam no espaco pagina (o que o leitor ve). A matriz de desenho
 * e' montada nesse espaco e levada ao espaco PDF por
 * `matrizPaginaParaConteudo` -- assim texto e imagem saem de pe' para o leitor
 * em pagina girada sem nenhum caso especial por rotacao.
 *
 * Texto usa as fontes Base-14 (Helvetica, Times, Courier) com
 * WinAnsiEncoding, sem embutir: todo leitor de PDF as tem. So' os caracteres
 * do WinAnsi (Latin-1 + aspas tipograficas, travessao, euro...) sao
 * representaveis; o resto vira "?".
 */

import * as mupdf from "mupdf";
import {
  matrizPaginaParaConteudo, normalizar, type Matriz, type Ponto, type Retangulo,
} from "./coordenadas.ts";
import { fmt, geometria, type Sessao } from "./documento.ts";
import type { Cor } from "./anotacoes.ts";

export type Familia = "helv" | "times" | "courier";

const BASE14: Record<Familia, [string, string, string, string]> = {
  helv: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};

export function nomeBase14(familia: Familia, negrito = false, italico = false): string {
  return BASE14[familia][(negrito ? 1 : 0) + (italico ? 2 : 0)];
}

const WINANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Unicode -> bytes WinAnsi (o que nao existe vira "?"). */
export function codificarWinAnsi(texto: string): number[] {
  const saida: number[] = [];
  for (const ch of texto) {
    const u = ch.codePointAt(0)!;
    if (u === 0x09) saida.push(0x20);
    else if ((u >= 0x20 && u < 0x7f) || (u >= 0xa0 && u <= 0xff)) saida.push(u);
    else if (WINANSI_EXTRA[u] !== undefined) saida.push(WINANSI_EXTRA[u]);
    else saida.push(0x3f);
  }
  return saida;
}

function hex(bytes: number[]): string {
  return "<" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
}

const fontesMedida = new Map<string, mupdf.Font>();

/** Largura do texto em pontos, com as metricas da fonte Base-14. */
export function larguraTexto(texto: string, fonte: string, tamanho: number): number {
  let f = fontesMedida.get(fonte);
  if (!f) {
    f = new mupdf.Font(fonte);
    fontesMedida.set(fonte, f);
  }
  let w = 0;
  for (const ch of texto) w += f.advanceGlyph(f.encodeCharacter(ch.codePointAt(0)!));
  return w * tamanho;
}

function matrizPdf(m: Matriz): string {
  return m.map(fmt).join(" ");
}

function corRg(c: Cor): string {
  return c.map((v) => fmt(Math.max(0, Math.min(1, v)))).join(" ");
}

/** Monta recursos novos para a pagina sem mexer nos antigos (que podem ser
 *  compartilhados com outras paginas) e acrescenta um trecho de conteudo. */
export class Acrescimo {
  private doc: mupdf.PDFDocument;
  private pagina: mupdf.PDFPage;
  private novos: Record<string, [string, mupdf.PDFObject][]> = {};
  private existentes: mupdf.PDFObject;
  private contador = 0;

  constructor(doc: mupdf.PDFDocument, pagina: mupdf.PDFPage) {
    this.doc = doc;
    this.pagina = pagina;
    this.existentes = pagina.getObject().getInheritable("Resources");
  }

  /** Registra um recurso e devolve o nome pelo qual o conteudo o chama. */
  recurso(categoria: "Font" | "XObject" | "ExtGState", obj: mupdf.PDFObject): string {
    const antigos = this.existentes.isDictionary() ? this.existentes.get(categoria) : mupdf.PDFObject.Null;
    const lista = (this.novos[categoria] ??= []);
    let nome: string;
    do {
      nome = `EPF${categoria[0]}${++this.contador}`;
    } while ((antigos.isDictionary() && !antigos.get(nome).isNull()) || lista.some(([n]) => n === nome));
    lista.push([nome, obj]);
    return nome;
  }

  private fontes = new Map<string, string>();

  fonteBase14(nome: string): string {
    let r = this.fontes.get(nome);
    if (!r) {
      r = this.recurso("Font", this.doc.addObject({
        Type: "Font", Subtype: "Type1", BaseFont: nome, Encoding: "WinAnsiEncoding",
      }));
      this.fontes.set(nome, r);
    }
    return r;
  }

  opacidade(valor: number): string {
    const v = Math.max(0, Math.min(1, valor));
    return this.recurso("ExtGState", this.doc.addObject({ Type: "ExtGState", ca: v, CA: v }));
  }

  gravar(conteudo: string): void {
    const doc = this.doc;
    const pobj = this.pagina.getObject();
    const res = doc.newDictionary();
    if (this.existentes.isDictionary()) {
      this.existentes.forEach((v, k) => res.put(k, v));
    }
    for (const [cat, itens] of Object.entries(this.novos)) {
      const sub = doc.newDictionary();
      const antigo = this.existentes.isDictionary() ? this.existentes.get(cat) : mupdf.PDFObject.Null;
      if (antigo.isDictionary()) antigo.forEach((v, k) => sub.put(k, v));
      for (const [nome, obj] of itens) sub.put(nome, obj);
      res.put(cat, sub);
    }
    pobj.put("Resources", res);
    // O conteudo antigo vai entre q/Q: se ele deixar a matriz alterada no
    // fim (acontece), o nosso trecho continuaria no lugar certo.
    const antigo = pobj.get("Contents");
    const lista = doc.newArray();
    if (antigo.isArray() || antigo.isStream()) {
      lista.push(doc.addStream("q\n", {}));
      if (antigo.isArray()) {
        for (let i = 0; i < antigo.length; i++) lista.push(antigo.get(i));
      } else {
        lista.push(pobj.get("Contents"));
      }
      lista.push(doc.addStream("\nQ\n", {}));
    }
    lista.push(doc.addStream("q\n" + conteudo + "\nQ\n", {}));
    pobj.put("Contents", lista);
  }
}

export interface OpcoesTexto {
  tamanho?: number;
  cor?: Cor;
  fonte?: string;
  opacidade?: number;
}

/** Operadores de UMA linha de texto com a linha de base em `origem` (espaco
 *  pagina), girada de `angulo` graus no sentido anti-horario visto pelo
 *  leitor (positivo sobe para a direita). */
function operadoresLinha(ac: Acrescimo, p: mupdf.PDFPage, origem: Ponto, texto: string,
  op: Required<OpcoesTexto>, angulo = 0, gs?: string): string {
  const g = geometria(p);
  const rad = angulo * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
  // Glifo tem y para cima; o espaco pagina, para baixo.
  const tm = matrizPaginaParaConteudo(g, [c, -sn, -sn, -c, origem[0], origem[1]]);
  const nomeFonte = ac.fonteBase14(op.fonte);
  return [gs ? `/${gs} gs` : "", "BT", `/${nomeFonte} ${fmt(op.tamanho)} Tf`, `${corRg(op.cor)} rg`,
    `${matrizPdf(tm)} Tm`, `${hex(codificarWinAnsi(texto))} Tj`, "ET"].filter(Boolean).join("\n");
}

function completar(op: OpcoesTexto): Required<OpcoesTexto> {
  return { tamanho: op.tamanho ?? 12, cor: op.cor ?? [0, 0, 0], fonte: op.fonte ?? "Helvetica",
    opacidade: op.opacidade ?? 1 };
}

/** Escreve texto (pode ter varias linhas) sem abrir operacao -- para compor. */
export function escreverTexto(s: Sessao, p: mupdf.PDFPage, origem: Ponto, texto: string,
  opcoes: OpcoesTexto = {}, angulo = 0): void {
  const op = completar(opcoes);
  const ac = new Acrescimo(s.doc, p);
  const gs = op.opacidade < 1 ? ac.opacidade(op.opacidade) : undefined;
  const rad = angulo * Math.PI / 180;
  const partes = texto.split(/\r?\n/).map((linha, i) => {
    // Linha seguinte: desce ao longo do "para baixo" do texto.
    const d = i * op.tamanho * 1.2;
    const o: Ponto = [origem[0] + d * Math.sin(rad), origem[1] + d * Math.cos(rad)];
    return operadoresLinha(ac, p, o, linha, op, angulo, i === 0 ? gs : undefined);
  });
  ac.gravar(partes.join("\n"));
}

/** Texto novo no conteudo da pagina, linha de base em `origem` (espaco pagina). */
export function inserirTexto(s: Sessao, pagina: number, origem: Ponto, texto: string,
  opcoes: OpcoesTexto = {}): void {
  if (!texto.trim()) throw new Error("Digite o texto.");
  s.operacao("Adicionar texto", () => {
    escreverTexto(s, s.pagina(pagina), origem, texto, opcoes);
  });
}

/** Imagem no conteudo da pagina, mantendo a proporcao e centrada em `rect`
 *  (espaco pagina). Sai de pe' para o leitor mesmo em pagina girada. */
export function inserirImagem(s: Sessao, pagina: number, rect: Retangulo, bytes: Uint8Array,
  descricao = "Inserir imagem"): void {
  let img: mupdf.Image;
  try {
    img = new mupdf.Image(bytes);
  } catch {
    throw new Error("Não foi possível ler a imagem.");
  }
  const r = normalizar(rect);
  const larg = r[2] - r[0], alt = r[3] - r[1];
  if (larg < 1 || alt < 1) throw new Error("Área pequena demais para a imagem.");
  const escala = Math.min(larg / img.getWidth(), alt / img.getHeight());
  const w = img.getWidth() * escala, h = img.getHeight() * escala;
  const x0 = r[0] + (larg - w) / 2, y0 = r[1] + (alt - h) / 2;
  s.operacao(descricao, () => {
    const p = s.pagina(pagina);
    const ac = new Acrescimo(s.doc, p);
    const nome = ac.recurso("XObject", s.doc.addImage(img));
    // Quadrado unitario da imagem (y para cima) -> retangulo no espaco pagina.
    const cm = matrizPaginaParaConteudo(geometria(p), [w, 0, 0, -h, x0, y0 + h]);
    ac.gravar(`${matrizPdf(cm)} cm\n/${nome} Do`);
  });
}
