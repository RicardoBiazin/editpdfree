// Geradores de PDFs de teste -- nada binario fica no repositorio.

import * as mupdf from "mupdf";
import { bytesDoBuffer, Sessao } from "../src/core/documento.ts";
import { codificarWinAnsi } from "../src/core/conteudo.ts";

export interface PaginaTeste {
  linhas?: string[];
  rotacao?: 0 | 90 | 180 | 270;
  largura?: number;
  altura?: number;
  /** Quadrado preto no espaco PDF (x, y, lado), y para cima. */
  marcador?: [number, number, number];
  /** Imagem cinza (retangulo no espaco PDF). */
  imagem?: [number, number, number, number];
}

function hex(t: string): string {
  return "<" + codificarWinAnsi(t).map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
}

export function imagemTeste(w = 40, h = 40, metadeDeCimaEscura = false): mupdf.Image {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  const stride = pix.getStride();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const escuro = metadeDeCimaEscura ? y < h / 2 : true;
      const o = y * stride + x * 3;
      px[o] = escuro ? 20 : 250;
      px[o + 1] = escuro ? 120 : 250;
      px[o + 2] = escuro ? 200 : 250;
    }
  }
  return new mupdf.Image(pix);
}

export function pngTeste(w = 40, h = 40, metadeDeCimaEscura = true): Uint8Array {
  const img = imagemTeste(w, h, metadeDeCimaEscura);
  const pix = img.toPixmap();
  return pix.asPNG().slice();
}

/** Monta um PDF: cada pagina com linhas de texto em Helvetica 14 a partir de
 *  (72, altura-72), espacadas de 24 pt. */
export function criarPdf(paginas: PaginaTeste[]): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const fonte = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  for (const pg of paginas) {
    const w = pg.largura ?? 595, h = pg.altura ?? 842;
    const partes: string[] = [];
    const xobjs: Record<string, mupdf.PDFObject> = {};
    (pg.linhas ?? []).forEach((l, i) => {
      partes.push(`BT /F1 14 Tf 72 ${h - 72 - i * 24} Td ${hex(l)} Tj ET`);
    });
    if (pg.marcador) {
      const [x, y, lado] = pg.marcador;
      partes.push(`0 0 0 rg ${x} ${y} ${lado} ${lado} re f`);
    }
    if (pg.imagem) {
      const [x0, y0, x1, y1] = pg.imagem;
      xobjs.Im1 = doc.addImage(imagemTeste());
      partes.push(`q ${x1 - x0} 0 0 ${y1 - y0} ${x0} ${y0} cm /Im1 Do Q`);
    }
    const res = doc.addObject({ Font: { F1: fonte }, XObject: xobjs });
    doc.insertPage(-1, doc.addPage([0, 0, w, h], pg.rotacao ?? 0, res, partes.join("\n")));
  }
  return bytesDoBuffer(doc.saveToBuffer("garbage=compact"));
}

export function sessao(paginas: PaginaTeste[], nome = "teste.pdf"): Sessao {
  return Sessao.abrir(criarPdf(paginas), nome);
}

/** Salva e reabre (confere que a alteracao sobrevive ao arquivo). */
export function reabrir(s: Sessao, senha?: string): Sessao {
  return Sessao.abrir(s.salvar(), s.nome, senha);
}

export function textoDaPagina(s: Sessao, i: number): string {
  const p = s.pagina(i);
  const st = p.toStructuredText("preserve-whitespace");
  const t = st.asText();
  st.destroy();
  return t;
}

/** PDF com formulario: um campo de texto, uma caixa de selecao e uma lista. */
export function criarFormulario(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  const pagina = doc.addPage([0, 0, 595, 842], 0, { Font: { Helv: helv } }, "");
  doc.insertPage(-1, pagina);
  const p = doc.findPage(0);
  const dr = doc.addObject({ Font: { Helv: helv } });
  const onAp = doc.addStream("q 0 0 0 rg 2 2 12 12 re f Q", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 16, 16] });
  const offAp = doc.addStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 16, 16] });
  const texto = doc.addObject({
    Type: "Annot", Subtype: "Widget", FT: "Tx", T: "(nome)", Rect: [72, 700, 300, 722],
    DA: "(/Helv 12 Tf 0 g)", F: 4, P: p, V: "()",
  });
  const caixa = doc.addObject({
    Type: "Annot", Subtype: "Widget", FT: "Btn", T: "(aceito)", Rect: [72, 650, 88, 666],
    F: 4, P: p, V: "Off", AS: "Off", MK: { CA: "(4)" },
  });
  const ap = doc.newDictionary();
  const n = doc.newDictionary();
  n.put("Sim", onAp);
  n.put("Off", offAp);
  ap.put("N", n);
  caixa.put("AP", ap);
  const lista = doc.addObject({
    Type: "Annot", Subtype: "Widget", FT: "Ch", Ff: 131072, T: "(cor)", Rect: [72, 600, 200, 620],
    DA: "(/Helv 12 Tf 0 g)", F: 4, P: p, Opt: ["(Azul)", "(Verde)", "(Vermelho)"], V: "(Azul)",
  });
  p.put("Annots", [texto, caixa, lista]);
  doc.getTrailer().get("Root").put("AcroForm", doc.addObject({
    Fields: [texto, caixa, lista], DR: dr, DA: "(/Helv 12 Tf 0 g)", NeedAppearances: true,
  }));
  return bytesDoBuffer(doc.saveToBuffer(""));
}

/** PDF de uma pagina com uma imagem grande e ruidosa (comprime mal em Flate),
 *  metade de cima escura, ocupando a pagina inteira. */
export function criarPdfComImagemGrande(w = 1800, h = 2400): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  const stride = pix.getStride();
  let semente = 12345;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) % 40);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * 3;
      const base = y < h / 2 ? 40 : 215;
      px[o] = base + aleatorio(); px[o + 1] = base + aleatorio(); px[o + 2] = base + aleatorio();
    }
  }
  const doc = new mupdf.PDFDocument();
  const ref = doc.addImage(new mupdf.Image(pix));
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { XObject: { Im0: ref } }, "q 595 0 0 842 0 0 cm /Im0 Do Q"));
  return bytesDoBuffer(doc.saveToBuffer("compress=yes"));
}

/** PDF com titulo grande, texto em negrito/italico e lista. */
export function pdfEstruturado(linhaExtra?: string): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const f = (nome: string) => doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: nome, Encoding: "WinAnsiEncoding" });
  const res = doc.addObject({ Font: { R: f("Helvetica"), B: f("Helvetica-Bold"), I: f("Helvetica-Oblique") } });
  const hex = (t: string) => "<" + [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("") + ">";
  const linhas: [string, number, number, string][] = [
    ["B", 24, 780, "Relatório Anual"],
    ["R", 11, 740, "Este parágrafo tem texto corrido suficiente para ser o corpo."],
    ["R", 11, 726, "Continua na linha de baixo com mais palavras normais."],
    ["B", 11, 700, "Importante:"],
    ["R", 11, 680, "• primeiro item"],
    ["R", 11, 666, "• segundo item"],
    ["I", 11, 640, "nota em itálico"],
  ];
  if (linhaExtra) linhas.splice(3, 0, ["R", 11, 712, linhaExtra]);
  const conteudo = linhas.map(([fn, t, y, s]) => `BT /${fn} ${t} Tf 72 ${y} Td ${hex(s.replace("•", "\x95"))} Tj ET`).join("\n");
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, conteudo));
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, `BT /R 11 Tf 72 780 Td ${hex("Segunda página.")} Tj ET`));
  return bytesDoBuffer(doc.saveToBuffer(""));
}


/** "Escaneia" um PDF de texto: cada pagina vira so' uma imagem. */
export function escanear(bytes: Uint8Array, escala = 2): Uint8Array {
  const orig = mupdf.Document.openDocument(bytes, "application/pdf");
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < orig.countPages(); i++) {
    const p = orig.loadPage(i);
    const b = p.getBounds();
    const pix = p.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceGray, false);
    const ref = doc.addImage(new mupdf.Image(pix));
    const w = b[2] - b[0], h = b[3] - b[1];
    doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, { XObject: { Im: ref } }, `q ${w} 0 0 ${h} 0 0 cm /Im Do Q`));
  }
  return bytesDoBuffer(doc.saveToBuffer("compress=yes"));
}


function hexWin(t: string): string {
  return "<" + codificarWinAnsi(t).map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
}

/** Ficha para preencher: "Nome: ______", "Cidade:" com espaco, um quadrado
 *  desenhado ao lado de "Aceito" e uma linha de texto comum. */
export function ficha(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const f = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  const c = [
    `BT /F1 12 Tf 72 760 Td ${hexWin("Nome: ______________________")} Tj ET`,
    `BT /F1 12 Tf 72 720 Td ${hexWin("Cidade:")} Tj ET`,
    `0 G 1 w 72 680 10 10 re S`,
    `BT /F1 12 Tf 90 681 Td ${hexWin("Aceito os termos")} Tj ET`,
    `BT /F1 12 Tf 72 640 Td ${hexWin("Texto comum sem campo nenhum aqui")} Tj ET`,
  ].join("\n");
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { Font: { F1: f } }, c));
  return bytesDoBuffer(doc.saveToBuffer(""));
}


/** PDF sem a tabela xref nem o trailer (cortado no fim). */
export function pdfTruncado(): Uint8Array {
  const inteiro = criarPdf([{ linhas: ["Página A"] }, { linhas: ["Página B"] }, { linhas: ["Página C"] }]);
  const corte = new TextDecoder("latin1").decode(inteiro).lastIndexOf("xref");
  return inteiro.slice(0, corte);
}
