// Copia os arquivos do OCR (tesseract.js) para public/ocr/, servidos pelo
// proprio site -- nada vem de CDN. Roda antes do `vite` e do `vite build`.
//
//   public/ocr/worker.min.js                     worker do tesseract.js
//   public/ocr/tesseract-core-*lstm.wasm.js      nucleo (so' LSTM; um e' baixado,
//                                                 conforme o navegador suporta SIMD)
//   public/ocr/lang/{por,eng}.traineddata.gz     idiomas (modelos "best_int")
//
// A pasta e' gerada (esta' no .gitignore).

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";

const nm = new URL("../node_modules/", import.meta.url);
const destino = new URL("../public/ocr/", import.meta.url);
mkdirSync(new URL("lang/", destino), { recursive: true });

const arquivos = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz", "lang/por.traineddata.gz"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
];

let total = 0;
for (const [de, para] of arquivos) {
  const origem = new URL(de, nm), alvo = new URL(para, destino);
  if (!existsSync(origem)) throw new Error(`Falta ${de}: rode npm install.`);
  if (!existsSync(alvo) || statSync(alvo).size !== statSync(origem).size) copyFileSync(origem, alvo);
  total += statSync(alvo).size;
}
console.log(`arquivos do OCR em public/ocr/ (${(total / 1048576).toFixed(1)} MB)`);
