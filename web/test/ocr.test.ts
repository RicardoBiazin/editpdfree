import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as mupdf from "mupdf";
import { Sessao, bytesDoBuffer } from "../src/core/documento.ts";
import { aplicarCamadaOcr, aplicarCamadaOcrVarias, palavrasDoTesseract, temTexto, type PalavraTesseract } from "../src/core/ocr.ts";
import { buscar, tarjarTexto } from "../src/core/seguranca.ts";
import { renderizar } from "../src/core/render.ts";
import { marcaDaguaImagem } from "../src/core/extras.ts";
import { criarPdf, escanear, pngTeste, reabrir, sessao } from "./fixtures.ts";

test("camada de OCR: texto invisível na posição das palavras (busca e tarja funcionam)", () => {
  const s = Sessao.abrir(escanear(criarPdf([{ linhas: ["texto na imagem"] }])), "scan.pdf");
  assert.equal(temTexto(s.pagina(0)), false);
  const antes = renderizar(s.pagina(0), 1);
  const n = aplicarCamadaOcr(s, 0, [
    { texto: "Contrato", rect: [72, 56, 140, 76] },
    { texto: "número", rect: [146, 56, 200, 76] },
    { texto: "   ", rect: [0, 0, 5, 5] },
  ]);
  assert.equal(n, 2);
  const s2 = reabrir(s);
  assert.equal(temTexto(s2.pagina(0)), true);
  const [r] = buscar(s2.doc, "Contrato");
  assert.ok(Math.abs(r.rect[0] - 72) < 2 && Math.abs(r.rect[2] - 140) < 3, `caixa da palavra ${r.rect}`);
  assert.ok(r.rect[1] > 50 && r.rect[3] < 82, `altura ${r.rect}`);
  assert.equal(buscar(s2.doc, "número").length, 1, "acentos entram (WinAnsi)");
  // Invisivel: a pagina desenhada e' a mesma.
  const depois = renderizar(s2.pagina(0), 1);
  assert.deepEqual(depois.rgba, antes.rgba);
  assert.equal(tarjarTexto(s2, "Contrato"), 1);
});

test("conversão das caixas do tesseract (pixels na escala do render) para a página", () => {
  const w: PalavraTesseract[] = [
    { text: "Olá", confidence: 90, bbox: { x0: 200, y0: 100, x1: 260, y1: 130 } },
    { text: "%$#", confidence: 5, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
  ];
  assert.deepEqual(palavrasDoTesseract(w, [0, 0, 595, 842], 2), [{ texto: "Olá", rect: [100, 50, 130, 65] }]);
});

test("OCR de verdade com tesseract.js (por, local): PDF escaneado fica pesquisável", { timeout: 120_000 }, async () => {
  const { createWorker } = await import("tesseract.js");
  const s = Sessao.abrir(escanear(criarPdf([{ linhas: ["Contrato de prestação de serviços", "Valor total 1234 reais"] }])), "scan.pdf");
  const escala = 2;
  const p = s.pagina(0);
  const png = p.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false).asPNG().slice();
  const langPath = fileURLToPath(new URL("../node_modules/@tesseract.js-data/por/4.0.0_best_int", import.meta.url));
  const worker = await createWorker("por", 1, { langPath, cacheMethod: "none", gzip: true });
  try {
    const r = await worker.recognize(Buffer.from(png), {}, { blocks: true });
    const palavras = r.data.blocks!.flatMap((b) => b.paragraphs.flatMap((pp) => pp.lines.flatMap((l) => l.words)));
    aplicarCamadaOcr(s, 0, palavrasDoTesseract(palavras, p.getBounds() as [number, number, number, number], escala));
  } finally {
    await worker.terminate();
  }
  const s2 = reabrir(s);
  const achado = buscar(s2.doc, "prestação");
  assert.equal(achado.length, 1);
  // "prestacao" fica em ~x 170-230, linha de base y ~770 do PDF (-> ~72 da pagina)
  assert.ok(achado[0].rect[0] > 120 && achado[0].rect[0] < 200 && achado[0].rect[1] > 50 && achado[0].rect[3] < 85,
    `posição ${achado[0].rect}`);
  assert.equal(buscar(s2.doc, "1234").length, 1);
});

test("marca d'água de imagem: por cima com opacidade, por baixo do conteúdo, mosaico", () => {
  // Pagina branca com um retangulo preto no centro.
  const base = () => sessao([{ largura: 400, altura: 400, marcador: [150, 150, 100] }]);
  const px = (s: Sessao, x: number, y: number) => {
    const img = renderizar(s.pagina(0), 1);
    const o = (y * img.largura + x) * 4;
    return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
  };
  // Imagem azul-escura de metade de cima (pngTeste), escala 0,5 = 200 pt, centrada.
  const sobre = base();
  marcaDaguaImagem(sobre, pngTeste(40, 40, false), { opacidade: 0.5, escala: 0.5, modo: "centro", camada: "sobre" });
  const s1 = reabrir(sobre);
  const fora = px(s1, 120, 120); // dentro da imagem, fora do retangulo preto
  assert.ok(fora[0] > 100 && fora[0] < 200 && fora[2] > 200, `mistura com o branco: ${fora}`);
  assert.deepEqual(px(s1, 20, 20), [255, 255, 255], "fora da imagem nada muda");
  const sob = base();
  marcaDaguaImagem(sob, pngTeste(40, 40, false), { opacidade: 1, escala: 0.5, camada: "sob" });
  const s2 = reabrir(sob);
  assert.deepEqual(px(s2, 200, 200), [0, 0, 0], "por baixo: o conteúdo preto continua por cima");
  assert.notDeepEqual(px(s2, 120, 120), [255, 255, 255], "e a imagem aparece onde a página era branca");
  const mosaico = base();
  marcaDaguaImagem(mosaico, pngTeste(), { escala: 0.2, modo: "mosaico" });
  const conteudo = reabrir(mosaico).pagina(0).getObject().get("Contents");
  let texto = "";
  for (let i = 0; i < conteudo.length; i++) texto += conteudo.get(i).readStream().asString();
  assert.ok((texto.match(/ Do Q/g) ?? []).length >= 9, "várias cópias no mosaico");
  assert.throws(() => marcaDaguaImagem(base(), new Uint8Array([1, 2, 3])), /imagem/);
});

test("OCR de várias páginas entra num desfazer só", () => {
  const s = Sessao.abrir(escanear(criarPdf([{}, {}, {}])), "scan.pdf");
  const n = aplicarCamadaOcrVarias(s, [
    { pagina: 0, palavras: [{ texto: "um", rect: [72, 72, 100, 90] }] },
    { pagina: 1, palavras: [] },
    { pagina: 2, palavras: [{ texto: "três", rect: [72, 72, 110, 90] }] },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(buscar(s.doc, "três").map((r) => r.pagina), [2]);
  assert.equal(s.podeDesfazer, "Reconhecer texto (OCR)");
  s.desfazer();
  assert.equal(s.podeDesfazer, null);
  assert.equal(aplicarCamadaOcrVarias(s, [{ pagina: 0, palavras: [] }]), 0);
});
