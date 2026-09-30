import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar, opcodes, rotulo } from "../src/core/comparar.ts";
import { sessao } from "./fixtures.ts";

test("opcodes iguais aos do difflib do Python (autojunk=False)", () => {
  // Referencia gerada com difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes()
  assert.deepEqual(opcodes("o gato de botas de couro de verdade".split(" "),
    "o gato preto de botas de couro de mentira de verdade".split(" ")),
  [["equal", 0, 2, 0, 2], ["insert", 2, 2, 2, 3], ["equal", 2, 7, 3, 8], ["insert", 7, 7, 8, 10], ["equal", 7, 8, 10, 11]]);
  assert.deepEqual(opcodes("a b c d e f g".split(" "), "x a c d y f g z".split(" ")),
    [["insert", 0, 0, 0, 1], ["equal", 0, 1, 1, 2], ["delete", 1, 2, 2, 2], ["equal", 2, 4, 2, 4],
      ["replace", 4, 5, 4, 5], ["equal", 5, 7, 5, 7], ["insert", 7, 7, 7, 8]]);
  assert.deepEqual(opcodes([], []), []);
});

test("palavras frequentes não atrapalham o alinhamento (sem autojunk)", () => {
  // 400 repeticoes de "de" + uma troca no meio: com autojunk o difflib erraria.
  const a = Array.from({ length: 400 }, (_, i) => (i % 2 ? "de" : `p${i}`));
  const b = [...a];
  b[201] = "da";
  const ops = opcodes(a, b).filter((o) => o[0] !== "equal");
  assert.deepEqual(ops, [["replace", 201, 202, 201, 202]]);
});

test("comparar o documento inteiro: parágrafo inserido não marca o resto", () => {
  const a = sessao([
    { linhas: ["Cláusula primeira do contrato", "O valor é de cem reais"] },
    { linhas: ["Cláusula segunda", "Prazo de trinta dias"] },
  ]);
  const b = sessao([
    { linhas: ["Cláusula primeira do contrato", "Parágrafo novo inserido aqui", "O valor é de cem reais"] },
    { linhas: ["Cláusula segunda", "Prazo de sessenta dias"] },
  ]);
  const d = comparar(a.doc, b.doc);
  assert.equal(d.length, 2, JSON.stringify(d.map(rotulo)));
  assert.equal(d[0].tipo, "inserido");
  assert.equal(d[0].textoB, "Parágrafo novo inserido aqui");
  assert.equal(d[0].emB.length, 1, "uma caixa por linha");
  assert.equal(d[0].emB[0].pagina, 0);
  assert.equal(d[1].tipo, "alterado");
  assert.equal(rotulo(d[1]), "trinta → sessenta");
  assert.equal(d[1].emA[0].pagina, 1);
  assert.equal(d[1].emB[0].pagina, 1);
  const r = d[1].emB[0].rect;
  assert.ok(r[2] - r[0] > 20 && r[3] - r[1] > 8, "retângulo da palavra");
});

test("texto que muda de página continua igual (comparação não é página a página)", () => {
  const a = sessao([{ linhas: ["um dois três"] }, { linhas: ["quatro cinco"] }]);
  const b = sessao([{ linhas: ["um dois"] }, { linhas: ["três quatro cinco"] }]);
  assert.deepEqual(comparar(a.doc, b.doc), []);
});

test("removido e maiúsculas contam", () => {
  const a = sessao([{ linhas: ["Não aceito os termos"] }]);
  const b = sessao([{ linhas: ["não aceito termos"] }]);
  const d = comparar(a.doc, b.doc);
  assert.deepEqual(d.map(rotulo), ["Não → não", "− os"]);
});
