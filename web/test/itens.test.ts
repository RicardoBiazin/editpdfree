import { test } from "node:test";
import assert from "node:assert/strict";
import { renderizar } from "../src/core/render.ts";
import { excluirAnotacao, listarAnotacoes, moverAnotacao } from "../src/core/anotacoes.ts";
import { inserirImagem, inserirTexto } from "../src/core/conteudo.ts";
import { trechoEm } from "../src/core/texto.ts";
import { pngTeste, reabrir, sessao, textoDaPagina } from "./fixtures.ts";

function perto(a: number, b: number, tol: number, msg: string) {
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b} (tolerância ${tol})`);
}

/** Caixa dos pixels azuis (a imagem de teste), em pontos (escala 1). */
function caixaAzul(img: { largura: number; altura: number; rgba: Uint8ClampedArray }) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.altura; y++) {
    for (let x = 0; x < img.largura; x++) {
      const o = (y * img.largura + x) * 4;
      if (img.rgba[o + 2] > 150 && img.rgba[o] < 80) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

for (const rot of [0, 90] as const) {
  test(`página ${rot}°: texto inserido aparece como item e é arrastado`, () => {
    const s = sessao([{ rotacao: rot, linhas: ["fixo"] }]);
    const id = inserirTexto(s, 0, [100, 200], "Ricardo Biazin", { tamanho: 14, cor: [1, 0, 0] });
    const item = listarAnotacoes(s.pagina(0)).find((a) => a.id === id);
    assert.ok(item, "o texto inserido é listado");
    assert.equal(item.movel, true);
    assert.equal(item.nome, "Texto inserido");
    perto(item.limites[0], 100, 0.5, "caixa começa no x do texto");
    assert.ok(item.limites[1] < 200 && item.limites[3] > 200, "caixa envolve a linha de base");

    moverAnotacao(s, 0, id, 50, -30);
    const s2 = reabrir(s);
    const t = trechoEm(s2.pagina(0), 0, [160, 166]);
    assert.ok(t, "o texto está no lugar novo");
    assert.equal(t.texto, "Ricardo Biazin");
    perto(t.origem[0], 150, 0.5, "x novo");
    perto(t.origem[1], 170, 0.5, "y novo");
    assert.equal(trechoEm(s2.pagina(0), 0, [110, 196]), null, "saiu do lugar antigo");
    // Salvar renumera os objetos: procura pelo tipo.
    const depois = listarAnotacoes(s2.pagina(0)).find((a) => a.tipo === "ItemTexto")!;
    perto(depois.limites[0], 150, 0.5, "a caixa acompanha (e sobrevive ao salvar)");
    perto(depois.limites[1], item.limites[1] - 30, 0.5, "a caixa acompanha no y");
  });
}

test("imagem e assinatura inseridas também são arrastadas", () => {
  const s = sessao([{}]);
  const id = inserirImagem(s, 0, [100, 100, 200, 200], pngTeste(40, 40, false), "Assinatura");
  const item = listarAnotacoes(s.pagina(0)).find((a) => a.id === id)!;
  assert.equal(item.nome, "Assinatura");
  moverAnotacao(s, 0, id, 120, 80);
  const c = caixaAzul(renderizar(reabrir(s).pagina(0), 1));
  perto(c.x0, 220, 2, "esquerda");
  perto(c.y0, 180, 2, "topo");
  perto(c.x1, 320, 2, "direita");
});

test("excluir o item tira só ele; desfazer devolve", () => {
  const s = sessao([{ linhas: ["fixo"] }]);
  const a = inserirTexto(s, 0, [100, 200], "Primeiro");
  inserirTexto(s, 0, [100, 300], "Segundo");
  excluirAnotacao(s, 0, a);
  let t = textoDaPagina(reabrir(s), 0);
  assert.doesNotMatch(t, /Primeiro/);
  assert.match(t, /Segundo/);
  assert.match(t, /fixo/);
  s.desfazer();
  t = textoDaPagina(reabrir(s), 0);
  assert.match(t, /Primeiro/);
});
