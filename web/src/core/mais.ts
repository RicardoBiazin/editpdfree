/*
 * Extras do desktop 0.2: substituir texto em todo o documento, propriedades
 * (metadados), carimbos, marcadores e links.
 */

import * as mupdf from "mupdf";
import { normalizar, type Ponto, type Retangulo } from "./coordenadas.ts";
import { fmt, rotacaoDaPagina, type Sessao } from "./documento.ts";
import { codificarWinAnsi, escreverTexto, larguraTexto, nomeBase14 } from "./conteudo.ts";
import { buscar } from "./seguranca.ts";
import { trechoEm, type Trecho } from "./texto.ts";
import type { Cor } from "./anotacoes.ts";
import { CAMPOS_METADADOS } from "./formatos.ts";

export { CAMPOS_METADADOS, CARIMBOS } from "./formatos.ts";

// ------------------------------------------------------------ substituir

/** Troca TODAS as ocorrencias de `procurado` (diferenciando maiusculas, como
 *  o desktop). Cada ocorrencia e' redigida (so' o texto) e reescrita no mesmo
 *  ponto, na fonte Base-14 mais parecida e no tamanho/cor do trecho. Um so'
 *  desfazer. Devolve quantas. */
export function substituirEmTudo(s: Sessao, procurado: string, novo: string): number {
  if (!procurado) return 0;
  const alvos: { pagina: number; rect: Retangulo; t: Trecho }[] = [];
  for (let i = 0; i < s.paginas; i++) {
    const p = s.pagina(i);
    for (const q of p.search(procurado, "") as unknown as number[][][]) {
      const xs = q.flatMap((qq) => [qq[0], qq[2], qq[4], qq[6]]), ys = q.flatMap((qq) => [qq[1], qq[3], qq[5], qq[7]]);
      const r: Retangulo = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const t = trechoEm(p, i, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]);
      if (t && t.horizontal) alvos.push({ pagina: i, rect: r, t });
    }
  }
  if (!alvos.length) return 0;
  s.operacao("Substituir texto", () => {
    const paginas = [...new Set(alvos.map((a) => a.pagina))];
    for (const i of paginas) {
      const lista = alvos.filter((a) => a.pagina === i);
      const p = s.pagina(i);
      for (const { rect } of lista) {
        const folga = (rect[3] - rect[1]) * 0.2;
        const a = p.createAnnotation("Redact");
        a.setRect([rect[0], rect[1] + folga, rect[2], rect[3] - folga]);
        a.update();
      }
      p.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE,
        mupdf.PDFPage.REDACT_TEXT_REMOVE);
      for (const { rect, t } of lista) {
        if (!novo) continue;
        escreverTexto(s, s.pagina(i), [rect[0], t.origem[1]], novo,
          { tamanho: t.tamanho, cor: t.cor, fonte: nomeBase14(t.familia, t.negrito, t.italico) });
      }
    }
  });
  return alvos.length;
}

/** Quantas ocorrencias ha' (para a interface avisar antes). */
export function contarOcorrencias(s: Sessao, termo: string): number {
  return termo ? buscar(s.doc, termo).length : 0;
}

// ------------------------------------------------------------ metadados

export type Metadados = Record<keyof typeof CAMPOS_METADADOS, string>;

export function metadados(doc: mupdf.PDFDocument): Metadados {
  const m = {} as Metadados;
  for (const [k, [chave]] of Object.entries(CAMPOS_METADADOS)) {
    m[k as keyof Metadados] = doc.getMetaData(chave) ?? "";
  }
  return m;
}

export function definirMetadados(s: Sessao, valores: Partial<Metadados>): boolean {
  const atual = metadados(s.doc);
  const mudou = Object.entries(valores).filter(([k, v]) => k in CAMPOS_METADADOS && v !== undefined && v !== atual[k as keyof Metadados]);
  if (!mudou.length) return false;
  s.operacao("Propriedades do documento", () => {
    for (const [k, v] of mudou) s.doc.setMetaData(CAMPOS_METADADOS[k as keyof Metadados][0], String(v));
  });
  return true;
}

// ------------------------------------------------------------ carimbos

/**
 * Carimbo: anotacao /Stamp com aparencia propria (moldura + texto em
 * Helvetica-Bold), que continua movel e excluivel. A aparencia e' desenhada
 * no espaco "visual" (largura x altura como o leitor ve) e a matriz do
 * formulario gira junto com a pagina, para o carimbo sair de pe'.
 */
export function carimbo(s: Sessao, pagina: number, centro: Ponto, texto: string, cor: Cor = [0.78, 0.1, 0.1],
  tamanho = 24): number {
  const t = texto.trim().toUpperCase();
  if (!t) throw new Error("Escolha o texto do carimbo.");
  const larguraTxt = larguraTexto(t, "Helvetica-Bold", tamanho);
  const w = larguraTxt + tamanho * 1.2, h = tamanho * 1.9;
  return s.operacao("Carimbo", () => {
    const p = s.pagina(pagina);
    const rot = rotacaoDaPagina(p);
    const rect: Retangulo = normalizar([centro[0] - w / 2, centro[1] - h / 2, centro[0] + w / 2, centro[1] + h / 2]);
    const a = p.createAnnotation("Stamp");
    a.setRect(rect);
    const fonte = s.doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica-Bold", Encoding: "WinAnsiEncoding" });
    const rgb = cor.map((v) => fmt(v)).join(" ");
    const hexTxt = "<" + codificarWinAnsi(t).map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
    const e = Math.max(1.5, tamanho / 10);
    const conteudo = `q ${rgb} RG ${fmt(e)} w ${fmt(e)} ${fmt(e)} ${fmt(w - 2 * e)} ${fmt(h - 2 * e)} re S `
      + `BT ${rgb} rg /F ${fmt(tamanho)} Tf ${fmt((w - larguraTxt) / 2)} ${fmt(h * 0.32)} Td ${hexTxt} Tj ET Q`;
    // A pagina girada de `rot` graus (horario) mostra o espaco do arquivo
    // girado; o formulario gira o mesmo tanto no sentido contrario.
    const m = mupdf.Matrix.rotate(rot);
    // setContents ANTES da aparencia, e sem update() depois: qualquer mudanca
    // posterior marca a anotacao como "suja" e o MuPDF redesenha o carimbo
    // padrao dele ("DRAFT"), por cima do nosso (conferido).
    a.setContents(t);
    a.setAppearance(null, null, m, [0, 0, w, h], { Font: { F: fonte } }, conteudo);
    return a.getObject().asIndirect();
  });
}

// ------------------------------------------------------------ marcadores e links

export interface Marcador { titulo: string; nivel: number; pagina: number | null }

export function marcadores(doc: mupdf.PDFDocument): Marcador[] {
  const saida: Marcador[] = [];
  const andar = (itens: { title?: string; page?: number; down?: unknown[] }[] | null, nivel: number) => {
    for (const it of itens ?? []) {
      saida.push({ titulo: (it.title ?? "").trim() || "(sem título)", nivel,
        pagina: typeof it.page === "number" && it.page >= 0 ? it.page : null });
      if (Array.isArray(it.down)) andar(it.down as typeof itens, nivel + 1);
    }
  };
  try {
    andar(doc.loadOutline() as never, 0);
  } catch {
    // indice quebrado: sem marcadores
  }
  return saida;
}

export interface LinkPagina { rect: Retangulo; uri: string; externo: boolean; destino: number | null }

export function linksDaPagina(doc: mupdf.PDFDocument, p: mupdf.PDFPage): LinkPagina[] {
  const saida: LinkPagina[] = [];
  for (const l of p.getLinks()) {
    try {
      const externo = l.isExternal();
      let destino: number | null = null;
      if (!externo) {
        const d = doc.resolveLink(l);
        destino = d >= 0 ? d : null;
      }
      const uri = l.getURI() ?? "";
      // So' links web e e-mail saem da pagina; javascript:, file: etc. nunca.
      if (externo && !/^(https?:|mailto:)/i.test(uri)) continue;
      saida.push({ rect: l.getBounds() as Retangulo, uri, externo, destino });
    } catch {
      // link quebrado: ignora
    }
  }
  return saida;
}
