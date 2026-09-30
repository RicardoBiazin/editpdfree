/*
 * Criar campos de formulario (texto e caixa de selecao) e sugerir campos
 * automaticamente.
 *
 * O MuPDF.js 1.28 nao tem API para criar widget: o campo e' montado como
 * objeto PDF (dicionario /Widget com /FT, /T, /Rect...), entra no /Annots da
 * pagina e no /Fields do /AcroForm (criado se nao existir). O /Rect de um
 * widget e' guardado no espaco do ARQUIVO; o retangulo chega no espaco pagina
 * e passa por `inverter(ctm)`. A aparencia do campo de texto e' gerada pelo
 * proprio MuPDF (`update()`); a da caixa de selecao e' desenhada aqui (um "X",
 * que fica igual em qualquer rotacao da pagina).
 *
 * DETECCAO (heuristica, o usuario confirma antes de criar):
 *  - sequencias de sublinhados "____" viram campo de texto;
 *  - rotulo terminado em ":" com espaco vazio a direita vira campo de texto;
 *  - quadradinho vazio desenhado (6 a 24 pt) ou o caractere "☐" vira caixa.
 */

import * as mupdf from "mupdf";
import {
  intersecta, inverter, normalizar, transformarRetangulo, uniao, type Matriz, type Retangulo,
} from "./coordenadas.ts";
import { fmt, rotacaoDaPagina, type Sessao } from "./documento.ts";

export type TipoNovoCampo = "texto" | "caixa";
export interface NovoCampo { pagina: number; tipo: TipoNovoCampo; rect: Retangulo; nome?: string }
export interface Sugestao extends NovoCampo { motivo: string }

function acroForm(doc: mupdf.PDFDocument): mupdf.PDFObject {
  const raiz = doc.getTrailer().get("Root");
  let af = raiz.get("AcroForm");
  if (!af.isDictionary()) {
    af = doc.addObject({ Fields: [], DA: "(/Helv 0 Tf 0 g)" });
    raiz.put("AcroForm", af);
  }
  if (!af.get("Fields").isArray()) af.put("Fields", doc.newArray());
  let dr = af.get("DR");
  if (!dr.isDictionary()) {
    dr = doc.newDictionary();
    af.put("DR", dr);
  }
  let fontes = dr.get("Font");
  if (!fontes.isDictionary()) {
    fontes = doc.newDictionary();
    dr.put("Font", fontes);
  }
  if (fontes.get("Helv").isNull()) {
    fontes.put("Helv", doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" }));
  }
  if (af.get("DA").isNull()) af.put("DA", "(/Helv 0 Tf 0 g)");
  return af;
}

function nomesUsados(af: mupdf.PDFObject): Set<string> {
  const nomes = new Set<string>();
  const campos = af.get("Fields");
  for (let i = 0; i < campos.length; i++) {
    const t = campos.get(i).get("T");
    if (t.isString()) nomes.add(t.asString());
  }
  return nomes;
}

function nomeLivre(usados: Set<string>, base: string): string {
  let n = 1;
  while (usados.has(`${base}${n}`)) n++;
  const nome = `${base}${n}`;
  usados.add(nome);
  return nome;
}

function criarUm(doc: mupdf.PDFDocument, af: mupdf.PDFObject, usados: Set<string>, c: NovoCampo): number {
  const p = doc.loadPage(c.pagina);
  const ctm = p.getTransform() as Matriz;
  const r = transformarRetangulo(normalizar(c.rect), inverter(ctm));
  const w = r[2] - r[0], h = r[3] - r[1];
  if (w < 4 || h < 4) throw new Error("O campo é pequeno demais: arraste um retângulo maior.");
  let nome = c.nome?.trim() || "";
  if (!nome || usados.has(nome)) nome = nomeLivre(usados, c.tipo === "texto" ? "texto" : "caixa");
  else usados.add(nome);
  const pobj = p.getObject();
  const rot = rotacaoDaPagina(p);
  const comum = {
    Type: "Annot", Subtype: "Widget", T: `(${nome.replace(/[()\\]/g, "")})`, Rect: r, F: 4, P: pobj,
    BS: { W: 1, S: "S" },
  };
  let w0: mupdf.PDFObject;
  if (c.tipo === "texto") {
    w0 = doc.addObject({ ...comum, FT: "Tx", DA: "(/Helv 0 Tf 0 g)", V: "()",
      MK: { BC: [0.45, 0.45, 0.45], R: rot } });
  } else {
    // "X" desenhado na caixa: simetrico, fica igual a 0/90/180/270 graus.
    const m = Math.min(w, h) * 0.22;
    const marcado = doc.addStream(
      `q 0 g 1.2 w ${fmt(m)} ${fmt(m)} m ${fmt(w - m)} ${fmt(h - m)} l S ${fmt(m)} ${fmt(h - m)} m ${fmt(w - m)} ${fmt(m)} l S Q`,
      { Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h] });
    const vazio = doc.addStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, w, h] });
    w0 = doc.addObject({ ...comum, FT: "Btn", V: "Off", AS: "Off", MK: { BC: [0.45, 0.45, 0.45], CA: "(8)", R: rot } });
    const ap = doc.newDictionary();
    const n = doc.newDictionary();
    n.put("Sim", marcado);
    n.put("Off", vazio);
    ap.put("N", n);
    w0.put("AP", ap);
  }
  const antigas = pobj.get("Annots");
  const lista = doc.newArray();
  if (antigas.isArray()) for (let i = 0; i < antigas.length; i++) lista.push(antigas.get(i));
  lista.push(w0);
  pobj.put("Annots", lista);
  af.get("Fields").push(w0);
  return w0.asIndirect();
}

/** Cria os campos (uma operacao so', desfazivel). Devolve os ids. */
export function criarCampos(s: Sessao, campos: NovoCampo[]): number[] {
  if (!campos.length) return [];
  for (const c of campos) s.pagina(c.pagina);
  return s.operacao(campos.length === 1 ? (campos[0].tipo === "texto" ? "Criar campo de texto" : "Criar caixa de seleção")
    : "Criar campos do formulário", () => {
    const af = acroForm(s.doc);
    const usados = nomesUsados(af);
    const ids = campos.map((c) => criarUm(s.doc, af, usados, c));
    s.recarregar();
    // Aparencia do campo de texto (borda), gerada pelo MuPDF.
    for (const pg of new Set(campos.filter((c) => c.tipo === "texto").map((c) => c.pagina))) {
      for (const w of s.pagina(pg).getWidgets()) if (ids.includes(w.getObject().asIndirect())) w.update();
    }
    return ids;
  });
}

// ------------------------------------------------------------ deteccao

interface Car { c: string; r: Retangulo }
interface LinhaTexto { cars: Car[]; rect: Retangulo }

function linhasDaPagina(p: mupdf.PDFPage): LinhaTexto[] {
  const st = p.toStructuredText("preserve-whitespace");
  const linhas: LinhaTexto[] = [];
  let atual: LinhaTexto | null = null;
  try {
    st.walk({
      beginLine(bbox) { atual = { cars: [], rect: bbox as Retangulo }; },
      onChar(c, _o, _f, _t, q) {
        atual?.cars.push({ c, r: [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])] });
      },
      endLine() {
        if (atual && atual.cars.length) linhas.push(atual);
        atual = null;
      },
    });
  } finally {
    st.destroy();
  }
  return linhas;
}

function areaIntersecao(a: Retangulo, b: Retangulo): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(r: Retangulo): number {
  return (r[2] - r[0]) * (r[3] - r[1]);
}

export function detectarCampos(p: mupdf.PDFPage, pagina: number): Sugestao[] {
  const b = p.getBounds() as Retangulo;
  const linhas = linhasDaPagina(p);
  const sugestoes: Sugestao[] = [];
  const todosCars = linhas.flatMap((l) => l.cars);

  // 1. Sublinhados e caixinhas de texto.
  for (const l of linhas) {
    let run: Retangulo | null = null, n = 0;
    const fechar = () => {
      if (run && n >= 4) {
        const altura = Math.max(14, run[3] - run[1]);
        sugestoes.push({ pagina, tipo: "texto", rect: [run[0], run[3] - altura, run[2], run[3]], motivo: "linha de sublinhados" });
      }
      run = null;
      n = 0;
    };
    for (const k of l.cars) {
      if (k.c === "_") {
        run = run ? uniao(run, k.r) : k.r;
        n++;
      } else {
        fechar();
        if (k.c === "☐" || k.c === "□") {
          sugestoes.push({ pagina, tipo: "caixa", rect: k.r, motivo: "caractere de caixa" });
        }
      }
    }
    fechar();
  }

  // 2. Rotulo terminado em ":" com espaco livre a direita.
  for (const l of linhas) {
    const texto = l.cars.map((k) => k.c).join("").trimEnd();
    if (!texto.endsWith(":") || texto.length > 40) continue;
    const ultimo = [...l.cars].reverse().find((k) => k.c.trim())!;
    const x0 = ultimo.r[2] + 6;
    const [y0, y1] = [l.rect[1], l.rect[3]];
    let limite = b[2] - 36;
    for (const k of todosCars) {
      if (!k.c.trim() || k.r[0] < x0 - 1) continue;
      if (k.r[1] < y1 && k.r[3] > y0) limite = Math.min(limite, k.r[0] - 4);
    }
    const livre = limite - x0;
    if (livre < 60) continue;
    const altura = Math.max(14, y1 - y0);
    const meio = (y0 + y1) / 2;
    sugestoes.push({ pagina, tipo: "texto", rect: [x0, meio - altura / 2, x0 + Math.min(livre, 260), meio + altura / 2],
      motivo: `rótulo “${texto}”` });
  }

  // 3. Quadradinhos vazios desenhados.
  const quadrados: Retangulo[] = [];
  const traco = new mupdf.StrokeState({ lineCap: "Butt", lineJoin: "Miter", lineWidth: 0, miterLimit: 10 });
  const olhar = (path: mupdf.Path, ctm: mupdf.Matrix) => {
    const r = path.getBounds(traco, ctm) as Retangulo;
    const w = r[2] - r[0], h = r[3] - r[1];
    if (w >= 6 && w <= 24 && h >= 6 && h <= 24 && Math.abs(w - h) <= 0.25 * Math.max(w, h)) quadrados.push(r);
  };
  const dev = new mupdf.Device({
    strokePath: (path, _s, ctm) => olhar(path, ctm),
    fillPath: (path, _e, ctm) => olhar(path, ctm),
  });
  try {
    p.runPageContents(dev, mupdf.Matrix.identity);
  } finally {
    dev.close();
  }
  for (const q of quadrados) {
    if (todosCars.some((k) => k.c.trim() && intersecta(k.r, q))) continue;
    sugestoes.push({ pagina, tipo: "caixa", rect: q, motivo: "quadrado vazio" });
  }

  // Fora do que ja' e' campo, e sem repeticao (a primeira regra vence).
  const existentes = p.getWidgets().map((w) => w.getBounds() as Retangulo);
  const finais: Sugestao[] = [];
  for (const sg of sugestoes) {
    const r = sg.rect;
    if (r[0] < b[0] || r[2] > b[2] + 1) continue;
    const sobrepoe = (o: Retangulo) => areaIntersecao(o, r) > 0.4 * Math.min(area(o), area(r));
    if (existentes.some(sobrepoe) || finais.some((f) => sobrepoe(f.rect))) continue;
    finais.push(sg);
  }
  return finais;
}
