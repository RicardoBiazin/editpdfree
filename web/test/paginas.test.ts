import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessao } from "../src/core/documento.ts";
import {
  dividir, duplicar, excluir, extrair, girar, gruposACada, inserirArquivo, inserirEmBranco,
  juntar, lerIntervalos, ordemAoMover, reordenar,
} from "../src/core/paginas.ts";
import { forma } from "../src/core/anotacoes.ts";
import { tarjar } from "../src/core/seguranca.ts";
import { criarPdf, pngTeste, reabrir, sessao, textoDaPagina } from "./fixtures.ts";

const ESTILO = { cor: [0, 0, 1] as [number, number, number], espessura: 2, opacidade: 1, tamanhoFonte: 12 };

function tresPaginas() {
  return sessao([{ linhas: ["Página A"] }, { linhas: ["Página B"] }, { linhas: ["Página C"] }]);
}

function ordemDeTextos(s: Sessao): string[] {
  return [...Array(s.paginas).keys()].map((i) => (textoDaPagina(s, i).match(/Página (\w)/)?.[1] ?? "?"));
}

test("girar à direita e à esquerda, com persistência", () => {
  const s = tresPaginas();
  girar(s, [0, 2], 90);
  girar(s, [2], -180);
  const s2 = reabrir(s);
  const rot = (i: number) => s2.pagina(i).getObject().getInheritable("Rotate").asNumber();
  assert.equal(rot(0), 90);
  assert.equal(s2.pagina(1).getObject().getInheritable("Rotate").isNull() ? 0 : rot(1), 0);
  assert.equal(rot(2), 270);
});

test("excluir páginas; não deixa excluir todas", () => {
  const s = tresPaginas();
  excluir(s, [1]);
  assert.deepEqual(ordemDeTextos(reabrir(s)), ["A", "C"]);
  assert.throws(() => excluir(s, [0, 1]), /pelo menos uma página/);
});

test("reordenar e mover", () => {
  const s = tresPaginas();
  reordenar(s, [2, 0, 1]);
  assert.deepEqual(ordemDeTextos(reabrir(s)), ["C", "A", "B"]);
  assert.throws(() => reordenar(s, [0, 0, 1]), /cada página uma vez/);
  assert.deepEqual(ordemAoMover(5, [0], 2), [1, 2, 0, 3, 4]);
  assert.deepEqual(ordemAoMover(5, [3, 4], 0), [3, 4, 0, 1, 2]);
  assert.deepEqual(ordemAoMover(5, [1], 99), [0, 2, 3, 4, 1]);
});

test("duplicar cria uma cópia INDEPENDENTE (com anotações)", () => {
  const s = tresPaginas();
  forma(s, 1, "retangulo", [50, 50], [150, 150], ESTILO);
  duplicar(s, 1);
  assert.deepEqual(ordemDeTextos(s), ["A", "B", "B", "C"]);
  assert.equal(s.pagina(2).getAnnotations().length, 1, "a cópia leva a anotação");
  // Tarjar a copia nao pode apagar o original.
  tarjar(s, [{ pagina: 2, rect: [0, 0, 595, 842] }]);
  const s2 = reabrir(s);
  assert.match(textoDaPagina(s2, 1), /Página B/);
  assert.doesNotMatch(textoDaPagina(s2, 2), /Página B/);
  assert.equal(s2.pagina(1).getAnnotations().length, 1);
});

test("inserir página em branco do tamanho da vizinha", () => {
  const s = sessao([{ largura: 300, altura: 500 }, {}]);
  inserirEmBranco(s, 1);
  assert.equal(s.paginas, 3);
  const b = s.pagina(1).getBounds();
  assert.deepEqual([b[2] - b[0], b[3] - b[1]], [300, 500]);
  inserirEmBranco(s, 99, 100, 100);
  assert.deepEqual(s.pagina(3).getBounds(), [0, 0, 100, 100]);
});

test("inserir outro PDF (juntar) mantém as anotações dele", () => {
  const s = tresPaginas();
  const outro = sessao([{ linhas: ["Página X"] }, { linhas: ["Página Y"] }]);
  forma(outro, 0, "elipse", [10, 10], [90, 90], ESTILO);
  const n = inserirArquivo(s, outro.salvar(), "outro.pdf", 1);
  assert.equal(n, 2);
  const s2 = reabrir(s);
  assert.deepEqual(ordemDeTextos(s2), ["A", "X", "Y", "B", "C"]);
  assert.equal(s2.pagina(1).getAnnotations()[0]?.getType(), "Circle");
  // no fim
  inserirArquivo(s, pngTeste(), "img.png", 999);
  assert.equal(s.paginas, 6);
});

test("inserir PDF protegido por senha dá erro legível", () => {
  const p = sessao([{}]);
  p.proteger("x");
  const s = tresPaginas();
  assert.throws(() => inserirArquivo(s, p.salvar(), "p.pdf", 0), /protegido por senha/);
  assert.equal(s.paginas, 3);
});

test("extrair páginas para um novo PDF", () => {
  const s = tresPaginas();
  const bytes = extrair(s, [2, 0]);
  const e = Sessao.abrir(bytes, "e.pdf");
  assert.deepEqual(ordemDeTextos(e), ["C", "A"]);
  assert.equal(s.paginas, 3, "o original não muda");
});

test("juntar vários arquivos", () => {
  const a = criarPdf([{ linhas: ["Página A"] }]);
  const b = criarPdf([{ linhas: ["Página B"] }, { linhas: ["Página C"] }]);
  const j = Sessao.abrir(juntar([{ bytes: a, nome: "a.pdf" }, { bytes: b, nome: "b.pdf" }]), "j.pdf");
  assert.deepEqual(ordemDeTextos(j), ["A", "B", "C"]);
});

test("ler intervalos", () => {
  assert.deepEqual(lerIntervalos("1-3, 5, 8-", 10), [[0, 1, 2], [4], [7, 8, 9]]);
  assert.deepEqual(lerIntervalos("-2; 4", 5), [[0, 1], [3]]);
  assert.deepEqual(lerIntervalos(" 2 - 3 ", 5), [[1, 2]]);
  assert.throws(() => lerIntervalos("", 5), /Nenhum intervalo/);
  assert.throws(() => lerIntervalos("abc", 5), /inválido/);
  assert.throws(() => lerIntervalos("4-2", 5), /fora do documento/);
  assert.throws(() => lerIntervalos("0", 5), /fora do documento/);
  assert.throws(() => lerIntervalos("6", 5), /fora do documento/);
  assert.throws(() => lerIntervalos("-", 5), /inválido/);
});

test("dividir a cada N e por intervalos", () => {
  assert.deepEqual(gruposACada(5, 2), [[0, 1], [2, 3], [4]]);
  assert.throws(() => gruposACada(5, 0), /maior que zero/);
  const s = sessao([{ linhas: ["Página A"] }, { linhas: ["Página B"] }, { linhas: ["Página C"] }], "relatório.pdf");
  const partes = dividir(s, lerIntervalos("1-2, 3", 3));
  assert.deepEqual(partes.map((p) => p.nome), ["relatório_p1-2.pdf", "relatório_p3.pdf"]);
  assert.deepEqual(ordemDeTextos(Sessao.abrir(partes[0].bytes, "x.pdf")), ["A", "B"]);
  assert.deepEqual(ordemDeTextos(Sessao.abrir(partes[1].bytes, "x.pdf")), ["C"]);
});
