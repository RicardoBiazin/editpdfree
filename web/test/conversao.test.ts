import { test } from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { Sessao, bytesDoBuffer } from "../src/core/documento.ts";
import { imagensEmbutidas, paginasComoImagens, paraDocx, paraMarkdown } from "../src/core/conversao.ts";
import { recortarMargens, recortarRetangulo, PT_POR_MM } from "../src/core/recorte.ts";
import { criarZip } from "../src/core/zip.ts";
import { criarPdf, criarPdfComImagemGrande, imagemTeste, pdfEstruturado, sessao, textoDaPagina } from "./fixtures.ts";

const enc = new TextEncoder();

test("PDF -> Markdown: título, negrito, itálico, lista e separador de página", () => {
  const s = Sessao.abrir(pdfEstruturado(), "r.pdf");
  const md = paraMarkdown(s.doc);
  assert.match(md, /^# Relatório Anual$/m);
  assert.match(md, /Este parágrafo tem texto corrido suficiente para ser o corpo\. Continua na linha/);
  assert.match(md, /\*\*Importante:\*\*/);
  assert.match(md, /^- primeiro item$/m);
  assert.match(md, /^- segundo item$/m);
  assert.match(md, /\*nota em itálico\*/);
  assert.match(md, /<!-- Página 1 -->[\s\S]*^---$[\s\S]*<!-- Página 2 -->\n\nSegunda página\./m);
});

test("PDF -> Word: DOCX válido que o próprio MuPDF reabre com o texto e a imagem", () => {
  const s = Sessao.abrir(pdfEstruturado(), "r.pdf");
  const partes = paraDocx(s.doc, "r");
  const docx = criarZip(partes);
  const xml = new TextDecoder().decode(partes.find((p) => p.nome === "word/document.xml")!.bytes);
  assert.match(xml, /<w:b\/>.*Relatório Anual/);
  assert.match(xml, /<w:sz w:val="48"\/>/, "24 pt = 48 meios-pontos");
  assert.match(xml, /<w:i\/>.*nota em itálico/);
  assert.match(xml, /<w:br w:type="page"\/>/);
  const reaberto = mupdf.Document.openDocument(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  let texto = "";
  for (let i = 0; i < reaberto.countPages(); i++) texto += reaberto.loadPage(i).toStructuredText().asText();
  assert.match(texto, /Relatório Anual/);
  assert.match(texto, /Segunda página/);
  const comImagem = Sessao.abrir(criarPdf([{ linhas: ["legenda"], imagem: [100, 400, 300, 600] }]), "i.pdf");
  const p2 = paraDocx(comImagem.doc);
  assert.ok(p2.some((p) => p.nome === "word/media/imagem1.png"));
  assert.match(new TextDecoder().decode(p2.find((p) => p.nome === "word/_rels/document.xml.rels")!.bytes), /media\/imagem1\.png/);
  assert.ok(mupdf.Document.openDocument(criarZip(p2), "x.docx").countPages() >= 1);
});

test("páginas como PNG/JPG na resolução pedida", () => {
  const s = sessao([{ linhas: ["a"] }, { linhas: ["b"], rotacao: 90 }], "doc.pdf");
  const png = paginasComoImagens(s, 72, "png");
  assert.deepEqual(png.map((p) => p.nome), ["doc_p001.png", "doc_p002.png"]);
  const img = new mupdf.Image(png[1].bytes);
  assert.deepEqual([img.getWidth(), img.getHeight()], [842, 595], "página girada sai deitada");
  const jpg = paginasComoImagens(s, 150, "jpg", [0]);
  assert.equal(jpg[0].bytes[0], 0xff);
  assert.equal(new mupdf.Image(jpg[0].bytes).getWidth(), Math.round(595 * 150 / 72));
  assert.throws(() => paginasComoImagens(s, 5, "png"), /resolução/);
});

test("imagens embutidas saem no formato original (JPEG) ou em PNG", () => {
  const doc = new mupdf.PDFDocument();
  const jpeg = imagemTeste(30, 20).toPixmap().asJPEG(80).slice();
  const refJ = doc.addImage(new mupdf.Image(jpeg));
  const refP = doc.addImage(imagemTeste(16, 16));
  doc.insertPage(-1, doc.addPage([0, 0, 200, 200], 0, { XObject: { J: refJ, P: refP } },
    "q 30 0 0 20 10 10 cm /J Do Q q 16 0 0 16 50 50 cm /P Do Q"));
  const s = Sessao.abrir(bytesDoBuffer(doc.saveToBuffer("")), "fotos.pdf");
  const imgs = imagensEmbutidas(s);
  assert.equal(imgs.length, 2);
  const j = imgs.find((i) => i.nome.endsWith(".jpg"))!;
  assert.match(j.nome, /^fotos_p001_img0\d\.jpg$/);
  assert.deepEqual(j.bytes, jpeg, "o JPEG sai idêntico, sem recompressão");
  const p = imgs.find((i) => i.nome.endsWith(".png"))!;
  assert.equal(new mupdf.Image(p.bytes).getWidth(), 16);
  assert.equal(imagensEmbutidas(Sessao.abrir(criarPdfComImagemGrande(100, 100), "g.pdf")).length, 1);
});

test("abrir TXT, HTML e DOCX converte para PDF", () => {
  const t = Sessao.abrir(enc.encode("Olá, texto puro\nsegunda linha"), "nota.txt");
  assert.equal(t.nome, "nota.pdf");
  assert.equal(t.modificado, true);
  assert.match(textoDaPagina(t, 0), /Olá, texto puro/);
  const h = Sessao.abrir(enc.encode("<h1>Título HTML</h1><p>com <b>negrito</b></p>"), "p.html");
  assert.match(textoDaPagina(h, 0), /Título HTML/);
  const docx = criarZip([
    { nome: "[Content_Types].xml", bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { nome: "_rels/.rels", bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { nome: "word/_rels/document.xml.rels", bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`) },
    { nome: "word/document.xml", bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contrato em Word ção</w:t></w:r></w:p></w:body></w:document>`) },
  ]);
  const d = Sessao.abrir(docx, "contrato.docx");
  assert.equal(d.nome, "contrato.pdf");
  assert.match(textoDaPagina(d, 0), /Contrato em Word ção/);
  assert.throws(() => Sessao.abrir(enc.encode("lixo"), "x.docx"), /Não foi possível ler/);
});

test("recortar margens como o leitor vê a página (0° e 90°)", () => {
  for (const rot of [0, 90] as const) {
    const s = sessao([{ rotacao: rot, linhas: ["topo visual"] }]);
    const antes = s.pagina(0).getBounds();
    recortarMargens(s, [0], { cima: 10, direita: 0, baixo: 0, esquerda: 20 });
    const s2 = Sessao.abrir(s.salvar(), "r.pdf");
    const b = s2.pagina(0).getBounds();
    assert.ok(Math.abs((antes[3] - antes[1]) - (b[3] - b[1]) - 10 * PT_POR_MM) < 0.5, `rot ${rot}: altura visual`);
    assert.ok(Math.abs((antes[2] - antes[0]) - (b[2] - b[0]) - 20 * PT_POR_MM) < 0.5, `rot ${rot}: largura visual`);
    const crop = s2.pagina(0).getObject().get("CropBox");
    const v = [0, 1, 2, 3].map((k) => crop.get(k).asNumber());
    if (rot === 0) {
      assert.ok(Math.abs(v[3] - (842 - 10 * PT_POR_MM)) < 0.5 && Math.abs(v[0] - 20 * PT_POR_MM) < 0.5, `crop ${v}`);
    } else {
      // A 90 graus: topo visual = x baixo do PDF; esquerda visual = y baixo.
      assert.ok(Math.abs(v[0] - 10 * PT_POR_MM) < 0.5 && Math.abs(v[1] - 20 * PT_POR_MM) < 0.5, `crop ${v}`);
    }
  }
});

test("recortar pelo retângulo, em todas as páginas; recorte impossível dá erro", () => {
  const s = sessao([{}, {}, { largura: 300, altura: 300 }]);
  recortarRetangulo(s, [0, 1, 2], [50, 60, 350, 460]);
  const b = [0, 1, 2].map((i) => s.pagina(i).getBounds());
  assert.deepEqual(b[0].map(Math.round), [0, 0, 300, 400]);
  assert.deepEqual(b[2].map(Math.round), [0, 0, 250, 240], "limitado à página menor");
  assert.throws(() => recortarMargens(s, [0], { cima: 200, direita: 0, baixo: 200, esquerda: 0 }), /pequena demais/);
  assert.throws(() => recortarMargens(s, [0], { cima: 0, direita: 0, baixo: 0, esquerda: 0 }), /ao menos uma/);
  s.desfazer();
  assert.equal(Math.round(s.pagina(0).getBounds()[2]), 595);
});
