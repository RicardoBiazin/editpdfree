import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicar, concatenar, deslocamentoPaginaParaPdf, inverter, paginaParaPdf, paginaParaTela,
  pdfParaPagina, retanguloTelaParaPagina, telaParaPagina, type Matriz, type Ponto,
} from "../src/core/coordenadas.ts";
import { geometria } from "../src/core/documento.ts";
import { renderizar } from "../src/core/render.ts";
import { forma } from "../src/core/anotacoes.ts";
import { inserirImagem, inserirTexto } from "../src/core/conteudo.ts";
import { trechoEm } from "../src/core/texto.ts";
import { pngTeste, reabrir, sessao } from "./fixtures.ts";

const ROTACOES = [0, 90, 180, 270] as const;

function perto(a: number, b: number, tol: number, msg: string) {
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b} (tolerância ${tol})`);
}

/** Caixa dos pixels escuros (e de uma cor, se dada) no render. */
function caixaEscura(img: { largura: number; altura: number; rgba: Uint8ClampedArray },
  teste = (r: number, g: number, b: number) => r < 60 && g < 60 && b < 60) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.altura; y++) {
    for (let x = 0; x < img.largura; x++) {
      const o = (y * img.largura + x) * 4;
      if (teste(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2])) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

test("matrizes: inverter e concatenar", () => {
  const m: Matriz = [0, 1, -1, 0, 30, 40];
  const p: Ponto = [3, 7];
  const ida = aplicar(m, p);
  const volta = aplicar(inverter(m), ida);
  perto(volta[0], 3, 1e-9, "x");
  perto(volta[1], 7, 1e-9, "y");
  const c = concatenar(m, inverter(m));
  [1, 0, 0, 1, 0, 0].forEach((v, i) => perto(c[i], v, 1e-9, `identidade[${i}]`));
});

for (const rot of ROTACOES) {
  test(`página girada ${rot}°: pixel renderizado <-> espaço PDF`, () => {
    // Quadrado preto de 40 pt em (100, 600) no espaco PDF (y para cima).
    const s = sessao([{ rotacao: rot, largura: 400, altura: 800, marcador: [100, 600, 40] }]);
    const p = s.pagina(0);
    const g = geometria(p);
    assert.equal(g.rotacao, rot);
    const zoom = 2;
    const img = renderizar(p, zoom);
    const c = caixaEscura(img);
    // Centro do quadrado na tela -> PDF
    const centroTela: Ponto = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];
    const pdf = paginaParaPdf(g, telaParaPagina(g, centroTela[0], centroTela[1], zoom));
    perto(pdf[0], 120, 1, "x PDF");
    perto(pdf[1], 620, 1, "y PDF");
    // E o caminho inverso.
    const tela = paginaParaTela(g, pdfParaPagina(g, [120, 620]), zoom);
    perto(tela[0], centroTela[0], 2, "x tela");
    perto(tela[1], centroTela[1], 2, "y tela");
    // Retangulo arrastado na tela cobre o quadrado inteiro no espaco pagina.
    const r = retanguloTelaParaPagina(g, c.x1, c.y1, c.x0, c.y0, zoom);
    perto(r[2] - r[0], 40, 1, "largura");
    perto(r[3] - r[1], 40, 1, "altura");
  });

  test(`página girada ${rot}°: anotação criada pelo arrasto na tela cai no lugar certo`, () => {
    const s = sessao([{ rotacao: rot, largura: 400, altura: 800, marcador: [100, 600, 40] }]);
    const zoom = 1.5;
    let p = s.pagina(0);
    let g = geometria(p);
    const c = caixaEscura(renderizar(p, zoom));
    const r = retanguloTelaParaPagina(g, c.x0, c.y0, c.x1, c.y1, zoom);
    const id = forma(s, 0, "retangulo", [r[0], r[1]], [r[2], r[3]],
      { cor: [1, 0, 0], espessura: 1, opacidade: 1, tamanhoFonte: 12 });
    const s2 = reabrir(s);
    p = s2.pagina(0);
    g = geometria(p);
    const a = p.getAnnotations().find((x) => x.getObject().asIndirect() === id)!;
    // /Rect bruto no arquivo esta' no espaco PDF: deve envolver o quadrado.
    const bruto = a.getObject().get("Rect");
    const vals = [0, 1, 2, 3].map((i) => bruto.get(i).asNumber());
    const x0 = Math.min(vals[0], vals[2]), x1 = Math.max(vals[0], vals[2]);
    const y0 = Math.min(vals[1], vals[3]), y1 = Math.max(vals[1], vals[3]);
    perto((x0 + x1) / 2, 120, 1.5, "centro x do /Rect");
    perto((y0 + y1) / 2, 620, 1.5, "centro y do /Rect");
  });

  test(`página girada ${rot}°: deslocamento pagina -> PDF`, () => {
    const s = sessao([{ rotacao: rot, largura: 400, altura: 800 }]);
    const g = geometria(s.pagina(0));
    const a = paginaParaPdf(g, [50, 60]);
    const b = paginaParaPdf(g, [50 + 10, 60 + 5]);
    const d = deslocamentoPaginaParaPdf(g, 10, 5);
    perto(d[0], b[0] - a[0], 1e-9, "dx");
    perto(d[1], b[1] - a[1], 1e-9, "dy");
  });

  test(`página girada ${rot}°: texto novo sai de pé e na linha de base pedida`, () => {
    const s = sessao([{ rotacao: rot, largura: 400, altura: 800 }]);
    inserirTexto(s, 0, [60, 100], "Olá, ação", { tamanho: 20 });
    const t = trechoEm(s.pagina(0), 0, [70, 95]);
    assert.ok(t, "a linha deve ser encontrada onde foi escrita");
    assert.equal(t.texto, "Olá, ação");
    assert.ok(t.horizontal, "texto deve estar horizontal para o leitor");
    perto(t.origem[0], 60, 1, "x da origem");
    perto(t.origem[1], 100, 1, "y da origem");
    perto(t.tamanho, 20, 0.5, "tamanho");
  });

  test(`página girada ${rot}°: imagem inserida sai de pé`, () => {
    const s = sessao([{ rotacao: rot, largura: 400, altura: 800 }]);
    // Imagem quadrada: metade de cima escura (azul), de baixo branca.
    inserirImagem(s, 0, [100, 100, 200, 200], pngTeste(40, 40, true));
    const img = renderizar(s.pagina(0), 1);
    const c = caixaEscura(img, (r, g, b) => b > 150 && r < 80);
    perto(c.x0, 100, 2, "esquerda");
    perto(c.x1, 200, 2, "direita");
    perto(c.y0, 100, 2, "topo");
    perto(c.y1, 150, 2, "a parte escura é a de cima");
  });
}

