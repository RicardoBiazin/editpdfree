import { test } from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { Sessao, bytesDoBuffer } from "../src/core/documento.ts";
import { criarCampos, detectarCampos } from "../src/core/criarcampos.ts";
import { listarCampos, preencherCampo } from "../src/core/formularios.ts";
import { codificarWinAnsi } from "../src/core/conteudo.ts";
import { criarFormulario, ficha, reabrir, sessao } from "./fixtures.ts";

test("criar campo de texto e caixa de seleção; preencher; persistem", () => {
  for (const rot of [0, 90] as const) {
    const s = sessao([{ rotacao: rot, linhas: ["Ficha"] }]);
    const [idT, idC] = criarCampos(s, [
      { pagina: 0, tipo: "texto", rect: [100, 100, 300, 122] },
      { pagina: 0, tipo: "caixa", rect: [100, 150, 114, 164] },
    ]);
    assert.ok(idT > 0 && idC > 0);
    let campos = listarCampos(s.pagina(0), 0);
    const t = campos.find((c) => c.id === idT)!;
    assert.equal(t.tipo, "texto");
    assert.equal(t.nome, "texto1");
    assert.ok(Math.abs(t.limites[0] - 100) < 1 && Math.abs(t.limites[1] - 100) < 1, `rot ${rot}: posição ${t.limites}`);
    assert.equal(campos.find((c) => c.id === idC)!.tipo, "caixa");
    preencherCampo(s, 0, idT, "Maria José");
    preencherCampo(s, 0, idC, true);
    const s2 = reabrir(s);
    campos = listarCampos(s2.pagina(0), 0);
    assert.equal(campos.find((c) => c.tipo === "texto")!.valor, "Maria José");
    assert.equal(campos.find((c) => c.tipo === "caixa")!.marcado, true);
    assert.ok(!s2.doc.getTrailer().get("Root").get("AcroForm").get("Fields").isNull());
  }
});

test("campos novos num PDF que já tem formulário ganham nomes livres", () => {
  const s = Sessao.abrir(criarFormulario(), "f.pdf");
  criarCampos(s, [{ pagina: 0, tipo: "texto", rect: [300, 300, 400, 320], nome: "nome" }]);
  const nomes = listarCampos(s.pagina(0), 0).map((c) => c.nome).sort();
  assert.deepEqual(nomes, ["aceito", "cor", "nome", "texto1"], "“nome” já existia: vira texto1");
  s.desfazer();
  assert.equal(listarCampos(s.pagina(0), 0).length, 3);
  assert.throws(() => criarCampos(s, [{ pagina: 0, tipo: "texto", rect: [10, 10, 11, 11] }]), /pequeno demais/);
});

test("detectar campos: sublinhados, rótulo com dois-pontos e quadrado vazio", () => {
  const s = Sessao.abrir(ficha(), "ficha.pdf");
  const sug = detectarCampos(s.pagina(0), 0);
  const resumo = sug.map((x) => `${x.tipo}:${x.motivo}`);
  assert.equal(sug.length, 3, resumo.join(" | "));
  const sub = sug.find((x) => x.motivo === "linha de sublinhados")!;
  assert.equal(sub.tipo, "texto");
  assert.ok(sub.rect[0] > 100 && sub.rect[3] > 70 && sub.rect[3] < 90, `sublinhado ${sub.rect}`);
  const cidade = sug.find((x) => x.motivo.includes("Cidade"))!;
  assert.equal(cidade.tipo, "texto");
  assert.ok(cidade.rect[0] > 110 && cidade.rect[2] - cidade.rect[0] >= 200);
  const caixa = sug.find((x) => x.tipo === "caixa")!;
  assert.ok(Math.abs(caixa.rect[0] - 72) < 1 && Math.abs(caixa.rect[1] - (842 - 690)) < 1, `caixa ${caixa.rect}`);
  // Criar as sugestoes: depois disso, detectar de novo nao repete nada.
  criarCampos(s, sug);
  assert.equal(listarCampos(s.pagina(0), 0).length, 3);
  assert.deepEqual(detectarCampos(s.pagina(0), 0), []);
});
