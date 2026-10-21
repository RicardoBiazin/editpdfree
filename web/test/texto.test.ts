import { test } from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { bytesDoBuffer, Sessao } from "../src/core/documento.ts";
import { substituirTrecho, trechoEm } from "../src/core/texto.ts";
import { comSelecao, diferenca, selecionarFaixa, textoSelecionado } from "../src/core/trecho.ts";
import { reabrir, sessao, textoDaPagina } from "./fixtures.ts";

/** PDF com UMA linha numa fonte EMBUTIDA (Times do MuPDF, Type0/Identity-H),
 *  tamanho quebrado (10,6 pt) e uma segunda linha logo abaixo. */
function pdfComFonteEmbutida(linhas: string[], tamanho = 10.6): Sessao {
  const doc = new mupdf.PDFDocument();
  const f = new mupdf.Font("Times-Roman");
  const fonte = doc.addFont(f);
  const gids = (t: string) => "<" + [...t].map((c) => f.encodeCharacter(c.codePointAt(0)!)
    .toString(16).padStart(4, "0")).join("") + ">";
  const conteudo = linhas.map((l, i) => `BT /F1 ${tamanho} Tf 72 ${770 - i * 14} Td ${gids(l)} Tj ET`).join("\n");
  const res = doc.addObject({ Font: { F1: fonte } });
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, conteudo));
  return Sessao.abrir(bytesDoBuffer(doc.saveToBuffer("garbage=compact")), "embutida.pdf");
}

/** Linhas da pagina, cada uma como texto (sem as vazias). */
function linhasDe(s: Sessao): string[] {
  return textoDaPagina(s, 0).split("\n").filter((l) => l.trim());
}

test("diferença: só o miolo que mudou", () => {
  assert.deepEqual(diferenca("Valor: 100,00 reais", "Valor: 290,00 reais"), { a: 7, b: 9, meio: "29" });
  assert.deepEqual(diferenca("abc", "abc"), { a: 3, b: 3, meio: "" });
  assert.deepEqual(diferenca("abc", "abXc"), { a: 2, b: 2, meio: "X" });
  assert.deepEqual(diferenca("aaa", "aa"), { a: 2, b: 3, meio: "" });
});

test("selecionar parte da linha pelo arrasto", () => {
  const s = sessao([{ linhas: ["Valor: R$ 100,00"] }]);
  const t = trechoEm(s.pagina(0), 0, [100, 68])!;
  assert.equal(t.inicio, 0);
  assert.equal(t.fim, t.caracteres.length);
  const k = t.caracteres;
  const i = t.texto.indexOf("100");
  // Do meio do "1" ao meio do ultimo "0".
  const sel = selecionarFaixa(t, (k[i].x0 + k[i].x1) / 2 - 0.5, (k[i + 5].x0 + k[i + 5].x1) / 2 + 0.5);
  assert.equal(textoSelecionado(sel), "100,00");
  // Arrasto da direita para a esquerda da o mesmo.
  const inv = selecionarFaixa(t, (k[i + 5].x0 + k[i + 5].x1) / 2 + 0.5, (k[i].x0 + k[i].x1) / 2 - 0.5);
  assert.equal(textoSelecionado(inv), "100,00");
  const pelaTrechoEm = trechoEm(s.pagina(0), 0, [(k[i].x0 + k[i].x1) / 2 - 0.5, 68], [(k[i + 2].x1), 68])!;
  assert.equal(textoSelecionado(pelaTrechoEm), "100");
});

test("editar só a parte selecionada: o resto da linha fica e continua uma linha só", () => {
  const s = sessao([{ linhas: ["Linha de cima", "Valor: R$ 100,00 por mês", "Linha de baixo"] }]);
  let t = trechoEm(s.pagina(0), 0, [100, 92])!;
  const i = t.texto.indexOf("100,00");
  t = comSelecao(t, i, i + 6);
  const r = substituirTrecho(s, t, "1.250,00");
  assert.equal(r.alterou, true);
  assert.equal(r.faltando, "");
  const s2 = reabrir(s);
  const linhas = linhasDe(s2);
  assert.ok(linhas.includes("Valor: R$ 1.250,00 por mês"), `linha inteira e contínua: ${JSON.stringify(linhas)}`);
  assert.ok(linhas.includes("Linha de cima") && linhas.includes("Linha de baixo"), "vizinhas intactas");
  const depois = trechoEm(s2.pagina(0), 0, [100, 92])!;
  assert.ok(Math.abs(depois.origem[0] - t.origem[0]) < 0.01, "o começo da linha não andou");
  // Sem fonte embutida no original: o novo vai na Base-14 (sem engordar o arquivo).
  assert.ok(s2.salvar().length < 5000, "não embutiu fonte");
});

test("sem mudança não entra no desfazer", () => {
  const s = sessao([{ linhas: ["Igual"] }]);
  const t = trechoEm(s.pagina(0), 0, [80, 68])!;
  const v = s.versao;
  assert.deepEqual(substituirTrecho(s, t, "Igual"), { alterou: false, faltando: "" });
  assert.equal(s.versao, v);
});

test("fonte embutida: o texto novo sai na MESMA fonte e no tamanho exato", () => {
  const s = pdfComFonteEmbutida(["Contrato: Summit 27, tema a definir.", "Segunda linha intacta"]);
  const p = s.pagina(0);
  let t = trechoEm(p, 0, [100, 69])!;
  assert.equal(t.texto, "Contrato: Summit 27, tema a definir.");
  const original = t.fonte;
  assert.ok(Math.abs(t.tamanho - 10.6) < 0.01);
  const i = t.texto.indexOf("27");
  t = comSelecao(t, i, i + 2);
  const r = substituirTrecho(s, t, "2027 — edição única");
  assert.equal(r.faltando, "", "a Times completa tem tudo");
  const s2 = reabrir(s);
  const linhas = linhasDe(s2);
  assert.ok(linhas.includes("Contrato: Summit 2027 — edição única, tema a definir."), JSON.stringify(linhas));
  assert.ok(linhas.includes("Segunda linha intacta"));
  const depois = trechoEm(s2.pagina(0), 0, [100, 69])!;
  assert.equal(depois.estilos.length, 1, "uma fonte só na linha: nenhuma letra trocou de fonte");
  assert.equal(depois.fonte.replace(/^[A-Z]{6}\+/, ""), original.replace(/^[A-Z]{6}\+/, ""));
  assert.ok(Math.abs(depois.tamanho - 10.6) < 0.01, "tamanho exato preservado");
});

test("letra que a fonte embutida não tem sai na Base-14 e é avisada", () => {
  const s = pdfComFonteEmbutida(["Texto simples"]);
  const t = trechoEm(s.pagina(0), 0, [90, 69])!;
  const r = substituirTrecho(s, t, "Texto simples ★");
  assert.equal(r.faltando, "★");
});

test("trocar a fonte e o tamanho da seleção", () => {
  const s = sessao([{ linhas: ["Valor: R$ 100,00"] }]);
  let t = trechoEm(s.pagina(0), 0, [100, 68])!;
  t = comSelecao(t, 0, 6);
  substituirTrecho(s, t, "Valor:", { fonte: "Times-Bold", tamanho: 20 });
  const s2 = reabrir(s);
  const depois = trechoEm(s2.pagina(0), 0, [100, 68])!;
  const est = depois.estilos[depois.caracteres[0].e];
  assert.match(est.fonte, /Times|Nimbus/i);
  assert.ok(Math.abs(est.tamanho - 20) < 0.1);
  assert.match(linhasDe(s2).join(" "), /Valor:\s*R\$ 100,00/);
});
