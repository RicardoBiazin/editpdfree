import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessao } from "../src/core/documento.ts";
import { comprimir, estimar } from "../src/core/otimizar.ts";
import { NIVEIS_COMPRESSAO } from "../src/core/formatos.ts";
import { criarPdfComImagemGrande } from "./fixtures.ts";

const niveis = Object.entries(NIVEIS_COMPRESSAO).map(([chave, v]) => ({ chave, dpi: v.dpi, qualidade: v.qualidade }));

test("três níveis, na ordem, cada um mais forte que o anterior", () => {
  assert.deepEqual(Object.keys(NIVEIS_COMPRESSAO), ["leve", "media", "forte"]);
  const dpis = Object.values(NIVEIS_COMPRESSAO).map((n) => n.dpi);
  assert.deepEqual(dpis, [...dpis].sort((a, b) => b - a));
});

test("estimar não mexe no documento e bate com o resultado real", () => {
  const s = Sessao.abrir(criarPdfComImagemGrande(), "foto.pdf");
  const antes = s.gravarCopia().length;
  const t = estimar(s, niveis);
  assert.equal(s.gravarCopia().length, antes, "documento intacto");
  assert.equal(s.modificado, false);
  assert.ok(t.atual >= t.leve && t.leve >= t.media && t.media >= t.forte, JSON.stringify(t));
  assert.ok(t.forte < t.atual, "a máxima diminui");
  for (const n of niveis) {
    const s2 = Sessao.abrir(criarPdfComImagemGrande(), "foto.pdf");
    const r = comprimir(s2, { dpi: n.dpi, qualidade: n.qualidade });
    assert.ok(Math.abs(r.depois - t[n.chave]) <= t[n.chave] * 0.03,
      `${n.chave}: real ${r.depois} x estimado ${t[n.chave]}`);
  }
});
