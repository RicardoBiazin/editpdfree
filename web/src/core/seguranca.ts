/*
 * Tarja (redacao de verdade) e busca.
 *
 * TARJA NAO E' RETANGULO PRETO. Um retangulo por cima deixa o texto no
 * arquivo: qualquer um seleciona, copia e cola -- e' o vazamento classico de
 * documento "tarjado". Aqui a area passa por `applyRedactions`, que REMOVE os
 * glifos do conteudo e apaga os pixels das imagens sob ela. Os testes conferem
 * que o texto sumiu da extracao, nao so' que a pagina ficou preta.
 */

import * as mupdf from "mupdf";
import { normalizar, retanguloDoQuad, type Quad, type Retangulo } from "./coordenadas.ts";
import type { Sessao } from "./documento.ts";

export interface Area { pagina: number; rect: Retangulo }

function agrupar(areas: Area[]): Map<number, Retangulo[]> {
  const porPagina = new Map<number, Retangulo[]>();
  for (const a of areas) {
    const r = normalizar(a.rect);
    if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) continue;
    const lista = porPagina.get(a.pagina) ?? [];
    lista.push(r);
    porPagina.set(a.pagina, lista);
  }
  return porPagina;
}

/** Aplica as tarjas sem abrir operacao (para compor). */
function aplicar(s: Sessao, porPagina: Map<number, Retangulo[]>): void {
  for (const [pagina, rects] of porPagina) {
    const p = s.pagina(pagina);
    for (const r of rects) {
      const a = p.createAnnotation("Redact");
      a.setRect(r);
      a.update();
    }
    p.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
  }
}

/** Remove definitivamente o conteudo das areas (espaco pagina). */
export function tarjar(s: Sessao, areas: Area[]): number {
  const porPagina = agrupar(areas);
  if (!porPagina.size) return 0;
  s.operacao("Tarjar", () => aplicar(s, porPagina));
  let n = 0;
  for (const r of porPagina.values()) n += r.length;
  return n;
}

export interface Resultado { pagina: number; quads: Quad[]; rect: Retangulo }

/** Todas as ocorrencias de `termo`, em ordem. A busca do MuPDF.js diferencia
 *  maiusculas por padrao; aqui nao diferencia (e, com `semAcento`, "acao"
 *  acha "ação"). */
export function buscar(doc: mupdf.PDFDocument, termo: string, semAcento = false): Resultado[] {
  const t = termo.trim();
  if (!t) return [];
  const saida: Resultado[] = [];
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const p = doc.loadPage(i);
    // O MuPDF.js devolve no maximo 500 quads por pagina.
    const achados = p.search(t, semAcento ? "ignore-case,ignore-diacritics" : "ignore-case") as unknown as Quad[][];
    for (const quads of achados) {
      if (!quads.length) continue;
      let r = retanguloDoQuad(quads[0]);
      for (const q of quads.slice(1)) {
        const b = retanguloDoQuad(q);
        r = [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])];
      }
      saida.push({ pagina: i, quads, rect: r });
    }
    p.destroy();
  }
  return saida;
}

/** Tarja toda ocorrencia de `termo` no documento (ex.: um CPF). Devolve
 *  quantas. Repete a busca porque o MuPDF.js devolve no maximo 500 quads por
 *  pagina de cada vez. */
export function tarjarTexto(s: Sessao, termo: string): number {
  if (!buscar(s.doc, termo).length) return 0;
  return s.operacao("Tarjar texto", () => {
    let total = 0;
    for (let rodada = 0; rodada < 50; rodada++) {
      const achados = buscar(s.doc, termo);
      if (!achados.length) break;
      total += achados.length;
      const areas: Area[] = [];
      for (const r of achados) {
        for (const q of r.quads) areas.push({ pagina: r.pagina, rect: retanguloDoQuad(q) });
      }
      aplicar(s, agrupar(areas));
    }
    return total;
  });
}

/** Texto extraido de todas as paginas (usado pelos testes e por "Extrair texto"). */
export function extrairTexto(doc: mupdf.PDFDocument): string {
  const partes: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i);
    const st = p.toStructuredText("preserve-whitespace");
    partes.push(`--- Página ${i + 1} ---\n` + st.asText());
    st.destroy();
    p.destroy();
  }
  return partes.join("\n");
}
