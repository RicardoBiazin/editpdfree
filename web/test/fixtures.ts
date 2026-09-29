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
