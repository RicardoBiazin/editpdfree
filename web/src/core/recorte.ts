/*
 * Recortar paginas (CropBox).
 *
 * `PDFPage.setPageBox` do MuPDF.js recebe o retangulo no ESPACO PAGINA (o que
 * o leitor ve, ja' girado) e o leva ao espaco do arquivo sozinho (conferido:
 * numa pagina a 90 graus o /CropBox gravado sai com x e y trocados). Por isso
 * as margens sao aplicadas como o leitor ve a pagina: "em cima" e' o topo que
 * aparece na tela, qualquer que seja a rotacao.
 */

import { intersecta, normalizar, type Retangulo } from "./coordenadas.ts";
import type { Sessao } from "./documento.ts";

export const PT_POR_MM = 72 / 25.4;

export interface Margens { cima: number; direita: number; baixo: number; esquerda: number }

function aplicar(s: Sessao, indices: number[], calcular: (limites: Retangulo) => Retangulo, descricao: string): void {
  const lista = [...new Set(indices)].sort((a, b) => a - b);
  if (!lista.length) throw new Error("Nenhuma página escolhida.");
  // Confere antes de mexer: recorte que zera a pagina e' erro do usuario.
  for (const i of lista) {
    const r = calcular(s.pagina(i).getBounds() as Retangulo);
    if (r[2] - r[0] < 10 || r[3] - r[1] < 10) {
      throw new Error(`O recorte deixaria a página ${i + 1} pequena demais.`);
    }
  }
  s.operacao(descricao, () => {
    for (const i of lista) {
      const p = s.pagina(i);
      p.setPageBox("CropBox", calcular(p.getBounds() as Retangulo));
    }
  });
}

/** Recorta pelo retangulo desenhado (espaco pagina), limitado a cada pagina. */
export function recortarRetangulo(s: Sessao, indices: number[], rect: Retangulo): void {
  const r = normalizar(rect);
  aplicar(s, indices, (b) => {
    if (!intersecta(b, r)) return [b[0], b[1], b[0], b[1]];
    return [Math.max(b[0], r[0]), Math.max(b[1], r[1]), Math.min(b[2], r[2]), Math.min(b[3], r[3])];
  }, indices.length === 1 ? "Recortar página" : "Recortar páginas");
}

/** Recorta margens em milimetros, como o leitor ve a pagina. */
export function recortarMargens(s: Sessao, indices: number[], m: Margens): void {
  for (const v of [m.cima, m.direita, m.baixo, m.esquerda]) {
    if (!(v >= 0) || !Number.isFinite(v)) throw new Error("As margens precisam ser números maiores ou iguais a zero.");
  }
  if (m.cima + m.direita + m.baixo + m.esquerda === 0) throw new Error("Informe ao menos uma margem.");
  aplicar(s, indices, (b) => [b[0] + m.esquerda * PT_POR_MM, b[1] + m.cima * PT_POR_MM,
    b[2] - m.direita * PT_POR_MM, b[3] - m.baixo * PT_POR_MM],
  indices.length === 1 ? "Recortar margens da página" : "Recortar margens");
}
