/*
 * Comparar duas versoes de um PDF, palavra a palavra.
 *
 * A comparacao e' do documento INTEIRO como uma sequencia de palavras, nao
 * pagina contra pagina: inserir um paragrafo na pagina 2 empurra o resto, e
 * comparar pagina a pagina marcaria tudo dali em diante como diferente.
 *
 * O alinhamento e' o do difflib.SequenceMatcher do Python (o mesmo do desktop,
 * editpdfree/comparar.py), portado aqui SEM a heuristica de "autojunk": com
 * ela, palavras frequentes ("de", "a") sao ignoradas em documentos longos e o
 * alinhamento sai errado.
 */

import type * as mupdf from "mupdf";
import { uniao, type Retangulo } from "./coordenadas.ts";

export interface Palavra { texto: string; pagina: number; rect: Retangulo }
export interface Local { pagina: number; rect: Retangulo }
export type TipoDiferenca = "inserido" | "removido" | "alterado";
export interface Diferenca { tipo: TipoDiferenca; textoA: string; textoB: string; emA: Local[]; emB: Local[] }

export function palavrasDoDocumento(doc: mupdf.PDFDocument): Palavra[] {
  const lista: Palavra[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    let atual: Palavra | null = null;
    const fechar = () => {
      if (atual) lista.push(atual);
      atual = null;
    };
    try {
      st.walk({
        onChar(c, _o, _f, _t, q) {
          if (/\s/.test(c)) {
            fechar();
            return;
          }
          const r: Retangulo = [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];
          if (atual) {
            atual.texto += c;
            atual.rect = uniao(atual.rect, r);
          } else {
            atual = { texto: c, pagina: i, rect: r };
          }
        },
        endLine: fechar,
      });
    } finally {
      st.destroy();
    }
  }
  return lista;
}

// ------------------------------------------------------------ difflib sem autojunk

type Bloco = [number, number, number];
export type Opcode = ["equal" | "replace" | "delete" | "insert", number, number, number, number];

export function blocosIguais(a: string[], b: string[]): Bloco[] {
  const b2j = new Map<string, number[]>();
  b.forEach((t, j) => {
    const l = b2j.get(t);
    if (l) l.push(j); else b2j.set(t, [j]);
  });
  const maisLongo = (alo: number, ahi: number, blo: number, bhi: number): Bloco => {
    let bi = alo, bj = blo, bk = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const novo = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        novo.set(j, k);
        if (k > bk) { bi = i - k + 1; bj = j - k + 1; bk = k; }
      }
      j2len = novo;
    }
    return [bi, bj, bk];
  };
  const fila: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  const achados: Bloco[] = [];
  while (fila.length) {
    const [alo, ahi, blo, bhi] = fila.pop()!;
    const [i, j, k] = maisLongo(alo, ahi, blo, bhi);
    if (k) {
      achados.push([i, j, k]);
      if (alo < i && blo < j) fila.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) fila.push([i + k, ahi, j + k, bhi]);
    }
  }
  achados.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  // Junta blocos adjacentes.
  const juntos: Bloco[] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of achados) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else {
      if (k1) juntos.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) juntos.push([i1, j1, k1]);
  juntos.push([a.length, b.length, 0]);
  return juntos;
}

export function opcodes(a: string[], b: string[]): Opcode[] {
  let i = 0, j = 0;
  const saida: Opcode[] = [];
  for (const [ai, bj, k] of blocosIguais(a, b)) {
    const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null;
    if (tag) saida.push([tag, i, ai, j, bj]);
    i = ai + k;
    j = bj + k;
    if (k) saida.push(["equal", ai, i, bj, j]);
  }
  return saida;
}

/** Uma caixa por linha em vez de uma por palavra (destaque continuo). */
function juntarLinhas(itens: Palavra[]): Local[] {
  const caixas: Local[] = [];
  for (const p of itens) {
    const u = caixas.at(-1);
    if (u && u.pagina === p.pagina) {
      const altura = u.rect[3] - u.rect[1];
      if (Math.abs(u.rect[1] - p.rect[1]) < altura * 0.5 && p.rect[0] >= u.rect[0]) {
        u.rect = uniao(u.rect, p.rect);
        continue;
      }
    }
    caixas.push({ pagina: p.pagina, rect: [...p.rect] as Retangulo });
  }
  return caixas;
}

export function compararPalavras(pa: Palavra[], pb: Palavra[]): Diferenca[] {
  // So' se ignora espaco: "Não" -> "não" pode importar num contrato.
  const ta = pa.map((p) => p.texto.trim()), tb = pb.map((p) => p.texto.trim());
  const nomes = { replace: "alterado", delete: "removido", insert: "inserido" } as const;
  const saida: Diferenca[] = [];
  for (const [op, a0, a1, b0, b1] of opcodes(ta, tb)) {
    if (op === "equal") continue;
    saida.push({
      tipo: nomes[op], textoA: ta.slice(a0, a1).join(" "), textoB: tb.slice(b0, b1).join(" "),
      emA: juntarLinhas(pa.slice(a0, a1)), emB: juntarLinhas(pb.slice(b0, b1)),
    });
  }
  return saida;
}

export function comparar(a: mupdf.PDFDocument, b: mupdf.PDFDocument): Diferenca[] {
  return compararPalavras(palavrasDoDocumento(a), palavrasDoDocumento(b));
}

export function rotulo(d: Diferenca): string {
  if (d.tipo === "inserido") return `+ ${d.textoB}`;
  if (d.tipo === "removido") return `− ${d.textoA}`;
  return `${d.textoA} → ${d.textoB}`;
}
