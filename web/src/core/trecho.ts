/*
 * Tipos e contas puras do "Editar texto" -- sem MuPDF, para a interface
 * poder importar (destacar a selecao enquanto o mouse arrasta) sem puxar o
 * WASM para o pacote principal.
 */

import type { Ponto, Retangulo } from "./coordenadas.ts";

export type Familia = "helv" | "times" | "courier";

const BASE14: Record<Familia, [string, string, string, string]> = {
  helv: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};

export function nomeBase14(familia: Familia, negrito = false, italico = false): string {
  return BASE14[familia][(negrito ? 1 : 0) + (italico ? 2 : 0)];
}

export type Cor = [number, number, number];

/** Estilo de um grupo de caracteres (fonte, tamanho e cor iguais). */
export interface EstiloTrecho {
  fonte: string;
  tamanho: number;
  cor: Cor;
  negrito: boolean;
  italico: boolean;
  familia: Familia;
}

/** Um caractere da linha, no espaco pagina. */
export interface Caractere {
  c: string;
  /** Linha de base: origem do glifo. */
  x: number;
  y: number;
  /** Extensao horizontal desenhada (quad). */
  x0: number;
  x1: number;
  /** Indice em `Trecho.estilos`. */
  e: number;
}

export interface Trecho extends EstiloTrecho {
  pagina: number;
  /** Caixa da linha inteira. */
  rect: Retangulo;
  /** Linha de base do primeiro caractere (espaco pagina). */
  origem: Ponto;
  /** A linha inteira (sem o branco do fim). */
  texto: string;
  /** Horizontal para o leitor (esquerda -> direita). */
  horizontal: boolean;
  caracteres: Caractere[];
  estilos: EstiloTrecho[];
  /** Selecao [inicio, fim) em `caracteres`; a linha inteira por padrao.
   *  Os campos de estilo de cima sao os da selecao. */
  inicio: number;
  fim: number;
}

/** Estilo que domina os caracteres [a, b) (o com mais caracteres visiveis). */
export function estiloPrincipal(t: Pick<Trecho, "caracteres" | "estilos">, a = 0,
  b = t.caracteres.length): EstiloTrecho {
  const n = new Map<number, number>();
  for (const k of t.caracteres.slice(a, b)) {
    if (k.c.trim()) n.set(k.e, (n.get(k.e) ?? 0) + 1);
  }
  let melhor = t.caracteres[a]?.e ?? 0, maior = -1;
  for (const [e, q] of n) if (q > maior) { maior = q; melhor = e; }
  return t.estilos[melhor];
}

/** Restringe o trecho aos caracteres cujo centro esta entre os x de `a` e
 *  `b` (espaco pagina). Arrastar sobre parte da linha seleciona so' aquilo. */
export function selecionarFaixa(t: Trecho, xa: number, xb: number): Trecho {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  const cs = t.caracteres;
  let ini = -1, fim = -1;
  cs.forEach((k, i) => {
    const centro = (k.x0 + k.x1) / 2;
    if (centro >= lo && centro <= hi) {
      if (ini < 0) ini = i;
      fim = i + 1;
    }
  });
  if (ini < 0) {
    // Arrasto curto entre dois caracteres: o mais proximo.
    let melhor = 0, d = Infinity;
    cs.forEach((k, i) => {
      const dd = Math.abs((k.x0 + k.x1) / 2 - (lo + hi) / 2);
      if (dd < d) { d = dd; melhor = i; }
    });
    ini = melhor;
    fim = melhor + 1;
  }
  return comSelecao(t, ini, fim);
}

export function comSelecao(t: Trecho, inicio: number, fim: number): Trecho {
  const n = t.caracteres.length;
  inicio = Math.max(0, Math.min(n, inicio));
  fim = Math.max(inicio, Math.min(n, fim));
  return { ...t, ...estiloPrincipal(t, inicio, Math.max(fim, inicio + 1)), inicio, fim };
}

/** Texto selecionado. */
export function textoSelecionado(t: Trecho): string {
  return t.caracteres.slice(t.inicio, t.fim).map((k) => k.c).join("");
}

/** Caixa dos caracteres selecionados (altura da linha). */
export function caixaSelecao(t: Trecho): Retangulo {
  const cs = t.caracteres.slice(t.inicio, t.fim);
  if (!cs.length) return t.rect;
  return [Math.min(...cs.map((k) => k.x0)), t.rect[1], Math.max(...cs.map((k) => k.x1)), t.rect[3]];
}

/** O menor trecho que muda entre `antigo` e `novo`: prefixo e sufixo comuns
 *  ficam intactos (com a fonte original). Devolve [a, b) em `antigo` e o
 *  pedaco de `novo` que entra no lugar. */
export function diferenca(antigo: string, novo: string): { a: number; b: number; meio: string } {
  let a = 0;
  while (a < antigo.length && a < novo.length && antigo[a] === novo[a]) a++;
  let s = 0;
  while (s < antigo.length - a && s < novo.length - a
    && antigo[antigo.length - 1 - s] === novo[novo.length - 1 - s]) s++;
  return { a, b: antigo.length - s, meio: novo.slice(a, novo.length - s) };
}
