import { test } from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { Sessao, bytesDoBuffer } from "../src/core/documento.ts";
import { infoArquivo, juntarArquivos } from "../src/core/juntar.ts";
import { compararNomes } from "../src/core/intervalos.ts";
import { forma, listarAnotacoes } from "../src/core/anotacoes.ts";
import { listarCampos, preencherCampo } from "../src/core/formularios.ts";
import { marcadores } from "../src/core/mais.ts";
import { criarFormulario, criarPdf, pngTeste, sessao, textoDaPagina } from "./fixtures.ts";

const enc = new TextEncoder();

function paginasDe(prefixo: string, n: number): Uint8Array {
  return criarPdf(Array.from({ length: n }, (_, i) => ({ linhas: [`${prefixo}${i + 1}`] })));
}

function textos(bytes: Uint8Array): string[] {
  const s = Sessao.abrir(bytes, "r.pdf");
  return [...Array(s.paginas).keys()].map((i) => textoDaPagina(s, i).trim());
}

test("juntar respeita a ordem e o intervalo de cada arquivo", () => {
  const r = juntarArquivos([
    { bytes: paginasDe("B", 3), nome: "b.pdf" },
    { bytes: paginasDe("A", 5), nome: "a.pdf", intervalo: "4-, 1" },
    { bytes: paginasDe("C", 2), nome: "c.pdf", intervalo: "" },
  ]);
  assert.deepEqual(textos(r), ["B1", "B2", "B3", "A4", "A5", "A1", "C1", "C2"]);
});

test("intervalo inválido e lista vazia dão erro com o nome do arquivo", () => {
  assert.throws(() => juntarArquivos([{ bytes: paginasDe("A", 2), nome: "curto.pdf", intervalo: "3" }]), /curto\.pdf.*fora do documento/);
  assert.throws(() => juntarArquivos([]), /ao menos um/);
});

test("marcador por arquivo e sumário original remapeado", () => {
  // Fonte com sumario proprio apontando para a pagina 2.
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < 3; i++) doc.insertPage(-1, doc.addPage([0, 0, 200, 200], 0, {}, ""));
  const it = doc.addObject({ Title: "(Capítulo 2)", Dest: [doc.findPage(1), "Fit"] });
  const raiz = doc.addObject({ Type: "Outlines", First: it, Last: it, Count: 1 });
  it.put("Parent", raiz);
  doc.getTrailer().get("Root").put("Outlines", raiz);
  const comSumario = bytesDoBuffer(doc.saveToBuffer(""));
  const r = juntarArquivos([
    { bytes: paginasDe("X", 2), nome: "Relatório Anual.pdf" },
    { bytes: comSumario, nome: "livro.pdf" },
  ], { marcadores: true });
  const m = marcadores(Sessao.abrir(r, "r.pdf").doc);
  assert.deepEqual(m.map((x) => [x.titulo, x.nivel, x.pagina]),
    [["Relatório Anual", 0, 0], ["livro", 0, 2], ["Capítulo 2", 1, 3]]);
  // Sem a opcao, fica so' o sumario original (remapeado).
  const r2 = juntarArquivos([{ bytes: paginasDe("X", 2), nome: "x.pdf" }, { bytes: comSumario, nome: "livro.pdf" }]);
  assert.deepEqual(marcadores(Sessao.abrir(r2, "r.pdf").doc).map((x) => [x.titulo, x.pagina]), [["Capítulo 2", 3]]);
  // Intervalo que tira a pagina do capitulo: o marcador some.
  const r3 = juntarArquivos([{ bytes: comSumario, nome: "livro.pdf", intervalo: "1, 3" }]);
  assert.deepEqual(marcadores(Sessao.abrir(r3, "r.pdf").doc), []);
});

test("ordem natural dos nomes: doc2 antes de doc10, sem acento nem maiúscula", () => {
  const nomes = ["doc10.pdf", "Doc2.pdf", "ápice.pdf", "doc1.pdf", "Árvore.pdf", "zebra.pdf", "abacaxi.pdf"];
  assert.deepEqual([...nomes].sort(compararNomes),
    ["abacaxi.pdf", "ápice.pdf", "Árvore.pdf", "doc1.pdf", "Doc2.pdf", "doc10.pdf", "zebra.pdf"]);
});

test("imagens e documentos (TXT, HTML) entram como páginas", () => {
  const r = juntarArquivos([
    { bytes: pngTeste(40, 20), nome: "foto.png", tipo: "image/png" },
    { bytes: enc.encode("Texto do bloco de notas"), nome: "nota.txt" },
    { bytes: enc.encode("<h1>Página HTML</h1>"), nome: "p.html" },
  ]);
  const t = textos(r);
  assert.equal(t.length, 3);
  assert.equal(t[0], "");
  assert.match(t[1], /Texto do bloco de notas/);
  assert.match(t[2], /Página HTML/);
});

test("PDF com senha: informação pede senha; juntar com a senha certa funciona", () => {
  const p = sessao([{ linhas: ["secreto"] }]);
  p.proteger("abc");
  const cripto = p.salvar();
  const semSenha = infoArquivo(cripto, "s.pdf");
  assert.equal(semSenha.precisaSenha, true);
  assert.equal(semSenha.senhaErrada, false);
  assert.equal(infoArquivo(cripto, "s.pdf", "", "errada").senhaErrada, true);
  const ok = infoArquivo(cripto, "s.pdf", "", "abc");
  assert.equal(ok.paginas, 1);
  assert.ok(ok.miniatura && ok.miniatura[0] === 0x89, "miniatura PNG");
  assert.throws(() => juntarArquivos([{ bytes: cripto, nome: "s.pdf" }]), /protegido por senha/);
  const r = juntarArquivos([{ bytes: paginasDe("A", 1), nome: "a.pdf" }, { bytes: cripto, nome: "s.pdf", senha: "abc" }]);
  assert.deepEqual(textos(r), ["A1", "secreto"]);
  assert.equal(Sessao.abrir(r, "r.pdf").doc.needsPassword(), false, "o resultado sai sem senha");
  assert.match(infoArquivo(enc.encode("lixo"), "x.pdf").erro ?? "", /PDF/);
});

test("anotações e campos de formulário sobrevivem; nomes repetidos são renomeados", () => {
  const anot = sessao([{ linhas: ["com anotação"] }]);
  forma(anot, 0, "elipse", [50, 50], [150, 120], { cor: [0, 0, 1], espessura: 2, opacidade: 1, tamanhoFonte: 12 });
  const form = Sessao.abrir(criarFormulario(), "f.pdf");
  const campoNome = listarCampos(form.pagina(0), 0).find((c) => c.nome === "nome")!;
  preencherCampo(form, 0, campoNome.id, "Primeiro");
  const formBytes = form.salvar();
  const r = juntarArquivos([
    { bytes: anot.salvar(), nome: "anot.pdf" },
    { bytes: formBytes, nome: "f1.pdf" },
    { bytes: formBytes, nome: "f2.pdf" },
  ]);
  const s = Sessao.abrir(r, "r.pdf");
  assert.deepEqual(listarAnotacoes(s.pagina(0)).map((a) => a.tipo), ["Circle"]);
  const c1 = listarCampos(s.pagina(1), 1), c2 = listarCampos(s.pagina(2), 2);
  assert.deepEqual(c1.map((c) => c.nome).sort(), ["aceito", "cor", "nome"]);
  assert.deepEqual(c2.map((c) => c.nome).sort(), ["aceito_2", "cor_2", "nome_2"]);
  assert.equal(c1.find((c) => c.nome === "nome")!.valor, "Primeiro", "o valor preenchido vem junto");
  // Os campos continuam independentes e preenchiveis.
  preencherCampo(s, 2, c2.find((c) => c.nome === "nome_2")!.id, "Segundo");
  const s2 = Sessao.abrir(s.salvar(), "r.pdf");
  assert.equal(listarCampos(s2.pagina(1), 1).find((c) => c.nome === "nome")!.valor, "Primeiro");
  assert.equal(listarCampos(s2.pagina(2), 2).find((c) => c.nome === "nome_2")!.valor, "Segundo");
  const fields = s2.doc.getTrailer().get("Root").get("AcroForm").get("Fields");
  assert.equal(fields.length, 6);
});

test("campo em hierarquia e grupo de opções (widgets filhos) viram campos do resultado", () => {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, {}, ""));
  const p = doc.findPage(0);
  const pai = doc.addObject({ T: "(endereco)", Kids: [] });
  const rua = doc.addObject({ Type: "Annot", Subtype: "Widget", FT: "Tx", T: "(rua)", Rect: [10, 10, 150, 30], P: p, Parent: pai,
    DA: "(/Helv 10 Tf 0 g)", V: "(Rua A)" });
  pai.get("Kids").push(rua);
  const grupo = doc.addObject({ FT: "Btn", Ff: 49152, T: "(sexo)", V: "/Off", Kids: [] });
  const ap = (on: string) => ({ N: { [on]: doc.addStream("0 g 2 2 6 6 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] }),
    Off: doc.addStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] }) } });
  const r1 = doc.addObject({ Type: "Annot", Subtype: "Widget", Rect: [10, 50, 20, 60], P: p, Parent: grupo, AS: "Off", AP: ap("F") });
  const r2 = doc.addObject({ Type: "Annot", Subtype: "Widget", Rect: [30, 50, 40, 60], P: p, Parent: grupo, AS: "Off", AP: ap("M") });
  grupo.get("Kids").push(r1);
  grupo.get("Kids").push(r2);
  p.put("Annots", [rua, r1, r2]);
  doc.getTrailer().get("Root").put("AcroForm", doc.addObject({ Fields: [pai, grupo] }));
  const bytes = bytesDoBuffer(doc.saveToBuffer(""));
  const r = juntarArquivos([{ bytes, nome: "hier.pdf" }]);
  const s = Sessao.abrir(r, "r.pdf");
  const campos = listarCampos(s.pagina(0), 0);
  assert.deepEqual(campos.map((c) => c.nome).sort(), ["endereco_rua", "sexo", "sexo"]);
  assert.equal(campos.find((c) => c.nome === "endereco_rua")!.valor, "Rua A");
  assert.ok(campos.filter((c) => c.nome === "sexo").every((c) => c.tipo === "opcao"), "os dois botões seguem no mesmo grupo");
});
