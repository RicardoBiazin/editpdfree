import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { Sessao } from "../src/core/documento.ts";
import { listarCampos, preencherCampo } from "../src/core/formularios.ts";
import { substituirTrecho, trechoEm } from "../src/core/texto.ts";
import { marcaDagua, numerar, formatarNumero } from "../src/core/extras.ts";
import { codificarWinAnsi } from "../src/core/conteudo.ts";
import { crc32, criarZip } from "../src/core/zip.ts";
import { criarFormulario, reabrir, sessao, textoDaPagina } from "./fixtures.ts";

test("preencher formulário: texto, caixa e lista persistem", () => {
  const s = Sessao.abrir(criarFormulario(), "form.pdf");
  const campos = listarCampos(s.pagina(0), 0);
  const porNome = Object.fromEntries(campos.map((c) => [c.nome, c]));
  assert.equal(porNome.nome.tipo, "texto");
  assert.equal(porNome.aceito.tipo, "caixa");
  assert.equal(porNome.cor.tipo, "combo");
  assert.deepEqual(porNome.cor.opcoes, ["Azul", "Verde", "Vermelho"]);
  assert.equal(porNome.aceito.marcado, false);

  preencherCampo(s, 0, porNome.nome.id, "José da Silva");
  preencherCampo(s, 0, porNome.aceito.id, true);
  preencherCampo(s, 0, porNome.cor.id, "Verde");
  assert.equal(preencherCampo(s, 0, porNome.cor.id, "Verde"), false, "sem mudança não entra no desfazer");

  const s2 = reabrir(s);
  const depois = Object.fromEntries(listarCampos(s2.pagina(0), 0).map((c) => [c.nome, c]));
  assert.equal(depois.nome.valor, "José da Silva");
  assert.equal(depois.aceito.marcado, true);
  assert.equal(depois.cor.valor, "Verde");

  preencherCampo(s2, 0, depois.aceito.id, false);
  const s3 = reabrir(s2);
  assert.equal(listarCampos(s3.pagina(0), 0).find((c) => c.nome === "aceito")!.marcado, false);
});

test("editar uma linha de texto existente", () => {
  const s = sessao([{ linhas: ["Linha de cima", "Valor: R$ 100,00", "Linha de baixo"] }]);
  // Segunda linha: baseline em y_pdf = 842-72-24 = 746 -> pagina y = 96.
  const t = trechoEm(s.pagina(0), 0, [100, 92]);
  assert.ok(t);
  assert.equal(t.texto, "Valor: R$ 100,00");
  assert.equal(t.familia, "helv");
  assert.ok(Math.abs(t.tamanho - 14) < 0.1);
  assert.ok(Math.abs(t.origem[1] - 96) < 0.5);
  substituirTrecho(s, t, "Valor: R$ 250,00 — revisado");
  const s2 = reabrir(s);
  const texto = textoDaPagina(s2, 0);
  assert.doesNotMatch(texto, /100,00/);
  assert.match(texto, /Valor: R\$ 250,00 — revisado/);
  assert.match(texto, /Linha de cima/, "a linha vizinha de cima continua");
  assert.match(texto, /Linha de baixo/, "a linha vizinha de baixo continua");
  const novo = trechoEm(s2.pagina(0), 0, [100, 92])!;
  assert.ok(Math.abs(novo.origem[1] - 96) < 0.5, "mesma linha de base");
  assert.ok(Math.abs(novo.tamanho - 14) < 0.1, "mesmo tamanho");
});

test("marca d'água e numeração de páginas", () => {
  const s = sessao([{ linhas: ["a"] }, { linhas: ["b"], rotacao: 90 }, { linhas: ["c"] }]);
  marcaDagua(s, "CONFIDENCIAL");
  numerar(s, { formato: "Página {n} de {total}" });
  const s2 = reabrir(s);
  for (let i = 0; i < 3; i++) {
    const t = textoDaPagina(s2, i);
    assert.match(t, /CONFIDENCIAL/);
    assert.match(t, new RegExp(`Página ${i + 1} de 3`));
  }
  // Na pagina girada o numero fica no rodape que o leitor ve.
  const p = s2.pagina(1);
  const b = p.getBounds();
  const r = p.search("Página 2 de 3")[0][0];
  assert.ok(r[1] > b[3] - 60, "número no rodapé visível");
  assert.equal(formatarNumero("{arquivo} — {data} — {n}", 3, 9, { arquivo: "a.pdf", data: "30/09/2026" }),
    "a.pdf — 30/09/2026 — 3");
  assert.throws(() => formatarNumero("  ", 1, 1), /Informe/);
  assert.throws(() => formatarNumero("{n} {x}", 1, 1), /só aceita/);
});

test("WinAnsi: acentos, aspas e euro; o resto vira ?", () => {
  assert.deepEqual(codificarWinAnsi("ção"), [0xe7, 0xe3, 0x6f]);
  assert.deepEqual(codificarWinAnsi("“€”"), [0x93, 0x80, 0x94]);
  assert.deepEqual(codificarWinAnsi("中"), [0x3f]);
});

test("ZIP só-armazenar: estrutura e CRC corretos", () => {
  const a = new TextEncoder().encode("conteúdo A");
  const b = new Uint8Array(1000).map((_, i) => i % 251);
  assert.equal(crc32(a), zlib.crc32(a));
  const zip = criarZip([{ nome: "relatório_p1.pdf", bytes: a }, { nome: "b.bin", bytes: b }]);
  const v = new DataView(zip.buffer);
  // Fim do diretorio central
  const fim = zip.length - 22;
  assert.equal(v.getUint32(fim, true), 0x06054b50);
  assert.equal(v.getUint16(fim + 10, true), 2);
  let pos = v.getUint32(fim + 16, true);
  const nomes: string[] = [];
  for (let k = 0; k < 2; k++) {
    assert.equal(v.getUint32(pos, true), 0x02014b50);
    const crc = v.getUint32(pos + 16, true);
    const tam = v.getUint32(pos + 20, true);
    const nlen = v.getUint16(pos + 28, true);
    const local = v.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nlen));
    nomes.push(nome);
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const lnlen = v.getUint16(local + 26, true);
    const dados = zip.subarray(local + 30 + lnlen, local + 30 + lnlen + tam);
    assert.equal(zlib.crc32(dados), crc);
    pos += 46 + nlen;
  }
  assert.deepEqual(nomes, ["relatório_p1.pdf", "b.bin"]);
});
