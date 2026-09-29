import { test } from "node:test";
import assert from "node:assert/strict";
import { NIVEIS_DESFAZER, SenhaNecessaria, Sessao } from "../src/core/documento.ts";
import { girar } from "../src/core/paginas.ts";
import { criarPdf, pngTeste, reabrir, sessao, textoDaPagina } from "./fixtures.ts";

test("abrir e salvar preserva páginas e texto", () => {
  const s = sessao([{ linhas: ["Primeira página"] }, { linhas: ["Segunda — com acentuação"] }]);
  assert.equal(s.paginas, 2);
  const s2 = reabrir(s);
  assert.equal(s2.paginas, 2);
  assert.match(textoDaPagina(s2, 0), /Primeira página/);
  assert.match(textoDaPagina(s2, 1), /Segunda — com acentuação/);
});

test("arquivo que não é PDF dá erro legível", () => {
  assert.throws(() => Sessao.abrir(new TextEncoder().encode("isto não é um pdf"), "x.pdf"),
    /não parece um PDF válido|não/);
});

test("imagem vira um PDF de uma página", () => {
  const s = Sessao.abrir(pngTeste(80, 40), "foto.png");
  assert.equal(s.paginas, 1);
  assert.equal(s.nome, "foto.pdf");
  const b = s.pagina(0).getBounds();
  // 80x40 px a 96 dpi (sem resolucao no PNG) = 60x30 pt.
  assert.ok(Math.abs((b[2] - b[0]) / (b[3] - b[1]) - 2) < 0.01);
});

test("desfazer e refazer", () => {
  const s = sessao([{}, {}]);
  assert.equal(s.podeDesfazer, null);
  girar(s, [0], 90);
  assert.equal(s.podeDesfazer, "Girar página");
  assert.equal(s.pagina(0).getBounds()[2], 842);
  assert.equal(s.desfazer(), "Girar página");
  assert.equal(s.pagina(0).getBounds()[2], 595);
  assert.equal(s.podeRefazer, "Girar página");
  s.refazer();
  assert.equal(s.pagina(0).getBounds()[2], 842);
  // Nova operacao limpa o refazer.
  s.desfazer();
  girar(s, [1], 90);
  assert.equal(s.podeRefazer, null);
});

test("desfazer é limitado", () => {
  const s = sessao([{}]);
  for (let i = 0; i < NIVEIS_DESFAZER + 5; i++) girar(s, [0], 90);
  let n = 0;
  while (s.desfazer()) n++;
  assert.equal(n, NIVEIS_DESFAZER);
});

test("operação que falha volta ao estado anterior e não entra na pilha", () => {
  const s = sessao([{ linhas: ["intacto"] }]);
  assert.throws(() => s.operacao("Quebrar", () => {
    s.pagina(0).getObject().put("Rotate", 90);
    throw new Error("falhou no meio");
  }), /falhou no meio/);
  assert.equal(s.pagina(0).getBounds()[2], 595, "a rotação parcial foi desfeita");
  assert.equal(s.podeDesfazer, null);
  assert.equal(s.modificado, false);
});

test("proteger com senha: reabrir exige a senha", () => {
  const s = sessao([{ linhas: ["segredo"] }]);
  s.proteger("abc123");
  const bytes = s.salvar();
  assert.throws(() => Sessao.abrir(bytes, "p.pdf"), (e: unknown) => e instanceof SenhaNecessaria && !e.errada);
  assert.throws(() => Sessao.abrir(bytes, "p.pdf", "errada"), (e: unknown) => e instanceof SenhaNecessaria && e.errada);
  const s2 = Sessao.abrir(bytes, "p.pdf", "abc123");
  assert.match(textoDaPagina(s2, 0), /segredo/);
});

test("PDF aberto com senha continua protegido ao salvar (a menos que se remova)", () => {
  const s = sessao([{ linhas: ["x"] }]);
  s.proteger("s3nha");
  const protegido = s.salvar();
  const s2 = Sessao.abrir(protegido, "p.pdf", "s3nha");
  girar(s2, [0], 90);
  const editado = s2.salvar();
  assert.throws(() => Sessao.abrir(editado, "p.pdf"), SenhaNecessaria);
  const s3 = Sessao.abrir(editado, "p.pdf", "s3nha");
  assert.equal(s3.pagina(0).getBounds()[2], 842, "a edição foi salva");
  s3.removerProtecao();
  const aberto = s3.salvar();
  assert.equal(Sessao.abrir(aberto, "p.pdf").paginas, 1);
});

test("senha com vírgula é recusada (o MuPDF não tem escape nas opções)", () => {
  const s = sessao([{}]);
  assert.throws(() => s.proteger("a,b"), /vírgula/);
});

test("senha com acento e espaço funciona", () => {
  const s = sessao([{}]);
  s.proteger("ação é");
  const b = s.salvar();
  assert.equal(Sessao.abrir(b, "p.pdf", "ação é").paginas, 1);
});

test("snapshots não guardam a senha: desfazer num PDF protegido funciona", () => {
  const bytes = (() => {
    const s = sessao([{}, {}]);
    s.proteger("k");
    return s.salvar();
  })();
  const s = Sessao.abrir(bytes, "p.pdf", "k");
  girar(s, [0], 90);
  s.desfazer();
  assert.equal(s.doc.needsPassword(), false, "o instantaneo restaurado não pede senha");
  assert.equal(s.pagina(0).getBounds()[2], 595);
  assert.throws(() => Sessao.abrir(s.salvar(), "p.pdf"), SenhaNecessaria);
});

test("permissões: com a senha de abrir, alterar fica proibido", () => {
  const s = sessao([{ linhas: ["x"] }]);
  s.proteger("leitor", "dono");
  const b = s.salvar();
  const comLeitor = Sessao.abrir(b, "p.pdf", "leitor");
  assert.equal(comLeitor.doc.hasPermission("print"), true);
  assert.equal(comLeitor.doc.hasPermission("copy"), true);
  assert.equal(comLeitor.doc.hasPermission("edit"), false);
  const comDono = Sessao.abrir(b, "p.pdf", "dono");
  assert.equal(comDono.doc.hasPermission("edit"), true);
});

test("PDF gerado pelo fixture é válido", () => {
  assert.ok(criarPdf([{}]).length > 100);
});
