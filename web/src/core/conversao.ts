/*
 * Converter: PDF -> Markdown, PDF -> Word (.docx), paginas -> JPG/PNG,
 * imagens embutidas, e outros formatos -> PDF.
 *
 * O MuPDF.js 1.28 compilado no pacote npm NAO tem o escritor DOCX ("DOCX/ODT
 * writer not enabled", conferido nas strings do .wasm). O .docx e' montado
 * aqui: document.xml com um paragrafo por bloco de texto (corridas com fonte,
 * tamanho, negrito, italico e cor), imagens na ordem em que aparecem e quebra
 * de pagina entre paginas -- a mesma reconstrucao aproximada do desktop. Sem
 * tabelas nem colunas. O ZIP e' so' armazenado (valido para DOCX).
 *
 * Em compensacao o .wasm ABRE Office (DOCX/XLSX/PPTX), HTML, EPUB, TXT, XPS,
 * FB2, CBZ e SVG, e os diagrama: `paraPdf` converte qualquer um deles.
 */

import * as mupdf from "mupdf";
import { bytesDoBuffer, type Sessao } from "./documento.ts";
import { imagensDoDocumento } from "./otimizar.ts";
import { nomeBase } from "./intervalos.ts";
import type { Retangulo } from "./coordenadas.ts";

// ------------------------------------------------------------ texto estruturado

export interface Trecho { texto: string; tamanho: number; negrito: boolean; italico: boolean; cor: number[]; fonte: string }
export interface Linha { trechos: Trecho[]; rect: Retangulo }
export type Bloco = { tipo: "texto"; linhas: Linha[]; rect: Retangulo }
  | { tipo: "imagem"; rect: Retangulo; png: Uint8Array; largura: number; altura: number };

function nomeLimpo(f: mupdf.Font): string {
  return f.getName().replace(/^[A-Z]{6}\+/, "");
}

function negritoDe(f: mupdf.Font): boolean {
  return f.isBold() || /bold|black|heavy|semibold|demi/i.test(f.getName());
}

function italicoDe(f: mupdf.Font): boolean {
  return f.isItalic() || /italic|oblique/i.test(f.getName());
}

/** Blocos de uma pagina, em ordem de leitura do MuPDF. */
export function blocosDaPagina(p: mupdf.PDFPage, comImagens = false): Bloco[] {
  const st = p.toStructuredText(comImagens ? "preserve-whitespace,preserve-images" : "preserve-whitespace");
  const blocos: Bloco[] = [];
  let bloco: { tipo: "texto"; linhas: Linha[]; rect: Retangulo } | null = null;
  let linha: Linha | null = null;
  try {
    st.walk({
      onImageBlock(bbox, _m, image) {
        if (!comImagens) return;
        try {
          let pix = image.toPixmap();
          const cs = pix.getColorSpace();
          if (cs && !cs.isRGB() && !cs.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
          blocos.push({ tipo: "imagem", rect: bbox as Retangulo, png: pix.asPNG().slice(),
            largura: pix.getWidth(), altura: pix.getHeight() });
        } catch {
          // imagem que nao decodifica fica de fora
        }
      },
      beginTextBlock(bbox) {
        bloco = { tipo: "texto", linhas: [], rect: bbox as Retangulo };
      },
      beginLine(bbox) {
        linha = { trechos: [], rect: bbox as Retangulo };
      },
      onChar(c, _o, fonte, tamanho, _q, cor) {
        if (!linha) return;
        const neg = negritoDe(fonte), ita = italicoDe(fonte), nome = nomeLimpo(fonte);
        const t = Math.round(tamanho * 10) / 10;
        const ult = linha.trechos.at(-1);
        if (ult && ult.negrito === neg && ult.italico === ita && ult.tamanho === t && ult.fonte === nome
          && ult.cor.join() === (cor as number[]).join()) {
          ult.texto += c;
        } else {
          linha.trechos.push({ texto: c, tamanho: t, negrito: neg, italico: ita, cor: [...(cor as number[])], fonte: nome });
        }
      },
      endLine() {
        if (bloco && linha && linha.trechos.some((t) => t.texto.trim())) bloco.linhas.push(linha);
        linha = null;
      },
      endTextBlock() {
        if (bloco && bloco.linhas.length) blocos.push(bloco);
        bloco = null;
      },
    });
  } finally {
    st.destroy();
  }
  return blocos;
}

function textoDaLinha(l: Linha): string {
  return l.trechos.map((t) => t.texto).join("");
}

/** Tamanho do texto corrido: o tamanho com mais caracteres no documento. */
export function tamanhoDoCorpo(paginas: Bloco[][]): number {
  const conta = new Map<number, number>();
  for (const bs of paginas) for (const b of bs) {
    if (b.tipo !== "texto") continue;
    for (const l of b.linhas) for (const t of l.trechos) {
      const k = Math.round(t.tamanho * 2) / 2;
      conta.set(k, (conta.get(k) ?? 0) + t.texto.trim().length);
    }
  }
  let melhor = 12, n = -1;
  for (const [k, v] of conta) if (v > n) { melhor = k; n = v; }
  return melhor;
}

// ------------------------------------------------------------ Markdown

const MARCADOR = /^\s*([•●▪◦‣∙·\-–—*])\s+/;
const NUMERADO = /^\s*(\d{1,3}|[a-zA-Z])([.)])\s+/;

function escaparMd(t: string): string {
  return t.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Corridas com **negrito** e *italico*, juntando as de mesmo estilo. */
function mdInline(trechos: Trecho[]): string {
  const partes: { t: string; n: boolean; i: boolean }[] = [];
  for (const tr of trechos) {
    const u = partes.at(-1);
    if (u && u.n === tr.negrito && u.i === tr.italico) u.t += tr.texto;
    else partes.push({ t: tr.texto, n: tr.negrito, i: tr.italico });
  }
  return partes.map(({ t, n, i }) => {
    if (!t.trim() || (!n && !i)) return escaparMd(t);
    const m = t.match(/^(\s*)(.*?)(\s*)$/s)!;
    const marca = n && i ? "***" : n ? "**" : "*";
    return `${m[1]}${marca}${escaparMd(m[2])}${marca}${m[3]}`;
  }).join("");
}

/** Junta linhas de um paragrafo, desfazendo a hifenizacao de fim de linha. */
function juntarLinhas(textos: string[]): string {
  let saida = "";
  for (const bruto of textos) {
    const t = bruto.trim();
    if (!t) continue;
    if (!saida) saida = t;
    else if (/[A-Za-zÀ-ÿ]-$/.test(saida) && /^[a-zà-ÿ]/.test(t)) saida = saida.slice(0, -1) + t;
    else saida += " " + t;
  }
  return saida;
}

export function paraMarkdown(doc: mupdf.PDFDocument): string {
  const paginas: Bloco[][] = [];
  for (let i = 0; i < doc.countPages(); i++) paginas.push(blocosDaPagina(doc.loadPage(i)));
  const corpo = tamanhoDoCorpo(paginas);
  const saida: string[] = [];
  paginas.forEach((blocos, i) => {
    if (i > 0) saida.push("---");
    saida.push(`<!-- Página ${i + 1} -->`);
    for (const b of blocos) {
      if (b.tipo !== "texto") continue;
      const chars = b.linhas.reduce((n, l) => n + textoDaLinha(l).length, 0);
      let maior = 0, soma = 0;
      for (const l of b.linhas) for (const t of l.trechos) {
        const n = t.texto.trim().length;
        soma += n;
        maior += t.tamanho * n;
      }
      const tamanho = soma ? maior / soma : corpo;
      const razao = tamanho / corpo;
      if (razao >= 1.15 && chars < 200) {
        const nivel = razao >= 1.8 ? "#" : razao >= 1.4 ? "##" : "###";
        saida.push(`${nivel} ${escaparMd(juntarLinhas(b.linhas.map(textoDaLinha)))}`);
        continue;
      }
      // Paragrafos e itens de lista, linha a linha.
      let paragrafo: string[] = [];
      const fechar = () => {
        if (paragrafo.length) saida.push(juntarLinhas(paragrafo));
        paragrafo = [];
      };
      let lista: string[] = [];
      const fecharLista = () => {
        if (lista.length) saida.push(lista.join("\n"));
        lista = [];
      };
      for (const l of b.linhas) {
        const texto = textoDaLinha(l);
        const md = mdInline(l.trechos);
        const bullet = MARCADOR.exec(texto), num = NUMERADO.exec(texto);
        if (bullet || num) {
          fechar();
          const tirar = (bullet ?? num)![0].length;
          // Tira o marcador do inicio do markdown ja' formatado.
          const semMarca = mdInline(cortarInicio(l.trechos, tirar));
          lista.push(bullet ? `- ${semMarca.trim()}` : `${num![1]}. ${semMarca.trim()}`);
        } else if (lista.length && l.rect[0] > b.rect[0] + 4) {
          lista[lista.length - 1] += " " + md.trim(); // continuacao do item
        } else {
          fecharLista();
          paragrafo.push(md);
        }
      }
      fechar();
      fecharLista();
    }
  });
  return saida.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function cortarInicio(trechos: Trecho[], n: number): Trecho[] {
  const saida: Trecho[] = [];
  let resta = n;
  for (const t of trechos) {
    if (resta >= t.texto.length) {
      resta -= t.texto.length;
      continue;
    }
    saida.push({ ...t, texto: t.texto.slice(resta) });
    resta = 0;
  }
  return saida;
}

// ------------------------------------------------------------ DOCX

function xml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // caracteres de controle nao sao XML valido
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function corHex(c: number[]): string {
  let rgb = c;
  if (c.length === 1) rgb = [c[0], c[0], c[0]];
  else if (c.length === 4) rgb = [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  return rgb.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function fonteWord(nome: string): string {
  const n = nome.replace(/[-,](Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman|MT|PS)+$/gi, "")
    .replace(/(PSMT|MT)$/, "");
  if (/^helvetica|^arial|^nimbussans/i.test(n)) return "Arial";
  if (/^times|^nimbusrom/i.test(n)) return "Times New Roman";
  if (/^courier|^nimbusmono/i.test(n)) return "Courier New";
  return n || "Calibri";
}

function runXml(t: Trecho): string {
  const props = [`<w:rFonts w:ascii="${xml(fonteWord(t.fonte))}" w:hAnsi="${xml(fonteWord(t.fonte))}" w:cs="${xml(fonteWord(t.fonte))}"/>`,
    t.negrito ? "<w:b/>" : "", t.italico ? "<w:i/>" : "",
    corHex(t.cor) !== "000000" ? `<w:color w:val="${corHex(t.cor)}"/>` : "",
    `<w:sz w:val="${Math.max(2, Math.round(t.tamanho * 2))}"/>`].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xml(t.texto)}</w:t></w:r>`;
}

function imagemXml(id: number, rid: string, larguraPt: number, alturaPt: number): string {
  const cx = Math.round(larguraPt * 12700), cy = Math.round(alturaPt * 12700);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="Imagem ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    + `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="imagem${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function paraDocx(doc: mupdf.PDFDocument, titulo = "Documento"): { nome: string; bytes: Uint8Array }[] {
  const enc = new TextEncoder();
  const corpo: string[] = [];
  const midias: { nome: string; bytes: Uint8Array }[] = [];
  const rels: string[] = [];
  let larguraPag = 595, alturaPag = 842;
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const p = doc.loadPage(i);
    const b = p.getBounds();
    if (i === 0) { larguraPag = b[2] - b[0]; alturaPag = b[3] - b[1]; }
    const util = larguraPag - 2 * 56;
    for (const bl of blocosDaPagina(p, true)) {
      if (bl.tipo === "imagem") {
        const k = midias.length + 1;
        const rid = `rIdImg${k}`;
        midias.push({ nome: `word/media/imagem${k}.png`, bytes: bl.png });
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/imagem${k}.png"/>`);
        let w = bl.rect[2] - bl.rect[0], h = bl.rect[3] - bl.rect[1];
        if (w > util) { h *= util / w; w = util; }
        if (w > 1 && h > 1) corpo.push(imagemXml(k, rid, w, h));
        continue;
      }
      // Um paragrafo por bloco; as linhas entram separadas por espaco (ou
      // sem ele, desfazendo a hifenizacao).
      const runs: string[] = [];
      bl.linhas.forEach((l, k) => {
        const trechos = l.trechos.map((t) => ({ ...t }));
        if (k > 0 && trechos.length) {
          const fimAnterior = textoDaLinha(bl.linhas[k - 1]).trimEnd();
          if (!(/[A-Za-zÀ-ÿ]-$/.test(fimAnterior))) trechos[0].texto = " " + trechos[0].texto.trimStart();
        }
        for (const t of trechos) runs.push(runXml(t));
      });
      corpo.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${runs.join("")}</w:p>`);
    }
    if (i < n - 1) corpo.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
  }
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${corpo.join("")}<w:sectPr><w:pgSz w:w="${Math.round(larguraPag * 20)}" w:h="${Math.round(alturaPag * 20)}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const relsRaiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const relsDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(titulo)}</dc:title><dc:creator>EditPDFree</dc:creator></cp:coreProperties>`;
  return [
    { nome: "[Content_Types].xml", bytes: enc.encode(tipos) },
    { nome: "_rels/.rels", bytes: enc.encode(relsRaiz) },
    { nome: "docProps/core.xml", bytes: enc.encode(core) },
    { nome: "word/document.xml", bytes: enc.encode(documento) },
    { nome: "word/_rels/document.xml.rels", bytes: enc.encode(relsDoc) },
    ...midias,
  ];
}

// ------------------------------------------------------------ imagens

export function paginasComoImagens(s: Sessao, dpi: number, formato: "png" | "jpg", indices?: number[]):
  { nome: string; bytes: Uint8Array }[] {
  if (!(dpi >= 24 && dpi <= 600)) throw new Error("Escolha uma resolução entre 24 e 600 dpi.");
  const base = nomeBase(s.nome);
  const lista = indices ?? [...Array(s.paginas).keys()];
  const digitos = Math.max(3, String(s.paginas).length);
  return lista.map((i) => {
    const pix = s.pagina(i).toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      pix.setResolution(dpi, dpi);
      const bytes = formato === "png" ? pix.asPNG().slice() : pix.asJPEG(90).slice();
      return { nome: `${base}_p${String(i + 1).padStart(digitos, "0")}.${formato}`, bytes };
    } finally {
      pix.destroy();
    }
  });
}

/** Todas as imagens embutidas, no formato original quando da' (JPEG, JPEG
 *  2000); as outras (Flate etc.) saem em PNG. */
export function imagensEmbutidas(s: Sessao): { nome: string; bytes: Uint8Array }[] {
  const base = nomeBase(s.nome);
  const saida: { nome: string; bytes: Uint8Array }[] = [];
  const porPagina = new Map<number, number>();
  for (const info of imagensDoDocumento(s.doc).values()) {
    const obj = info.ref.resolve();
    if (obj.get("ImageMask").isBoolean() && obj.get("ImageMask").asBoolean()) continue;
    const k = (porPagina.get(info.primeiraPagina) ?? 0) + 1;
    porPagina.set(info.primeiraPagina, k);
    const prefixo = `${base}_p${String(info.primeiraPagina + 1).padStart(3, "0")}_img${String(k).padStart(2, "0")}`;
    const f = obj.get("Filter");
    const filtro = f.isName() ? f.asName() : "";
    try {
      if (filtro === "DCTDecode") {
        saida.push({ nome: `${prefixo}.jpg`, bytes: bytesDoBuffer(info.ref.readRawStream()) });
      } else if (filtro === "JPXDecode") {
        saida.push({ nome: `${prefixo}.jp2`, bytes: bytesDoBuffer(info.ref.readRawStream()) });
      } else {
        let pix = s.doc.loadImage(info.ref).toPixmap();
        const cs = pix.getColorSpace();
        if (cs && !cs.isRGB() && !cs.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
        saida.push({ nome: `${prefixo}.png`, bytes: pix.asPNG().slice() });
      }
    } catch {
      // imagem que nao decodifica: pula
    }
  }
  return saida;
}

export { ehDocumentoConvertivel, paraPdf } from "./documento.ts";
