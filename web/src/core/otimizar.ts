/*
 * Comprimir e reparar.
 *
 * COMPRIMIR: o MuPDF.js 1.28 nao tem o `rewrite_images` do PyMuPDF, entao as
 * imagens sao reamostradas aqui: cada imagem maior do que a propria pagina
 * precisaria (na resolucao alvo) e' redesenhada menor e regravada como JPEG,
 * mas SO' se o resultado ficar menor que o original. A mascara de
 * transparencia (/SMask) e' outro objeto e fica como estava (o PDF permite
 * mascara de tamanho diferente da imagem). Fontes viram subconjunto e a
 * gravacao passa a usar garbage=deduplicate + object streams.
 *
 * REPARAR: o MuPDF ja' repara ao abrir (reconstroi a tabela xref varrendo o
 * arquivo). Aqui se abre, confere pagina a pagina o que carrega e grava limpo.
 */

import * as mupdf from "mupdf";
import { bytesDoBuffer, type Sessao } from "./documento.ts";

export interface OpcoesCompressao {
  /** Resolucao alvo das imagens (pontos por polegada). */
  dpi?: number;
  /** Qualidade JPEG (1-100). */
  qualidade?: number;
}

export { NIVEIS_COMPRESSAO } from "./formatos.ts";

export interface InfoImagem { ref: mupdf.PDFObject; maiorPaginaPt: number; primeiraPagina: number }

/** Todas as imagens (por objeto) usadas nas paginas, inclusive dentro de
 *  formularios XObject, com a maior dimensao de pagina em que aparecem. */
export function imagensDoDocumento(doc: mupdf.PDFDocument): Map<number, InfoImagem> {
  const achadas = new Map<number, InfoImagem>();
  const visitados = new Set<number>();
  const varrer = (recursos: mupdf.PDFObject, maior: number, pagina: number) => {
    if (!recursos.isDictionary()) return;
    const xobjs = recursos.get("XObject");
    if (!xobjs.isDictionary()) return;
    xobjs.forEach((ref) => {
      if (!ref.isIndirect()) return;
      const num = ref.asIndirect();
      const obj = ref.resolve();
      const tipo = obj.get("Subtype");
      if (!tipo.isName()) return;
      if (tipo.asName() === "Image") {
        const atual = achadas.get(num);
        if (!atual) achadas.set(num, { ref, maiorPaginaPt: maior, primeiraPagina: pagina });
        else if (atual.maiorPaginaPt < maior) atual.maiorPaginaPt = maior;
      } else if (tipo.asName() === "Form" && !visitados.has(num)) {
        visitados.add(num);
        varrer(obj.get("Resources"), maior, pagina);
      }
    });
  };
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i);
    const b = p.getBounds();
    varrer(p.getObject().getInheritable("Resources"), Math.max(b[2] - b[0], b[3] - b[1]), i);
  }
  return achadas;
}

function nomeDoFiltro(obj: mupdf.PDFObject): string {
  const f = obj.get("Filter");
  if (f.isName()) return f.asName();
  if (f.isArray() && f.length) {
    const ultimo = f.get(f.length - 1);
    return ultimo.isName() ? ultimo.asName() : "";
  }
  return "";
}

/** Reamostra/regrava uma imagem. Devolve os bytes economizados (0 = ficou). */
function recomprimir(doc: mupdf.PDFDocument, info: InfoImagem, dpi: number, qualidade: number): number {
  const obj = info.ref.resolve();
  if (obj.get("ImageMask").isBoolean() && obj.get("ImageMask").asBoolean()) return 0;
  const w = obj.get("Width").asNumber(), h = obj.get("Height").asNumber();
  if (!(w > 0 && h > 0) || w * h < 64 * 64) return 0;
  const filtro = nomeDoFiltro(obj);
  const maxPx = Math.max(64, Math.round(info.maiorPaginaPt / 72 * dpi));
  const fator = Math.min(1, maxPx / Math.max(w, h));
  // JPEG que ja' cabe na resolucao: regravar so' perderia qualidade.
  if (filtro === "DCTDecode" && fator > 0.95) return 0;
  // Stream e' propriedade do objeto INDIRETO: ler/gravar pela referencia.
  const tamanhoAntes = info.ref.readRawStream().getLength();
  let img: mupdf.Image;
  let pix: mupdf.Pixmap;
  try {
    img = doc.loadImage(info.ref);
    pix = img.toPixmap();
  } catch {
    return 0;
  }
  const cinza = !!pix.getColorSpace()?.isGray();
  const cs = cinza ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
  const convertido = pix.getColorSpace() === cs && !pix.getAlpha() ? pix : pix.convertToColorSpace(cs, false);
  const nw = Math.max(1, Math.round(w * fator)), nh = Math.max(1, Math.round(h * fator));
  let final = convertido;
  if (nw !== convertido.getWidth() || nh !== convertido.getHeight()) {
    final = new mupdf.Pixmap(cs, [0, 0, nw, nh], false);
    final.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, final);
    // Quadrado unitario da imagem -> nw x nh pixels (sem a mascara: ela e' outro objeto).
    dev.fillImage(new mupdf.Image(convertido), [nw, 0, 0, nh, 0, 0], 1);
    dev.close();
  }
  const jpeg = final.asJPEG(qualidade).slice();
  if (jpeg.length >= tamanhoAntes * 0.9) return 0;
  info.ref.writeRawStream(jpeg);
  obj.put("Filter", "DCTDecode");
  obj.delete("DecodeParms");
  obj.delete("Decode");
  obj.put("Width", nw);
  obj.put("Height", nh);
  obj.put("BitsPerComponent", 8);
  obj.put("ColorSpace", cinza ? "DeviceGray" : "DeviceRGB");
  return tamanhoAntes - jpeg.length;
}

export interface ResultadoCompressao { antes: number; depois: number; imagens: number }

/** Comprime o documento aberto (uma operacao desfazivel) e diz o tamanho do
 *  arquivo antes e depois. */
export function comprimir(s: Sessao, op: OpcoesCompressao = {}): ResultadoCompressao {
  const dpi = op.dpi ?? 144, qualidade = op.qualidade ?? 72;
  const antes = s.gravarCopia().length;
  let imagens = 0;
  s.operacao("Comprimir", () => {
    for (const info of imagensDoDocumento(s.doc).values()) {
      if (recomprimir(s.doc, info, dpi, qualidade) > 0) imagens++;
    }
    try {
      s.doc.subsetFonts();
    } catch {
      // Fonte que nao se deixa subconjuntar fica como estava.
    }
  });
  s.compactar = true;
  const depois = s.gravarCopia().length;
  return { antes, depois, imagens };
}

export interface ResultadoReparo {
  bytes: Uint8Array;
  paginas: number;
  paginasComErro: number;
  estavaDanificado: boolean;
}

/** Abre (o MuPDF repara), confere as paginas e grava um arquivo limpo. */
export function reparar(bytes: Uint8Array): ResultadoReparo {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch {
    throw new Error("Não foi possível recuperar nada deste arquivo: não parece um PDF.");
  }
  if (doc.needsPassword()) throw new Error("O arquivo é protegido por senha. Abra-o com a senha e salve.");
  const pdf = doc.asPDF();
  if (!pdf) throw new Error("O arquivo não é um PDF.");
  let n = 0;
  try {
    n = pdf.countPages();
  } catch {
    n = 0;
  }
  if (n < 1) throw new Error("Nenhuma página pôde ser recuperada deste arquivo.");
  let comErro = 0;
  for (let i = 0; i < n; i++) {
    try {
      const p = pdf.loadPage(i);
      p.toStructuredText("").destroy();
    } catch {
      comErro++;
    }
  }
  const estavaDanificado = pdf.wasRepaired();
  const limpo = bytesDoBuffer(pdf.saveToBuffer("garbage=deduplicate,clean=yes,compress=yes"));
  pdf.destroy();
  return { bytes: limpo, paginas: n, paginasComErro: comErro, estavaDanificado };
}
