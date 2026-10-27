/*
 * Escrever no CONTEUDO da pagina (nao em anotacao): texto, imagem, assinatura.
 *
 * Imagem e assinatura entram no conteudo: e' o que se espera de uma assinatura,
 * que nao deve sair com um clique em "excluir anotacao".
 *
 * As posicoes chegam no espaco pagina (o que o leitor ve). A matriz de desenho
 * e' montada nesse espaco e levada ao espaco PDF por
 * `matrizPaginaParaConteudo` -- assim texto e imagem saem de pe' para o leitor
 * em pagina girada sem nenhum caso especial por rotacao.
 *
 * Texto usa as fontes Base-14 (Helvetica, Times, Courier) com
 * WinAnsiEncoding, sem embutir: todo leitor de PDF as tem. So' os caracteres
 * do WinAnsi (Latin-1 + aspas tipograficas, travessao, euro...) sao
 * representaveis; o resto vira "?".
 */

import * as mupdf from "mupdf";
import {
  matrizPaginaParaConteudo, normalizar, paginaParaPdf, pdfParaPagina, deslocamentoPaginaParaPdf,
  type Matriz, type Ponto, type Retangulo,
} from "./coordenadas.ts";
import { fmt, geometria, type Sessao } from "./documento.ts";
import type { Cor } from "./anotacoes.ts";

export { nomeBase14, type Familia } from "./trecho.ts";

const WINANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Unicode -> bytes WinAnsi (o que nao existe vira "?"). */
export function codificarWinAnsi(texto: string): number[] {
  const saida: number[] = [];
  for (const ch of texto) {
    const u = ch.codePointAt(0)!;
    if (u === 0x09) saida.push(0x20);
    else if ((u >= 0x20 && u < 0x7f) || (u >= 0xa0 && u <= 0xff)) saida.push(u);
    else if (WINANSI_EXTRA[u] !== undefined) saida.push(WINANSI_EXTRA[u]);
    else saida.push(0x3f);
  }
  return saida;
}

function hex(bytes: number[]): string {
  return "<" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("") + ">";
}

const fontesMedida = new Map<string, mupdf.Font>();

/** Largura do texto em pontos, com as metricas da fonte Base-14. */
export function larguraTexto(texto: string, fonte: string, tamanho: number): number {
  let f = fontesMedida.get(fonte);
  if (!f) {
    f = new mupdf.Font(fonte);
    fontesMedida.set(fonte, f);
  }
  let w = 0;
  for (const ch of texto) w += f.advanceGlyph(f.encodeCharacter(ch.codePointAt(0)!));
  return w * tamanho;
}

function matrizPdf(m: Matriz): string {
  return m.map(fmt).join(" ");
}

function corRg(c: Cor): string {
  return c.map((v) => fmt(Math.max(0, Math.min(1, v)))).join(" ");
}

/** Monta recursos novos para a pagina sem mexer nos antigos (que podem ser
 *  compartilhados com outras paginas) e acrescenta um trecho de conteudo. */
export class Acrescimo {
  private doc: mupdf.PDFDocument;
  private pagina: mupdf.PDFPage;
  private novos: Record<string, [string, mupdf.PDFObject][]> = {};
  private existentes: mupdf.PDFObject;
  private contador = 0;

  constructor(doc: mupdf.PDFDocument, pagina: mupdf.PDFPage) {
    this.doc = doc;
    this.pagina = pagina;
    this.existentes = pagina.getObject().getInheritable("Resources");
  }

  /** Registra um recurso e devolve o nome pelo qual o conteudo o chama. */
  recurso(categoria: "Font" | "XObject" | "ExtGState", obj: mupdf.PDFObject): string {
    const antigos = this.existentes.isDictionary() ? this.existentes.get(categoria) : mupdf.PDFObject.Null;
    const lista = (this.novos[categoria] ??= []);
    let nome: string;
    do {
      nome = `EPF${categoria[0]}${++this.contador}`;
    } while ((antigos.isDictionary() && !antigos.get(nome).isNull()) || lista.some(([n]) => n === nome));
    lista.push([nome, obj]);
    return nome;
  }

  private fontes = new Map<string, string>();

  fonteBase14(nome: string): string {
    let r = this.fontes.get(nome);
    if (!r) {
      r = this.recurso("Font", this.doc.addObject({
        Type: "Font", Subtype: "Type1", BaseFont: nome, Encoding: "WinAnsiEncoding",
      }));
      this.fontes.set(nome, r);
    }
    return r;
  }

  opacidade(valor: number): string {
    const v = Math.max(0, Math.min(1, valor));
    return this.recurso("ExtGState", this.doc.addObject({ Type: "ExtGState", ca: v, CA: v }));
  }

  /** `sob`: o trecho vai ANTES do conteudo existente (fica por baixo dele).
   *  Com `item`, o trecho vira um ITEM movel (ver `listarItens`). Devolve o
   *  numero do objeto do trecho. */
  gravar(conteudo: string, sob = false, item?: ItemConteudo): number {
    const doc = this.doc;
    const pobj = this.pagina.getObject();
    const res = doc.newDictionary();
    if (this.existentes.isDictionary()) {
      this.existentes.forEach((v, k) => res.put(k, v));
    }
    for (const [cat, itens] of Object.entries(this.novos)) {
      const sub = doc.newDictionary();
      const antigo = this.existentes.isDictionary() ? this.existentes.get(cat) : mupdf.PDFObject.Null;
      if (antigo.isDictionary()) antigo.forEach((v, k) => sub.put(k, v));
      for (const [nome, obj] of itens) sub.put(nome, obj);
      res.put(cat, sub);
    }
    pobj.put("Resources", res);
    // O conteudo antigo vai entre q/Q: se ele deixar a matriz alterada no
    // fim (acontece), o nosso trecho continuaria no lugar certo.
    const antigo = pobj.get("Contents");
    const lista = doc.newArray();
    if (antigo.isArray() || antigo.isStream()) {
      lista.push(doc.addStream("q\n", {}));
      if (antigo.isArray()) {
        for (let i = 0; i < antigo.length; i++) lista.push(antigo.get(i));
      } else {
        lista.push(pobj.get("Contents"));
      }
      lista.push(doc.addStream("\nQ\n", {}));
    }
    const nosso = item
      ? doc.addStream(`q 1 0 0 1 0 0 cm\n${conteudo}\nQ\n`,
        { [CHAVE_ITEM]: item.tipo, [CHAVE_CAIXA]: retanguloParaPdf(this.pagina, item.rect) })
      : doc.addStream("q\n" + conteudo + "\nQ\n", {});
    if (sob) {
      const comNosso = doc.newArray();
      comNosso.push(nosso);
      for (let i = 0; i < lista.length; i++) comNosso.push(lista.get(i));
      pobj.put("Contents", comNosso);
    } else {
      lista.push(nosso);
      pobj.put("Contents", lista);
    }
    return nosso.asIndirect();
  }
}

// ------------------------------------------------------------ itens moveis

/*
 * Texto, imagem e assinatura inseridos vao para o CONTEUDO da pagina (nao sao
 * anotacao: nao somem com um clique em "excluir anotacao" e saem em qualquer
 * leitor/impressora). Para poderem ser arrastados depois, cada um fica num
 * fluxo de conteudo proprio, marcado no dicionario do fluxo:
 *   /EPFItem /Texto   /EPFCaixa [x0 y0 x1 y1]  (espaco PDF)
 * e comecando por "q 1 0 0 1 tx ty cm": mover e' so' trocar tx ty.
 * O texto guarda tambem o que foi digitado e o estilo (/EPFTexto, /EPFTam,
 * /EPFCor, /EPFFonte e /EPFOrigem, a linha de base no espaco PDF antes do
 * deslocamento) para poder ser editado depois.
 * Uma operacao que reescreve o conteudo da pagina inteira (tarja, editar
 * texto) junta os fluxos e o item vira conteudo comum, fixo.
 */

export type TipoItem = "Texto" | "Imagem" | "Assinatura";
export interface ItemConteudo { tipo: TipoItem; rect: Retangulo }

const CHAVE_ITEM = "EPFItem";
const CHAVE_CAIXA = "EPFCaixa";
const PREFIXO = /^q 1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n/;

export const NOMES_ITEM: Record<TipoItem, string> = {
  Texto: "Texto inserido", Imagem: "Imagem", Assinatura: "Assinatura",
};

function retanguloParaPdf(p: mupdf.PDFPage, r: Retangulo): number[] {
  const g = geometria(p);
  const a = paginaParaPdf(g, [r[0], r[1]]), b = paginaParaPdf(g, [r[2], r[3]]);
  return normalizar([a[0], a[1], b[0], b[1]]);
}

function retanguloParaPagina(p: mupdf.PDFPage, r: number[]): Retangulo {
  const g = geometria(p);
  const a = pdfParaPagina(g, [r[0], r[1]]), b = pdfParaPagina(g, [r[2], r[3]]);
  return normalizar([a[0], a[1], b[0], b[1]]);
}

/** Os fluxos de conteudo da pagina, na ordem. */
function fluxos(p: mupdf.PDFPage): mupdf.PDFObject[] {
  const c = p.getObject().get("Contents");
  if (c.isArray()) {
    const r: mupdf.PDFObject[] = [];
    for (let i = 0; i < c.length; i++) r.push(c.get(i));
    return r;
  }
  return c.isStream() ? [c] : [];
}

function ehItem(f: mupdf.PDFObject): boolean {
  return f.isStream() && f.get(CHAVE_ITEM).isName() && f.get(CHAVE_CAIXA).isArray();
}

export interface InfoItem { id: number; tipo: TipoItem; nome: string; limites: Retangulo; texto: string }

/** O que foi digitado num item de texto (para editar depois). */
export interface DadosItemTexto { texto: string; tamanho: number; cor: Cor; fonte: string }

/** Itens moveis da pagina (espaco pagina). */
export function listarItens(p: mupdf.PDFPage): InfoItem[] {
  const lista: InfoItem[] = [];
  for (const f of fluxos(p)) {
    if (!ehItem(f) || !f.isIndirect()) continue;
    const tipo = f.get(CHAVE_ITEM).asName() as TipoItem;
    const caixa = f.get(CHAVE_CAIXA);
    const nums: number[] = [];
    for (let i = 0; i < caixa.length; i++) nums.push(caixa.get(i).asNumber());
    const txt = f.get("EPFTexto");
    lista.push({ id: f.asIndirect(), tipo, nome: NOMES_ITEM[tipo] ?? "Item", limites: retanguloParaPagina(p, nums),
      texto: txt.isString() ? txt.asString() : "" });
  }
  return lista;
}

export function ehItemDaPagina(p: mupdf.PDFPage, id: number): boolean {
  return fluxos(p).some((f) => f.isIndirect() && f.asIndirect() === id && ehItem(f));
}

function acharItem(p: mupdf.PDFPage, id: number): mupdf.PDFObject {
  const f = fluxos(p).find((x) => x.isIndirect() && x.asIndirect() === id && ehItem(x));
  if (!f) throw new Error("Item não encontrado.");
  return f;
}

/** Desloca o item em (dx, dy) pontos no espaco pagina. */
export function moverItem(s: Sessao, pagina: number, id: number, dx: number, dy: number): void {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  acharItem(s.pagina(pagina), id);
  s.operacao("Mover item", () => {
    const p = s.pagina(pagina);
    const f = acharItem(p, id);
    const [px, py] = deslocamentoPaginaParaPdf(geometria(p), dx, dy);
    const dados = f.readStream().asString();
    const m = PREFIXO.exec(dados);
    if (!m) throw new Error("Item não encontrado.");
    const tx = Number(m[1]) + px, ty = Number(m[2]) + py;
    f.writeStream(`q 1 0 0 1 ${fmt(tx)} ${fmt(ty)} cm\n` + dados.slice(m[0].length));
    const caixa = f.get(CHAVE_CAIXA);
    const nova = s.doc.newArray();
    for (let i = 0; i < caixa.length; i++) nova.push(caixa.get(i).asNumber() + (i % 2 === 0 ? px : py));
    f.put(CHAVE_CAIXA, nova);
  });
}

/** Texto e estilo de um item de texto (null: nao e' texto editavel). */
export function dadosItemTexto(p: mupdf.PDFPage, id: number): DadosItemTexto | null {
  const f = acharItem(p, id);
  const t = f.get("EPFTexto"), cor = f.get("EPFCor");
  if (!t.isString() || !f.get("EPFOrigem").isArray()) return null;
  const c: Cor = cor.isArray() && cor.length === 3 ? [cor.get(0).asNumber(), cor.get(1).asNumber(), cor.get(2).asNumber()] : [0, 0, 0];
  return { texto: t.asString(), tamanho: f.get("EPFTam").isNumber() ? f.get("EPFTam").asNumber() : 12, cor: c,
    fonte: f.get("EPFFonte").isName() ? f.get("EPFFonte").asName() : "Helvetica" };
}

/** Troca o texto (e o estilo) de um item de texto, no lugar onde ele esta'
 *  agora. O item e' reescrito: sai do conteudo e volta com o texto novo (o id
 *  muda -- e' devolvido). */
export function editarItemTexto(s: Sessao, pagina: number, id: number, texto: string,
  opcoes: OpcoesTexto = {}): number {
  if (!texto.trim()) throw new Error("Digite o texto.");
  const atual = dadosItemTexto(s.pagina(pagina), id);
  if (!atual) throw new Error("Este item não é um texto editável.");
  return s.operacao("Editar texto inserido", () => {
    const p = s.pagina(pagina);
    const f = acharItem(p, id);
    const o = f.get("EPFOrigem");
    const m = PREFIXO.exec(f.readStream().asString());
    const tx = m ? Number(m[1]) : 0, ty = m ? Number(m[2]) : 0;
    const origem = pdfParaPagina(geometria(p), [o.get(0).asNumber() + tx, o.get(1).asNumber() + ty]);
    const lista = s.doc.newArray();
    for (const x of fluxos(p)) if (!(x.isIndirect() && x.asIndirect() === id)) lista.push(x);
    p.getObject().put("Contents", lista);
    return escreverTexto(s, s.pagina(pagina), origem, texto,
      { tamanho: atual.tamanho, cor: atual.cor, fonte: atual.fonte, ...opcoes }, 0, true);
  });
}

/** Tira o item do conteudo da pagina. */
export function excluirItem(s: Sessao, pagina: number, id: number): void {
  acharItem(s.pagina(pagina), id);
  s.operacao("Excluir item", () => {
    const p = s.pagina(pagina);
    const pobj = p.getObject();
    const lista = s.doc.newArray();
    for (const f of fluxos(p)) {
      if (!(f.isIndirect() && f.asIndirect() === id)) lista.push(f);
    }
    pobj.put("Contents", lista);
  });
}

export interface OpcoesTexto {
  tamanho?: number;
  cor?: Cor;
  fonte?: string;
  opacidade?: number;
}

/** Operadores de UMA linha de texto com a linha de base em `origem` (espaco
 *  pagina), girada de `angulo` graus no sentido anti-horario visto pelo
 *  leitor (positivo sobe para a direita). */
function operadoresLinha(ac: Acrescimo, p: mupdf.PDFPage, origem: Ponto, texto: string,
  op: Required<OpcoesTexto>, angulo = 0, gs?: string): string {
  const g = geometria(p);
  const rad = angulo * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
  // Glifo tem y para cima; o espaco pagina, para baixo.
  const tm = matrizPaginaParaConteudo(g, [c, -sn, -sn, -c, origem[0], origem[1]]);
  const nomeFonte = ac.fonteBase14(op.fonte);
  return [gs ? `/${gs} gs` : "", "BT", `/${nomeFonte} ${fmt(op.tamanho)} Tf`, `${corRg(op.cor)} rg`,
    `${matrizPdf(tm)} Tm`, `${hex(codificarWinAnsi(texto))} Tj`, "ET"].filter(Boolean).join("\n");
}

function completar(op: OpcoesTexto): Required<OpcoesTexto> {
  return { tamanho: op.tamanho ?? 12, cor: op.cor ?? [0, 0, 0], fonte: op.fonte ?? "Helvetica",
    opacidade: op.opacidade ?? 1 };
}

/** Escreve texto (pode ter varias linhas) sem abrir operacao -- para compor. */
export function escreverTexto(s: Sessao, p: mupdf.PDFPage, origem: Ponto, texto: string,
  opcoes: OpcoesTexto = {}, angulo = 0, comoItem = false): number {
  const op = completar(opcoes);
  const ac = new Acrescimo(s.doc, p);
  const gs = op.opacidade < 1 ? ac.opacidade(op.opacidade) : undefined;
  const rad = angulo * Math.PI / 180;
  const partes = texto.split(/\r?\n/).map((linha, i) => {
    // Linha seguinte: desce ao longo do "para baixo" do texto.
    const d = i * op.tamanho * 1.2;
    const o: Ponto = [origem[0] + d * Math.sin(rad), origem[1] + d * Math.cos(rad)];
    return operadoresLinha(ac, p, o, linha, op, angulo, i === 0 ? gs : undefined);
  });
  let item: ItemConteudo | undefined;
  if (comoItem && angulo === 0) {
    // Caixa do texto (espaco pagina): do topo das letras ao pe' da ultima linha.
    const linhas = texto.split(/\r?\n/);
    const w = Math.max(...linhas.map((l) => larguraTexto(l, op.fonte, op.tamanho)), op.tamanho * 0.5);
    item = { tipo: "Texto", rect: [origem[0], origem[1] - op.tamanho * 0.85, origem[0] + w,
      origem[1] + (linhas.length - 1) * op.tamanho * 1.2 + op.tamanho * 0.25] };
  }
  const id = ac.gravar(partes.join("\n"), false, item);
  if (item) {
    // Para editar depois: o texto, o estilo e a linha de base (espaco PDF).
    const f = s.doc.newIndirect(id);
    const o = paginaParaPdf(geometria(p), origem);
    f.put("EPFTexto", s.doc.newString(texto));
    f.put("EPFTam", op.tamanho);
    f.put("EPFCor", op.cor);
    f.put("EPFFonte", s.doc.newName(op.fonte));
    f.put("EPFOrigem", o);
  }
  return id;
}

/** Texto novo no conteudo da pagina, linha de base em `origem` (espaco pagina). */
export function inserirTexto(s: Sessao, pagina: number, origem: Ponto, texto: string,
  opcoes: OpcoesTexto = {}): number {
  if (!texto.trim()) throw new Error("Digite o texto.");
  return s.operacao("Adicionar texto", () => escreverTexto(s, s.pagina(pagina), origem, texto, opcoes, 0, true));
}

/** Imagem no conteudo da pagina, mantendo a proporcao e centrada em `rect`
 *  (espaco pagina). Sai de pe' para o leitor mesmo em pagina girada. */
export function inserirImagem(s: Sessao, pagina: number, rect: Retangulo, bytes: Uint8Array,
  descricao = "Inserir imagem"): number {
  let img: mupdf.Image;
  try {
    img = new mupdf.Image(bytes);
  } catch {
    throw new Error("Não foi possível ler a imagem.");
  }
  const r = normalizar(rect);
  const larg = r[2] - r[0], alt = r[3] - r[1];
  if (larg < 1 || alt < 1) throw new Error("Área pequena demais para a imagem.");
  const escala = Math.min(larg / img.getWidth(), alt / img.getHeight());
  const w = img.getWidth() * escala, h = img.getHeight() * escala;
  const x0 = r[0] + (larg - w) / 2, y0 = r[1] + (alt - h) / 2;
  return s.operacao(descricao, () => {
    const p = s.pagina(pagina);
    const ac = new Acrescimo(s.doc, p);
    const nome = ac.recurso("XObject", s.doc.addImage(img));
    // Quadrado unitario da imagem (y para cima) -> retangulo no espaco pagina.
    const cm = matrizPaginaParaConteudo(geometria(p), [w, 0, 0, -h, x0, y0 + h]);
    return ac.gravar(`${matrizPdf(cm)} cm\n/${nome} Do`, false,
      { tipo: descricao === "Assinatura" ? "Assinatura" : "Imagem", rect: [x0, y0, x0 + w, y0 + h] });
  });
}
