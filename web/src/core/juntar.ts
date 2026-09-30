/*
 * Juntar varios arquivos num PDF so', na ordem escolhida.
 *
 * Cada item pode ser PDF, imagem ou documento (Office, HTML, EPUB, TXT...),
 * convertido por `abrirComoPdf`, com senha e intervalo de paginas proprios
 * ("1-3, 5, 8-"; vazio = todas). O que vai junto de cada pagina:
 *  - anotacoes (via `enxertarPagina`);
 *  - CAMPOS DE FORMULARIO: cada campo e' recriado no /AcroForm do resultado.
 *    Campo em hierarquia ("pai.filho") vira um campo de primeiro nivel com o
 *    nome completo (pontos trocados por "_"); nome que ja' existe no resultado
 *    ganha sufixo ("nome_2") -- dois arquivos com o campo "nome" viram campos
 *    independentes, e nao um campo so' preenchido nos dois lugares;
 *  - marcadores (sumario) de cada arquivo, remapeados para a posicao nova;
 *    com `marcadores`, cada arquivo ganha um marcador de primeiro nivel com o
 *    nome dele e o sumario original fica por baixo.
 * Links internos (de uma pagina para outra) nao vem junto: o destino seria
 * a pagina do documento de origem (mesma limitacao de "Inserir PDF").
 */

import * as mupdf from "mupdf";
import { abrirComoPdf, bytesDoBuffer } from "./documento.ts";
import { enxertarPagina } from "./paginas.ts";
import { lerIntervalos } from "./intervalos.ts";
import { acroForm } from "./criarcampos.ts";

export interface ItemJuntar {
  bytes: Uint8Array;
  nome: string;
  tipo?: string;
  senha?: string;
  /** "1-3, 5, 8-"; vazio = todas. */
  intervalo?: string;
}

export interface OpcoesJuntar {
  /** Um marcador de primeiro nivel com o nome de cada arquivo. */
  marcadores?: boolean;
}

export interface InfoArquivo {
  paginas: number;
  /** Miniatura da primeira pagina (PNG), ou null se pede senha/deu erro. */
  miniatura: Uint8Array | null;
  precisaSenha: boolean;
  senhaErrada: boolean;
  erro: string | null;
}

/** Conta as paginas e faz a miniatura da primeira (lado maior = `lado` px). */
export function infoArquivo(bytes: Uint8Array, nome: string, tipo = "", senha?: string, lado = 96): InfoArquivo {
  let doc: mupdf.PDFDocument;
  try {
    doc = abrirComoPdf(bytes, nome, senha, tipo).doc;
  } catch (e) {
    const err = e as Error & { errada?: boolean };
    if (err.name === "SenhaNecessaria") {
      return { paginas: 0, miniatura: null, precisaSenha: true, senhaErrada: !!err.errada, erro: null };
    }
    return { paginas: 0, miniatura: null, precisaSenha: false, senhaErrada: false, erro: err.message };
  }
  try {
    const p = doc.loadPage(0);
    const b = p.getBounds();
    const escala = lado / Math.max(b[2] - b[0], b[3] - b[1]);
    const pix = p.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pix.asPNG().slice();
    pix.destroy();
    return { paginas: doc.countPages(), miniatura: png, precisaSenha: false, senhaErrada: false, erro: null };
  } finally {
    doc.destroy();
  }
}

// ------------------------------------------------------------ campos de formulario

const HERDAVEIS = ["FT", "Ff", "V", "DV", "DA", "Opt", "MaxLen", "Q", "TI", "I"];

function nomeCompleto(campo: mupdf.PDFObject): string {
  const partes: string[] = [];
  let atual: mupdf.PDFObject = campo;
  for (let n = 0; n < 32 && atual.isDictionary(); n++) {
    const t = atual.get("T");
    if (t.isString()) partes.unshift(t.asString());
    atual = atual.get("Parent");
  }
  return partes.join(".");
}

function herdado(campo: mupdf.PDFObject, chave: string): mupdf.PDFObject {
  let atual: mupdf.PDFObject = campo;
  for (let n = 0; n < 32 && atual.isDictionary(); n++) {
    const v = atual.get(chave);
    if (!v.isNull()) return v;
    atual = atual.get("Parent");
  }
  return mupdf.PDFObject.Null;
}

class Campos {
  private destino: mupdf.PDFDocument;
  private nomes = new Set<string>();
  private af: mupdf.PDFObject | null = null;
  /** Campo terminal da origem (por objeto) -> campo novo. Vale por fonte. */
  private novos = new Map<number, mupdf.PDFObject>();

  constructor(destino: mupdf.PDFDocument) {
    this.destino = destino;
  }

  novaFonte(fonte: mupdf.PDFDocument, mapa: mupdf.PDFGraftMap): void {
    this.novos.clear();
    const afFonte = fonte.getTrailer().get("Root").get("AcroForm");
    if (!afFonte.isDictionary()) return;
    const af = this.acroForm();
    // Fontes do formulario (/DR) que o destino ainda nao tem.
    // (get() num PDFObject.Null quebra no MuPDF.js: conferir cada nivel)
    const drFonte = afFonte.get("DR");
    const fontesFonte = drFonte.isDictionary() ? drFonte.get("Font") : mupdf.PDFObject.Null;
    if (fontesFonte.isDictionary()) {
      const fontes = af.get("DR").get("Font");
      fontesFonte.forEach((v, k) => {
        if (fontes.get(k as string).isNull()) fontes.put(k, mapa.graftObject(v));
      });
    }
    const na = afFonte.get("NeedAppearances");
    if (na.isBoolean() && na.asBoolean()) af.put("NeedAppearances", true);
  }

  private acroForm(): mupdf.PDFObject {
    if (!this.af) this.af = acroForm(this.destino);
    return this.af;
  }

  private nomeLivre(nome: string): string {
    const base = nome.replace(/\./g, "_") || "campo";
    let n = base, k = 2;
    while (this.nomes.has(n)) n = `${base}_${k++}`;
    this.nomes.add(n);
    return n;
  }

  private copiar(obj: mupdf.PDFObject, mapa: mupdf.PDFGraftMap, fora: string[]): mupdf.PDFObject {
    const copia = this.destino.newDictionary();
    obj.forEach((v, k) => {
      if (fora.includes(k as string)) return;
      copia.put(k, mapa.graftObject(v));
    });
    return copia;
  }

  private herdar(copia: mupdf.PDFObject, origem: mupdf.PDFObject, mapa: mupdf.PDFGraftMap): void {
    for (const k of HERDAVEIS) {
      if (!copia.get(k).isNull()) continue;
      const v = herdado(origem, k);
      if (!v.isNull()) copia.put(k, mapa.graftObject(v));
    }
  }

  /** Copia o widget `ref` (da pagina de origem) para a pagina `pagina` do destino. */
  widget(ref: mupdf.PDFObject, mapa: mupdf.PDFGraftMap, pagina: mupdf.PDFObject): mupdf.PDFObject {
    const w = ref.resolve();
    const fields = this.acroForm().get("Fields");
    if (w.get("T").isString()) {
      // Campo e widget no mesmo objeto.
      const novo = this.copiar(w, mapa, ["P", "Parent", "Popup", "Kids"]);
      this.herdar(novo, w, mapa);
      novo.put("T", `(${this.nomeLivre(nomeCompleto(w)).replace(/[()\\]/g, "")})`);
      novo.put("P", pagina);
      const ind = this.destino.addObject(novo);
      fields.push(ind);
      return ind;
    }
    // Widget filho de um campo terminal (ex.: botoes de opcao de um grupo).
    const refPai = w.get("Parent");
    const pai = refPai.resolve();
    const numPai = refPai.isIndirect() ? refPai.asIndirect() : -1;
    let campo = numPai >= 0 ? this.novos.get(numPai) : undefined;
    if (!campo) {
      const novo = this.copiar(pai, mapa, ["Parent", "Kids", "P"]);
      this.herdar(novo, pai, mapa);
      novo.put("T", `(${this.nomeLivre(nomeCompleto(pai)).replace(/[()\\]/g, "")})`);
      novo.put("Kids", this.destino.newArray());
      campo = this.destino.addObject(novo);
      fields.push(campo);
      if (numPai >= 0) this.novos.set(numPai, campo);
    }
    const filho = this.copiar(w, mapa, ["P", "Parent", "Popup"]);
    filho.put("Parent", campo);
    filho.put("P", pagina);
    const ind = this.destino.addObject(filho);
    campo.get("Kids").push(ind);
    return ind;
  }
}

// ------------------------------------------------------------ marcadores

interface NoMarcador { titulo: string; pagina: number | null; filhos: NoMarcador[] }

type ItemOutline = { title?: string; page?: number; down?: ItemOutline[] };

function remapear(itens: ItemOutline[] | null, posicao: Map<number, number>): NoMarcador[] {
  const saida: NoMarcador[] = [];
  for (const it of itens ?? []) {
    const filhos = remapear(it.down ?? null, posicao);
    const pagina = typeof it.page === "number" ? posicao.get(it.page) ?? null : null;
    // Marcador de pagina que ficou de fora: some, a menos que tenha filhos.
    if (pagina === null && !filhos.length) continue;
    saida.push({ titulo: (it.title ?? "").trim() || "(sem título)", pagina: pagina ?? filhos[0].pagina, filhos });
  }
  return saida;
}

function escreverOutline(doc: mupdf.PDFDocument, nos: NoMarcador[]): void {
  if (!nos.length) return;
  const raiz = doc.addObject({ Type: "Outlines" });
  const escrever = (lista: NoMarcador[], pai: mupdf.PDFObject): number => {
    const objs = lista.map((n) => {
      const o = doc.addObject({ Title: doc.newString(n.titulo), Parent: pai });
      if (n.pagina !== null) o.put("Dest", [doc.findPage(n.pagina), "Fit"]);
      return o;
    });
    let total = objs.length;
    objs.forEach((o, i) => {
      if (i > 0) o.put("Prev", objs[i - 1]);
      if (i < objs.length - 1) o.put("Next", objs[i + 1]);
      const filhos = lista[i].filhos;
      if (filhos.length) {
        total += escrever(filhos, o);
        o.put("Count", -filhos.length); // fechados por padrao
      }
    });
    pai.put("First", objs[0]);
    pai.put("Last", objs[objs.length - 1]);
    return total;
  };
  raiz.put("Count", escrever(nos, raiz));
  doc.getTrailer().get("Root").put("Outlines", raiz);
}

// ------------------------------------------------------------ juntar

export function juntarArquivos(itens: ItemJuntar[], op: OpcoesJuntar = {}): Uint8Array {
  if (!itens.length) throw new Error("Adicione ao menos um arquivo.");
  const destino = new mupdf.PDFDocument();
  const campos = new Campos(destino);
  const marcadores: NoMarcador[] = [];
  try {
    for (const item of itens) {
      let fonte: mupdf.PDFDocument;
      try {
        fonte = abrirComoPdf(item.bytes, item.nome, item.senha, item.tipo ?? "").doc;
      } catch (e) {
        if ((e as Error).name === "SenhaNecessaria") {
          throw new Error(`“${item.nome}” é protegido por senha: informe a senha correta.`);
        }
        throw new Error(`“${item.nome}”: ${(e as Error).message}`);
      }
      try {
        const n = fonte.countPages();
        let indices: number[];
        try {
          indices = item.intervalo?.trim() ? lerIntervalos(item.intervalo, n).flat() : [...Array(n).keys()];
        } catch (e) {
          throw new Error(`“${item.nome}”: ${(e as Error).message}`);
        }
        const mapa = destino.newGraftMap();
        campos.novaFonte(fonte, mapa);
        const inicio = destino.countPages();
        const posicao = new Map<number, number>();
        for (const i of indices) {
          const em = destino.countPages();
          if (!posicao.has(i)) posicao.set(i, em);
          enxertarPagina(destino, mapa, fonte, i, -1);
          // Campos de formulario da pagina.
          const anots = fonte.loadPage(i).getObject().get("Annots");
          if (!anots.isArray()) continue;
          const pagina = destino.findPage(em);
          let lista = pagina.get("Annots");
          for (let k = 0; k < anots.length; k++) {
            const ref = anots.get(k);
            const a = ref.resolve();
            if (!(a.get("Subtype").isName() && a.get("Subtype").asName() === "Widget")) continue;
            if (!lista.isArray()) {
              lista = destino.newArray();
              pagina.put("Annots", lista);
            }
            lista.push(campos.widget(ref, mapa, pagina));
          }
        }
        let filhos: NoMarcador[] = [];
        try {
          filhos = remapear(fonte.loadOutline() as ItemOutline[] | null, posicao);
        } catch {
          filhos = [];
        }
        if (op.marcadores) {
          marcadores.push({ titulo: item.nome.replace(/\.[^.]+$/, ""), pagina: inicio, filhos });
        } else {
          marcadores.push(...filhos);
        }
      } finally {
        fonte.destroy();
      }
    }
    if (!destino.countPages()) throw new Error("Nenhuma página escolhida.");
    escreverOutline(destino, marcadores);
    return bytesDoBuffer(destino.saveToBuffer("garbage=compact,compress=yes"));
  } finally {
    destino.destroy();
  }
}
