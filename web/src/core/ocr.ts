/*
 * Camada de texto do OCR.
 *
 * O reconhecimento (tesseract.js) roda fora daqui, na interface; este modulo
 * so' escreve as palavras reconhecidas como TEXTO INVISIVEL (modo de
 * renderizacao 3) na posicao de cada palavra da imagem. Assim a busca, a
 * selecao, a tarja por texto e a extracao funcionam num PDF escaneado, e a
 * aparencia da pagina nao muda.
 *
 * Cada palavra ganha o tamanho de fonte da altura da caixa e uma escala
 * horizontal (Tz) que faz a largura do texto bater com a largura da caixa.
 */

import type * as mupdf from "mupdf";
import { matrizPaginaParaConteudo, normalizar, type Retangulo } from "./coordenadas.ts";
import { fmt, geometria, type Sessao } from "./documento.ts";
import { Acrescimo, codificarWinAnsi, larguraTexto } from "./conteudo.ts";

import type { PalavraOcr } from "./ocr-palavras.ts";

export type { PalavraOcr } from "./ocr-palavras.ts";

/** A pagina ja' tem texto? (Se tem, OCR nela e' desnecessario.) */
export function temTexto(p: mupdf.PDFPage): boolean {
  const st = p.toStructuredText("");
  try {
    return st.asText().trim().length > 0;
  } finally {
    st.destroy();
  }
}

function hex(t: string): string {
  return "<" + codificarWinAnsi(t).map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
}

/** Escreve as palavras (espaco pagina) como texto invisivel. Uma operacao. */
export function aplicarCamadaOcr(s: Sessao, pagina: number, palavras: PalavraOcr[]): number {
  let n = 0;
  if (!palavras.some((w) => w.texto.trim())) return 0;
  s.operacao("Reconhecer texto (OCR)", () => {
    n = escreverCamada(s, pagina, palavras);
  });
  return n;
}

function escreverCamada(s: Sessao, pagina: number, palavras: PalavraOcr[]): number {
  const validas = palavras
    .map((w) => ({ texto: w.texto.trim(), rect: normalizar(w.rect) }))
    .filter((w) => w.texto && w.rect[2] - w.rect[0] > 0.5 && w.rect[3] - w.rect[1] > 0.5);
  if (!validas.length) return 0;
  {
    // (sem operacao aqui: quem chama abre a operacao)
    const p = s.pagina(pagina);
    const g = geometria(p);
    const ac = new Acrescimo(s.doc, p);
    const fonte = ac.fonteBase14("Helvetica");
    const ops: string[] = ["BT", "3 Tr"];
    for (const w of validas) {
      const h = w.rect[3] - w.rect[1];
      const tamanho = h;
      const largura = larguraTexto(w.texto, "Helvetica", tamanho) || 1;
      const tz = Math.max(1, Math.min(1000, 100 * (w.rect[2] - w.rect[0]) / largura));
      // Linha de base ~20% da altura acima do fundo da caixa (descendentes).
      const tm = matrizPaginaParaConteudo(g, [1, 0, 0, -1, w.rect[0], w.rect[3] - h * 0.2]);
      ops.push(`/${fonte} ${fmt(tamanho)} Tf ${fmt(tz)} Tz ${tm.map(fmt).join(" ")} Tm ${hex(w.texto + " ")} Tj`);
    }
    ops.push("ET");
    ac.gravar(ops.join("\n"));
  }
  return validas.length;
}

export { palavrasDoTesseract, type PalavraTesseract } from "./ocr-palavras.ts";

/** Varias paginas numa operacao so' (um desfazer para o OCR inteiro). */
export function aplicarCamadaOcrVarias(s: Sessao, paginas: { pagina: number; palavras: PalavraOcr[] }[]): number {
  const comPalavras = paginas.filter((p) => p.palavras.length);
  if (!comPalavras.length) return 0;
  let total = 0;
  s.operacao("Reconhecer texto (OCR)", () => {
    for (const p of comPalavras) total += escreverCamada(s, p.pagina, p.palavras);
  });
  return total;
}
