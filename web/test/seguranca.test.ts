import { test } from "node:test";
import assert from "node:assert/strict";
import { buscar, extrairTexto, tarjar, tarjarTexto } from "../src/core/seguranca.ts";
import { renderizar } from "../src/core/render.ts";
import { reabrir, sessao, textoDaPagina } from "./fixtures.ts";

test("tarja REMOVE o texto do arquivo (não é um retângulo por cima)", () => {
  const s = sessao([{ linhas: ["Nome: Fulano de Tal", "CPF 123.456.789-00", "Rodapé intacto"] }]);
  // A primeira linha fica em y ~ 58..76 no espaco pagina.
  const n = tarjar(s, [{ pagina: 0, rect: [60, 55, 400, 78] }]);
  assert.equal(n, 1);
  const s2 = reabrir(s);
  const t = textoDaPagina(s2, 0);
  assert.doesNotMatch(t, /Fulano/);
  assert.match(t, /CPF 123/);
  assert.match(t, /Rodapé intacto/);
  // E a area ficou preta no render.
  const img = renderizar(s2.pagina(0), 1);
  const o = (65 * img.largura + 100) * 4;
  assert.ok(img.rgba[o] < 30 && img.rgba[o + 1] < 30, "a área tarjada é preta");
  // Nao sobra anotacao de redacao pendente.
  assert.equal(s2.pagina(0).getAnnotations().length, 0);
});

test("tarja apaga os pixels da imagem sob ela", () => {
  // Imagem de 200x200 pt em (100, 400)-(300, 600) no espaco PDF.
  const s = sessao([{ imagem: [100, 400, 300, 600] }]);
  const antes = renderizar(s.pagina(0), 1);
  // Espaco pagina: y = 842 - y_pdf -> imagem em y 242..442.
  tarjar(s, [{ pagina: 0, rect: [150, 300, 250, 380] }]);
  const s2 = reabrir(s);
  // Esconde a caixa preta desenhada por cima: o que conta e' o pixel da
  // IMAGEM, entao renderiza e confere que a imagem mudou (a tarja e' preta,
  // a imagem era azulada), e que a imagem continua fora da area.
  const depois = renderizar(s2.pagina(0), 1);
  const px = (img: typeof antes, x: number, y: number) => {
    const o = (y * img.largura + x) * 4;
    return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
  };
  assert.notDeepEqual(px(depois, 200, 340), px(antes, 200, 340), "pixel sob a tarja mudou");
  assert.deepEqual(px(depois, 120, 260), px(antes, 120, 260), "pixel fora da tarja não mudou");
  // Confere no proprio objeto de imagem: os pixels do meio nao sao mais o azul.
  const p = s2.pagina(0);
  const xobjs = p.getObject().getInheritable("Resources").get("XObject");
  let imagemAlterada = false;
  xobjs.forEach((ref) => {
    const img = s2.doc.loadImage(ref);
    const pix = img.toPixmap();
    const w = pix.getWidth(), h = pix.getHeight(), n = pix.getNumberOfComponents();
    const d = pix.getPixels();
    const o = (Math.floor(h * 0.3) * w + Math.floor(w / 2)) * n;
    if (!(d[o] === 20 && d[o + 1] === 120 && d[o + 2] === 200)) imagemAlterada = true;
  });
  assert.ok(imagemAlterada, "os bytes da imagem no arquivo foram alterados");
});

test("tarjar todas as ocorrências de um texto", () => {
  const s = sessao([
    { linhas: ["CPF 111.222.333-44 aparece aqui", "e mais nada"] },
    { linhas: ["outra página", "de novo 111.222.333-44"] },
  ]);
  assert.equal(buscar(s.doc, "111.222.333-44").length, 2);
  const n = tarjarTexto(s, "111.222.333-44");
  assert.equal(n, 2);
  const s2 = reabrir(s);
  const t = extrairTexto(s2.doc);
  assert.doesNotMatch(t, /111\.222/);
  assert.match(t, /aparece aqui/);
  assert.match(t, /outra página/);
  assert.equal(tarjarTexto(s2, "inexistente"), 0);
  assert.equal(s2.podeDesfazer, null);
});

test("busca devolve páginas e retângulos, sem diferenciar maiúsculas", () => {
  const s = sessao([{ linhas: ["Contrato de Locação", "contrato"] }, { linhas: ["nada"] }, { linhas: ["CONTRATO final"] }]);
  const r = buscar(s.doc, "contrato");
  assert.deepEqual(r.map((x) => x.pagina), [0, 0, 2]);
  assert.ok(r[0].rect[2] > r[0].rect[0]);
  assert.deepEqual(buscar(s.doc, "  "), []);
  assert.equal(buscar(s.doc, "locacao").length, 0);
  assert.equal(buscar(s.doc, "locacao", true).length, 1, "sem acento acha 'Locação'");
});
