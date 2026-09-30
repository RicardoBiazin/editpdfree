import { test } from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { Sessao, bytesDoBuffer } from "../src/core/documento.ts";
import { carimbo, definirMetadados, linksDaPagina, marcadores, metadados, substituirEmTudo } from "../src/core/mais.ts";
import { numerar } from "../src/core/extras.ts";
import { listarAnotacoes } from "../src/core/anotacoes.ts";
import { renderizar } from "../src/core/render.ts";
import { reabrir, sessao, textoDaPagina } from "./fixtures.ts";

test("substituir texto em todo o documento", () => {
  const s = sessao([{ linhas: ["Contratante: Empresa X", "A Empresa X paga"] }, { linhas: ["Assina: Empresa X"] }]);
  assert.equal(substituirEmTudo(s, "Empresa X", "Companhia Ypsilon"), 3);
  const s2 = reabrir(s);
  const t = textoDaPagina(s2, 0) + textoDaPagina(s2, 1);
  assert.doesNotMatch(t, /Empresa X/);
  assert.equal((t.match(/Companhia Ypsilon/g) ?? []).length, 3);
  assert.match(t, /Contratante:/);
  assert.equal(substituirEmTudo(s2, "inexistente", "x"), 0);
  s.desfazer();
  assert.match(textoDaPagina(s, 0), /Empresa X/, "um desfazer só");
});

test("propriedades do documento (metadados)", () => {
  const s = sessao([{}]);
  assert.equal(definirMetadados(s, { titulo: "Relatório 2026", autor: "Ana Lúcia" }), true);
  const m = metadados(reabrir(s).doc);
  assert.equal(m.titulo, "Relatório 2026");
  assert.equal(m.autor, "Ana Lúcia");
  assert.equal(definirMetadados(s, { titulo: "Relatório 2026" }), false, "sem mudança");
});

test("cabeçalho/rodapé com {arquivo} e {data}", () => {
  const s = sessao([{}, {}], "ata.pdf");
  numerar(s, { formato: "{arquivo} · {data} · pág. {n}/{total}", posicao: "superior-direita", data: "30/09/2026" });
  assert.match(textoDaPagina(reabrir(s), 1), /ata\.pdf · 30\/09\/2026 · pág\. 2\/2/);
});

test("carimbo: anotação móvel, com o texto, de pé em qualquer rotação", () => {
  for (const rot of [0, 90, 180, 270] as const) {
    const s = sessao([{ rotacao: rot }]);
    const id = carimbo(s, 0, [200, 150], "Aprovado");
    const s2 = reabrir(s);
    const a = listarAnotacoes(s2.pagina(0)).find((x) => x.id === id)!;
    assert.equal(a.tipo, "Stamp");
    assert.equal(a.texto, "APROVADO");
    const [x0, y0, x1, y1] = a.limites;
    assert.ok(Math.abs((x0 + x1) / 2 - 200) < 1 && Math.abs((y0 + y1) / 2 - 150) < 1, `rot ${rot}: centro`);
    assert.ok(x1 - x0 > y1 - y0, `rot ${rot}: mais largo que alto, como o leitor vê`);
    // Pixels vermelhos dentro da caixa (a aparencia e' a nossa, nao "DRAFT").
    const img = renderizar(s2.pagina(0), 1);
    let vermelhos = 0;
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const o = (y * img.largura + x) * 4;
      if (img.rgba[o] > 150 && img.rgba[o + 1] < 90) vermelhos++;
    }
    assert.ok(vermelhos > 100, `rot ${rot}: ${vermelhos} pixels vermelhos`);
  }
});

test("marcadores e links", () => {
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < 3; i++) doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, {}, ""));
  const p0 = doc.findPage(0), p2 = doc.findPage(2);
  const filho = doc.addObject({ Title: "(1.1 Detalhe)", Dest: [p2, "Fit"] });
  const pai = doc.addObject({ Title: "(1 Introdução)", Dest: [p0, "Fit"], First: filho, Last: filho, Count: 1 });
  filho.put("Parent", pai);
  const raiz = doc.addObject({ Type: "Outlines", First: pai, Last: pai, Count: 2 });
  pai.put("Parent", raiz);
  doc.getTrailer().get("Root").put("Outlines", raiz);
  const pag = doc.loadPage(0);
  pag.createLink([10, 10, 100, 30], "https://exemplo.org/");
  pag.createLink([10, 50, 100, 70], "#page=3");
  const s = Sessao.abrir(bytesDoBuffer(doc.saveToBuffer("")), "m.pdf");
  const m = marcadores(s.doc);
  assert.deepEqual(m.map((x) => [x.titulo, x.nivel, x.pagina]), [["1 Introdução", 0, 0], ["1.1 Detalhe", 1, 2]]);
  const l = linksDaPagina(s.doc, s.pagina(0));
  assert.equal(l.length, 2);
  const ext = l.find((x) => x.externo)!;
  assert.equal(ext.uri, "https://exemplo.org/");
  assert.equal(l.find((x) => !x.externo)!.destino, 2);
});
