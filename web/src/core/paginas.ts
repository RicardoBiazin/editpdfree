/*
 * Operacoes sobre paginas: girar, excluir, mover, duplicar, inserir, extrair,
 * juntar e dividir.
 *
 * Indices sao sempre BASE 0 aqui dentro. So' o que o usuario digita (os
 * intervalos "1-3, 5") e' base 1, e a conversao acontece em `lerIntervalos`.
 *
 * Duas armadilhas do MuPDF.js conferidas por experimento:
 *  - `rearrangePages([0, 1, 1, 2])` aceita repeticao, mas as duas "copias" sao
 *    o MESMO objeto de pagina: mexer numa mexe na outra. Duplicar nao pode
 *    usar isso.
 *  - `graftPage` copia conteudo, recursos, caixas e rotacao, mas NAO as
 *    anotacoes. `enxertarPagina` copia tambem as anotacoes.
 */

import * as mupdf from "mupdf";
import { abrirComoPdf, bytesDoBuffer, rotacaoDaPagina, type Sessao } from "./documento.ts";
import { nomeBase } from "./intervalos.ts";

export { gruposACada, lerIntervalos, nomeBase, ordemAoMover } from "./intervalos.ts";

export function girar(s: Sessao, indices: number[], graus: number): void {
  const lista = [...new Set(indices)].sort((a, b) => a - b);
  if (!lista.length) return;
  s.operacao(lista.length === 1 ? "Girar página" : "Girar páginas", () => {
    for (const i of lista) {
      const p = s.pagina(i);
      const nova = (((rotacaoDaPagina(p) + graus) % 360) + 360) % 360;
      p.getObject().put("Rotate", nova);
    }
  });
}

export function excluir(s: Sessao, indices: number[]): void {
  const remover = new Set(indices);
  if (!remover.size) return;
  if (remover.size >= s.paginas) throw new Error("Um PDF precisa de pelo menos uma página.");
  const manter = [...Array(s.paginas).keys()].filter((i) => !remover.has(i));
  s.operacao(remover.size === 1 ? "Excluir página" : "Excluir páginas", () => {
    s.doc.rearrangePages(manter);
  });
}

/** Aplica uma permutacao inteira de uma vez (um so' desfazer). */
export function reordenar(s: Sessao, ordem: number[]): void {
  const n = s.paginas;
  if (ordem.length !== n || [...ordem].sort((a, b) => a - b).some((v, i) => v !== i)) {
    throw new Error("A nova ordem precisa conter cada página uma vez.");
  }
  if (ordem.every((v, i) => v === i)) return;
  s.operacao("Reordenar páginas", () => s.doc.rearrangePages(ordem));
}

/**
 * Copia a pagina `origem` de `fonte` para `destino` na posicao `em` (-1 = fim),
 * COM as anotacoes (graftPage sozinho as perde).
 *
 * Ficam de fora: campos de formulario (dependem do /AcroForm do documento de
 * origem), popups (sao recriados pelo leitor) e links internos (apontariam para
 * paginas do outro documento e arrastariam a arvore de paginas inteira junto).
 */
export function enxertarPagina(destino: mupdf.PDFDocument, mapa: mupdf.PDFGraftMap,
  fonte: mupdf.PDFDocument, origem: number, em: number): void {
  mapa.graftPage(em, fonte, origem);
  const indice = em < 0 ? destino.countPages() - 1 : em;
  const pFonte = fonte.loadPage(origem).getObject();
  const anots = pFonte.get("Annots");
  if (!anots.isArray() || anots.length === 0) return;
  const pNova = destino.findPage(indice);
  const novas = destino.newArray();
  for (let k = 0; k < anots.length; k++) {
    const a = anots.get(k).resolve();
    if (!a.isDictionary()) continue;
    const tipo = a.get("Subtype").isName() ? a.get("Subtype").asName() : "";
    if (tipo === "Popup" || tipo === "Widget") continue;
    if (tipo === "Link" && (!a.get("Dest").isNull() || linkInterno(a))) continue;
    const copia = destino.newDictionary();
    a.forEach((valor, chave) => {
      if (chave === "P" || chave === "Popup" || chave === "Parent" || chave === "IRT") return;
      copia.put(chave, mapa.graftObject(valor));
    });
    copia.put("P", pNova);
    novas.push(destino.addObject(copia));
  }
  if (novas.length) pNova.put("Annots", novas);
}

function linkInterno(a: mupdf.PDFObject): boolean {
  const acao = a.get("A");
  if (!acao.isDictionary()) return false;
  const s = acao.get("S");
  return s.isName() && s.asName() !== "URI";
}

export function duplicar(s: Sessao, indice: number): void {
  s.pagina(indice);
  s.operacao("Duplicar página", () => {
    // Uma copia independente do proprio documento como fonte: enxertar da
    // mesma instancia reaproveitaria os objetos (conteudo compartilhado, e uma
    // tarja numa pagina apagaria a outra).
    const fonte = mupdf.Document.openDocument(s.instantaneo(), "application/pdf").asPDF()!;
    try {
      const destino = indice + 1;
      enxertarPagina(s.doc, s.doc.newGraftMap(), fonte, indice,
        destino >= s.paginas ? -1 : destino);
    } finally {
      fonte.destroy();
    }
  });
}

/** Pagina em branco na `posicao`. Sem medidas, copia as da pagina vizinha
 *  como o leitor a ve (um PDF em A4 ganha uma pagina A4, e nao Carta). */
export function inserirEmBranco(s: Sessao, posicao: number, largura?: number, altura?: number): void {
  if (largura === undefined || altura === undefined) {
    const viz = s.pagina(Math.min(Math.max(posicao - 1, 0), s.paginas - 1));
    const b = viz.getBounds();
    largura = b[2] - b[0];
    altura = b[3] - b[1];
  }
  const w = largura, h = altura;
  s.operacao("Inserir página em branco", () => {
    const obj = s.doc.addPage([0, 0, w, h], 0, {}, "");
    s.doc.insertPage(posicao >= s.paginas ? -1 : posicao, obj);
  });
}

/** Insere um PDF (ou imagem) na `posicao`. Devolve quantas paginas entraram. */
export function inserirArquivo(s: Sessao, bytes: Uint8Array, nome: string, posicao: number,
  tipo = ""): number {
  let fonte: mupdf.PDFDocument;
  try {
    fonte = abrirComoPdf(bytes, nome, undefined, tipo).doc;
  } catch (e) {
    if ((e as Error).name === "SenhaNecessaria") {
      throw new Error(`${nome} é protegido por senha. Abra-o, salve sem senha e tente de novo.`);
    }
    throw e;
  }
  try {
    const quantas = fonte.countPages();
    s.operacao("Inserir arquivo", () => {
      const mapa = s.doc.newGraftMap();
      const inicio = posicao >= s.paginas ? -1 : posicao;
      for (let i = 0; i < quantas; i++) {
        enxertarPagina(s.doc, mapa, fonte, i, inicio < 0 ? -1 : inicio + i);
      }
    });
    return quantas;
  } finally {
    fonte.destroy();
  }
}

/** Novo PDF so' com as paginas `indices` (na ordem dada). Mantem anotacoes,
 *  links e formularios: e' uma copia do documento com as outras paginas
 *  removidas. Sai sem senha. */
export function extrair(s: Sessao, indices: number[]): Uint8Array {
  const lista = [...new Set(indices)];
  if (!lista.length) throw new Error("Nenhuma página selecionada.");
  for (const i of lista) s.pagina(i);
  const copia = mupdf.Document.openDocument(s.instantaneo(), "application/pdf").asPDF()!;
  try {
    copia.rearrangePages(lista);
    return bytesDoBuffer(copia.saveToBuffer("garbage=compact,compress=yes"));
  } finally {
    copia.destroy();
  }
}

/** Junta varios arquivos (PDF ou imagem) num PDF novo. */
export function juntar(arquivos: { bytes: Uint8Array; nome: string; tipo?: string }[]): Uint8Array {
  if (!arquivos.length) throw new Error("Nenhum arquivo para juntar.");
  const novo = new mupdf.PDFDocument();
  try {
    for (const a of arquivos) {
      let fonte: mupdf.PDFDocument;
      try {
        fonte = abrirComoPdf(a.bytes, a.nome, undefined, a.tipo ?? "").doc;
      } catch (e) {
        if ((e as Error).name === "SenhaNecessaria") throw new Error(`${a.nome} é protegido por senha.`);
        throw e;
      }
      const mapa = novo.newGraftMap();
      for (let i = 0; i < fonte.countPages(); i++) enxertarPagina(novo, mapa, fonte, i, -1);
      fonte.destroy();
    }
    return bytesDoBuffer(novo.saveToBuffer("garbage=compact,compress=yes"));
  } finally {
    novo.destroy();
  }
}

/** Divide em varios arquivos, um por grupo. */
export function dividir(s: Sessao, grupos: number[][]): { nome: string; bytes: Uint8Array }[] {
  const base = nomeBase(s.nome);
  return grupos.map((g) => {
    const rotulo = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
    return { nome: `${base}_p${rotulo}.pdf`, bytes: extrair(s, g) };
  });
}
