import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anotacaoEm, caneta, excluirAnotacao, forma, listarAnotacoes, marcarTexto, moverAnotacao,
  nota, quadsDasPalavras, textoLivre, type Estilo,
} from "../src/core/anotacoes.ts";
import { retanguloDoQuad } from "../src/core/coordenadas.ts";
import { reabrir, sessao } from "./fixtures.ts";

const ESTILO: Estilo = { cor: [0.1, 0.4, 0.9], espessura: 3, opacidade: 0.6, tamanhoFonte: 14 };

test("todas as anotações persistem depois de salvar e reabrir", () => {
  const s = sessao([{ linhas: ["Linha um do texto", "Linha dois do texto", "Linha três"] }]);
  textoLivre(s, 0, [300, 300, 500, 340], "Caixa de texto\ncom acento: ção", ESTILO);
  nota(s, 0, [400, 400], "Uma nota", ESTILO);
  assert.equal(marcarTexto(s, 0, [60, 60, 300, 110], "destacar", ESTILO), true);
  assert.equal(marcarTexto(s, 0, [60, 110, 300, 125], "sublinhar", ESTILO), true);
  assert.equal(marcarTexto(s, 0, [60, 60, 100, 80], "tachar", ESTILO), true);
  caneta(s, 0, [[[100, 500], [150, 520], [200, 510]], [[100, 600], [120, 620]]], ESTILO);
  forma(s, 0, "retangulo", [100, 650], [200, 700], ESTILO);
  forma(s, 0, "elipse", [250, 650], [350, 700], ESTILO);
  forma(s, 0, "linha", [100, 750], [300, 760], ESTILO);
  forma(s, 0, "seta", [100, 780], [300, 790], ESTILO);

  const s2 = reabrir(s);
  const tipos = listarAnotacoes(s2.pagina(0)).map((a) => a.tipo).sort();
  assert.deepEqual(tipos, ["Circle", "FreeText", "Highlight", "Ink", "Line", "Line", "Square",
    "StrikeOut", "Text", "Underline"].sort());
  const p = s2.pagina(0);
  const ft = p.getAnnotations().find((a) => a.getType() === "FreeText")!;
  assert.equal(ft.getContents(), "Caixa de texto\ncom acento: ção");
  const sq = p.getAnnotations().find((a) => a.getType() === "Square")!;
  assert.deepEqual(sq.getColor().map((v) => Math.round(v * 10) / 10), [0.1, 0.4, 0.9]);
  assert.equal(sq.getBorderWidth(), 3);
  assert.ok(Math.abs(sq.getOpacity() - 0.6) < 0.01);
  const seta = p.getAnnotations().filter((a) => a.getType() === "Line")
    .find((a) => a.getLineEndingStyles().end === "ClosedArrow");
  assert.ok(seta, "a seta guarda a ponta");
  const ink = p.getAnnotations().find((a) => a.getType() === "Ink")!;
  assert.equal(ink.getInkList().length, 2);
});

test("destaque: um quad por LINHA, só nas palavras tocadas", () => {
  const s = sessao([{ linhas: ["alfa beta gama delta", "epsilon zeta eta"] }]);
  const p = s.pagina(0);
  // Retangulo pegando so' "beta gama" da linha 1 e "zeta" da linha 2
  // (x da linha: 72 + ...; Helvetica 14).
  const quads = quadsDasPalavras(p, [110, 60, 170, 110]);
  assert.equal(quads.length, 2, "uma caixa por linha");
  const r1 = retanguloDoQuad(quads[0]);
  assert.ok(r1[0] > 95, "não começa em 'alfa' (que termina em ~94,6)");
  assert.ok(r1[2] - r1[0] > 40, "cobre mais de uma palavra");
  // Sem texto na area: nao cria nada.
  assert.equal(marcarTexto(s, 0, [400, 400, 500, 500], "destacar", ESTILO), false);
  assert.equal(s.podeDesfazer, null);
});

test("mover anotação desloca o desenho (também em página girada)", () => {
  for (const rot of [0, 90, 180, 270] as const) {
    const s = sessao([{ rotacao: rot }]);
    const idR = forma(s, 0, "retangulo", [100, 100], [200, 150], ESTILO);
    const idI = caneta(s, 0, [[[300, 300], [350, 330]]], ESTILO)!;
    const antes = listarAnotacoes(s.pagina(0));
    moverAnotacao(s, 0, idR, 30, -20);
    moverAnotacao(s, 0, idI, -50, 40);
    const s2 = reabrir(s);
    const depois = listarAnotacoes(s2.pagina(0));
    for (const [id, dx, dy] of [[idR, 30, -20], [idI, -50, 40]] as const) {
      const a = antes.find((x) => x.id === id)!.limites;
      const b = depois.find((x) => x.id === id)!.limites;
      assert.ok(Math.abs(b[0] - a[0] - dx) < 0.6 && Math.abs(b[1] - a[1] - dy) < 0.6,
        `rot ${rot}, id ${id}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
    const ink = s2.pagina(0).getAnnotations().find((a) => a.getType() === "Ink")!;
    const pt = ink.getInkList()[0][0];
    assert.ok(Math.abs(pt[0] - 250) < 0.6 && Math.abs(pt[1] - 340) < 0.6, `rot ${rot}: /InkList movido ${pt}`);
  }
});

test("marcação de texto não se move", () => {
  const s = sessao([{ linhas: ["texto para destacar"] }]);
  marcarTexto(s, 0, [60, 60, 300, 80], "destacar", ESTILO);
  const id = listarAnotacoes(s.pagina(0))[0].id;
  assert.throws(() => moverAnotacao(s, 0, id, 10, 10), /presas ao texto/);
});

test("selecionar pelo ponto e excluir", () => {
  const s = sessao([{}]);
  forma(s, 0, "retangulo", [100, 100], [200, 200], ESTILO);
  const id = forma(s, 0, "elipse", [150, 150], [250, 250], ESTILO);
  const achada = anotacaoEm(s.pagina(0), [175, 175]);
  assert.equal(achada?.id, id, "a de cima");
  assert.equal(anotacaoEm(s.pagina(0), [400, 400]), null);
  excluirAnotacao(s, 0, id);
  const s2 = reabrir(s);
  assert.deepEqual(listarAnotacoes(s2.pagina(0)).map((a) => a.tipo), ["Square"]);
  s.desfazer();
  assert.equal(listarAnotacoes(s.pagina(0)).length, 2);
});

test("caixa de texto em página girada fica de pé (/Rotate)", () => {
  const s = sessao([{ rotacao: 90 }]);
  textoLivre(s, 0, [100, 100, 300, 140], "Olá", ESTILO);
  const a = s.pagina(0).getAnnotations()[0];
  assert.equal(a.getObject().get("Rotate").asNumber(), 90);
});
