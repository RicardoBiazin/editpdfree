import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessao } from "../src/core/documento.ts";
import { comprimir, imagensDoDocumento, reparar } from "../src/core/otimizar.ts";
import { renderizar } from "../src/core/render.ts";
import { criarPdf, criarPdfComImagemGrande, textoDaPagina } from "./fixtures.ts";

function mediaRegiao(img: { largura: number; altura: number; rgba: Uint8ClampedArray }, y0: number, y1: number): number {
  let soma = 0, n = 0;
  for (let y = Math.floor(img.altura * y0); y < img.altura * y1; y += 3) {
    for (let x = 0; x < img.largura; x += 3) {
      const o = (y * img.largura + x) * 4;
      soma += img.rgba[o]; n++;
    }
  }
  return soma / n;
}

test("comprimir reamostra a imagem grande, diminui o arquivo e mantém a aparência", () => {
  const original = criarPdfComImagemGrande();
  const s = Sessao.abrir(original, "foto.pdf");
  const antesImg = renderizar(s.pagina(0), 0.5);
  const r = comprimir(s, { dpi: 100, qualidade: 60 });
  assert.equal(r.imagens, 1);
  assert.ok(r.depois < r.antes * 0.5, `${r.antes} -> ${r.depois}`);
  const salvo = s.salvar();
  assert.equal(salvo.length, r.depois);
  const s2 = Sessao.abrir(salvo, "foto.pdf");
  const [info] = imagensDoDocumento(s2.doc).values();
  const obj = info.ref.resolve();
  assert.equal(obj.get("Filter").asName(), "DCTDecode");
  assert.ok(obj.get("Height").asNumber() <= Math.round(842 / 72 * 100));
  const depoisImg = renderizar(s2.pagina(0), 0.5);
  // A metade de cima continua escura e a de baixo clara (nada virou de ponta-cabeca).
  assert.ok(Math.abs(mediaRegiao(depoisImg, 0.05, 0.45) - mediaRegiao(antesImg, 0.05, 0.45)) < 12);
  assert.ok(Math.abs(mediaRegiao(depoisImg, 0.55, 0.95) - mediaRegiao(antesImg, 0.55, 0.95)) < 12);
  assert.ok(mediaRegiao(depoisImg, 0.05, 0.45) < 100 && mediaRegiao(depoisImg, 0.55, 0.95) > 180);
  // Desfazer volta a imagem original.
  s.desfazer();
  const [info0] = imagensDoDocumento(s.doc).values();
  assert.notEqual(info0.ref.resolve().get("Filter").asName(), "DCTDecode");
});

test("comprimir um PDF sem imagens não quebra nada", () => {
  const s = Sessao.abrir(criarPdf([{ linhas: ["só texto"] }]), "t.pdf");
  const r = comprimir(s);
  assert.equal(r.imagens, 0);
  assert.match(textoDaPagina(Sessao.abrir(s.salvar(), "t.pdf"), 0), /só texto/);
});

test("reparar: PDF truncado (sem xref nem trailer) recupera as páginas", () => {
  // Gravado sem compressao nem object streams, para os objetos ficarem legiveis.
  const inteiro = criarPdf([{ linhas: ["Página A"] }, { linhas: ["Página B"] }, { linhas: ["Página C"] }]);
  const texto = new TextDecoder("latin1").decode(inteiro);
  const corte = texto.lastIndexOf("xref");
  assert.ok(corte > 0, "o fixture tem tabela xref");
  const truncado = inteiro.slice(0, corte);
  const r = reparar(truncado);
  assert.equal(r.estavaDanificado, true);
  assert.equal(r.paginas, 3);
  assert.equal(r.paginasComErro, 0);
  const s = Sessao.abrir(r.bytes, "r.pdf");
  assert.equal(s.reparado, false, "o arquivo gravado já está limpo");
  assert.match(textoDaPagina(s, 2), /Página C/);
  // Aberto direto, o truncado tambem e' reparado e isso fica marcado.
  assert.equal(Sessao.abrir(truncado, "t.pdf").reparado, true);
});

test("reparar: xref com deslocamentos errados", () => {
  const inteiro = criarPdf([{ linhas: ["um"] }, { linhas: ["dois"] }]);
  const t = new TextDecoder("latin1").decode(inteiro);
  const i = t.lastIndexOf("xref");
  // Estraga todos os deslocamentos da tabela.
  const estragado = t.slice(0, i) + t.slice(i).replace(/\b\d{10} 00000 n/g, "0000000001 00000 n");
  const r = reparar(Uint8Array.from(estragado, (c) => c.charCodeAt(0)));
  assert.equal(r.paginas, 2);
  assert.match(textoDaPagina(Sessao.abrir(r.bytes, "x.pdf"), 1), /dois/);
});

test("reparar: lixo total dá erro legível", () => {
  assert.throws(() => reparar(new TextEncoder().encode("não é pdf nenhum")), /PDF|página/);
});

import { detectarDocumento, limiarOtsu, realcar, recortarImagem, type ImagemRGBA } from "../src/core/digitalizar.ts";

function fotoSintetica(): ImagemRGBA {
  // Mesa escura (60) com uma folha clara (225) em [40,50]-[160,250] e "texto" (30) na folha.
  const largura = 200, altura = 300;
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) {
    const o = (y * largura + x) * 4;
    let v = 60 + ((x * 7 + y * 3) % 11);
    if (x >= 40 && x < 160 && y >= 50 && y < 250) v = (y % 20 < 3 && x > 55 && x < 140) ? 30 : 225;
    dados[o] = v; dados[o + 1] = v; dados[o + 2] = v - 10; dados[o + 3] = 255;
  }
  return { largura, altura, dados };
}

test("digitalizar: acha as bordas da folha e realça (cinza, preto e branco)", () => {
  const img = fotoSintetica();
  const r = detectarDocumento(img);
  for (const [v, e] of [[r[0], 40], [r[1], 50], [r[2], 160], [r[3], 250]]) assert.ok(Math.abs(v - e) <= 2, `bordas ${r}`);
  const folha = recortarImagem(img, r);
  assert.equal(folha.largura, r[2] - r[0]);
  const pb = realcar(folha, "pb");
  const valores = new Set<number>();
  for (let o = 0; o < pb.dados.length; o += 4) valores.add(pb.dados[o]);
  assert.deepEqual([...valores].sort((a, b) => a - b), [0, 255]);
  const cinza = realcar(folha, "cinza");
  assert.equal(cinza.dados[0], cinza.dados[1]);
  // Imagem sem contraste (tudo papel): devolve a imagem inteira.
  const lisa = { largura: 10, altura: 10, dados: new Uint8ClampedArray(400).fill(230) };
  assert.deepEqual(detectarDocumento(lisa), [0, 0, 10, 10]);
  const h = new Uint32Array(256); h[20] = 100; h[200] = 100;
  const t = limiarOtsu(h);
  assert.ok(t >= 20 && t < 200);
});
