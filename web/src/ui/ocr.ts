/*
 * OCR com tesseract.js, carregado so' quando o usuario pede.
 *
 * Tudo vem do proprio site (public/ocr/, copiado de node_modules no build):
 * o worker, o nucleo WASM e os idiomas. Com `workerBlobURL: false` o worker e'
 * criado direto do arquivo (sem blob:), entao a CSP nao precisa de `blob:`;
 * o nucleo tem o .wasm embutido em base64 e roda com 'wasm-unsafe-eval', que
 * o site ja' permite. `cacheMethod: "none"`: quem guarda os arquivos para
 * funcionar sem internet e' o service worker (depois do primeiro uso).
 */

import type { Motor } from "../rpc.ts";
import { palavrasDoTesseract, type PalavraOcr, type PalavraTesseract } from "../core/ocr-palavras.ts";
import type { Retangulo } from "../core/coordenadas.ts";

/** Pixels por ponto no render para o OCR (~250 dpi: bom para o tesseract). */
const ESCALA = 250 / 72;

export interface ResultadoOcr { paginas: { pagina: number; palavras: PalavraOcr[] }[]; puladas: number[] }

export async function reconhecer(motor: Motor, paginas: number[], idiomas: string,
  progresso: (texto: string, fracao: number) => void, cancelado: () => boolean): Promise<ResultadoOcr> {
  progresso("Carregando o reconhecimento de texto…", 0);
  const { createWorker } = await import("tesseract.js");
  const base = new URL("/ocr/", location.href).href;
  let paginaAtual = 0;
  const worker = await createWorker(idiomas, 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base + "lang",
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") {
        progresso(`Reconhecendo a página ${paginas[paginaAtual] + 1} (${paginaAtual + 1} de ${paginas.length})…`,
          (paginaAtual + m.progress) / paginas.length);
      } else if (/load|initializ/.test(m.status)) {
        progresso("Carregando o reconhecimento de texto…", 0);
      }
    },
  });
  const saida: ResultadoOcr = { paginas: [], puladas: [] };
  try {
    for (paginaAtual = 0; paginaAtual < paginas.length; paginaAtual++) {
      if (cancelado()) break;
      const i = paginas[paginaAtual];
      const r = await motor.pedir<{ png: Uint8Array; temTexto: boolean; limites: Retangulo }>("paginaParaOcr",
        { pagina: i, escala: ESCALA });
      if (r.temTexto) {
        saida.puladas.push(i);
        continue;
      }
      const res = await worker.recognize(new Blob([r.png as Uint8Array<ArrayBuffer>], { type: "image/png" }), {}, { blocks: true });
      const palavras = (res.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
      saida.paginas.push({ pagina: i, palavras: palavrasDoTesseract(palavras as unknown as PalavraTesseract[], r.limites, ESCALA) });
    }
  } finally {
    await worker.terminate();
  }
  return saida;
}
