/*
 * Desenhar uma pagina em pixels RGBA (o que o canvas espera).
 *
 * `toPixmap` sem alfa da' RGB com fundo branco; o canvas quer RGBA nao
 * pre-multiplicado. Converter RGB -> RGBA aqui e' mais barato e mais correto
 * do que pedir alfa (que vem pre-multiplicado e deixaria as bordas erradas).
 */

import * as mupdf from "mupdf";

export interface Imagem { largura: number; altura: number; rgba: Uint8ClampedArray }

export function renderizar(p: mupdf.PDFPage, escala: number, comAnotacoes = true): Imagem {
  const pix = p.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false, comAnotacoes);
  try {
    const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride();
    // `n` do pixmap ja' inclui o alfa, se houver.
    const n = pix.getNumberOfComponents();
    const src = pix.getPixels();
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      let s = y * stride, d = y * w * 4;
      for (let x = 0; x < w; x++, s += n, d += 4) {
        rgba[d] = src[s];
        rgba[d + 1] = src[s + 1];
        rgba[d + 2] = src[s + 2];
        rgba[d + 3] = 255;
      }
    }
    return { largura: w, altura: h, rgba };
  } finally {
    pix.destroy();
  }
}

/** PNG da pagina (para exportar). */
export function paginaPng(p: mupdf.PDFPage, escala: number): Uint8Array {
  const pix = p.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    return pix.asPNG().slice();
  } finally {
    pix.destroy();
  }
}
