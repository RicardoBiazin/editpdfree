// Conversao das palavras do tesseract.js (sem mupdf: a interface usa direto).

import type { Retangulo } from "./coordenadas.ts";

export interface PalavraOcr { texto: string; rect: Retangulo }

/** Palavra como o tesseract.js devolve (caixa em pixels da imagem). */
export interface PalavraTesseract { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** Pixels da imagem renderizada (na `escala` dada) -> espaco pagina. Palavras
 *  com confianca muito baixa (lixo de mancha) ficam de fora. */
export function palavrasDoTesseract(palavras: PalavraTesseract[], limites: Retangulo, escala: number,
  confiancaMinima = 30): PalavraOcr[] {
  return palavras.filter((w) => w.text.trim() && w.confidence >= confiancaMinima).map((w) => ({
    texto: w.text,
    rect: [w.bbox.x0 / escala + limites[0], w.bbox.y0 / escala + limites[1],
      w.bbox.x1 / escala + limites[0], w.bbox.y1 / escala + limites[1]] as Retangulo,
  }));
}
