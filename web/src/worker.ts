/*
 * Worker: todo o trabalho pesado do MuPDF (abrir, desenhar, editar, gravar)
 * roda aqui, fora da linha da interface. A interface conversa por mensagens
 * { id, tipo, args } e recebe { id, ok, r } ou { id, ok: false, erro }.
 *
 * O PDF nunca sai do navegador: nao ha' rede aqui.
 */

import * as mupdf from "mupdf";
import { geometria, Sessao, type Protecao } from "./core/documento.ts";
import type { Geometria } from "./core/coordenadas.ts";
import * as paginas from "./core/paginas.ts";
import * as anot from "./core/anotacoes.ts";
import * as conteudo from "./core/conteudo.ts";
import * as seg from "./core/seguranca.ts";
import * as form from "./core/formularios.ts";
import * as texto from "./core/texto.ts";
import * as extras from "./core/extras.ts";
import { renderizar } from "./core/render.ts";
import { criarZip } from "./core/zip.ts";
import * as otim from "./core/otimizar.ts";
import * as recorte from "./core/recorte.ts";
import * as conv from "./core/conversao.ts";
import * as campos from "./core/criarcampos.ts";
import * as ocr from "./core/ocr.ts";
import * as mais from "./core/mais.ts";
import { comparar, type Diferenca } from "./core/comparar.ts";
import { nomeBase } from "./core/intervalos.ts";

// Avisos do MuPDF (arquivo reparado etc.) vao para o console do worker.
mupdf.setLog({
  error: (m) => console.warn("[mupdf]", m),
  warning: () => undefined,
});

let s: Sessao | null = null;

export interface InfoPagina extends Geometria { largura: number; altura: number }

export interface Estado {
  aberto: boolean;
  nome: string;
  versao: number;
  paginas: InfoPagina[];
  podeDesfazer: string | null;
  podeRefazer: string | null;
  modificado: boolean;
  protegido: boolean;
  assinado: boolean;
  /** O MuPDF precisou reparar o arquivo ao abrir. */
  reparado: boolean;
}

function sessao(): Sessao {
  if (!s) throw new Error("Nenhum documento aberto.");
  return s;
}

// Cache pequeno de paginas carregadas, valido para uma versao do documento.
let cacheVersao = -1;
let cacheDoc: mupdf.PDFDocument | null = null;
const cache = new Map<number, mupdf.PDFPage>();

function pagina(i: number): mupdf.PDFPage {
  const ss = sessao();
  if (cacheVersao !== ss.versao || cacheDoc !== ss.doc) {
    for (const p of cache.values()) p.destroy();
    cache.clear();
    cacheVersao = ss.versao;
    cacheDoc = ss.doc;
  }
  let p = cache.get(i);
  if (!p) {
    p = ss.pagina(i);
    cache.set(i, p);
    if (cache.size > 16) {
      const [k, velha] = cache.entries().next().value!;
      cache.delete(k);
      velha.destroy();
    }
  }
  return p;
}

function assinado(doc: mupdf.PDFDocument): boolean {
  try {
    const af = doc.getTrailer().get("Root").get("AcroForm");
    if (!af.isDictionary()) return false;
    const f = af.get("SigFlags");
    return f.isNumber() && (f.asNumber() & 1) === 1;
  } catch {
    return false;
  }
}

function estado(): Estado {
  if (!s) {
    return { aberto: false, nome: "", versao: 0, paginas: [], podeDesfazer: null, podeRefazer: null,
      modificado: false, protegido: false, assinado: false, reparado: false };
  }
  const lista: InfoPagina[] = [];
  for (let i = 0; i < s.paginas; i++) {
    const g = geometria(pagina(i));
    lista.push({ ...g, largura: g.limites[2] - g.limites[0], altura: g.limites[3] - g.limites[1] });
  }
  return {
    aberto: true, nome: s.nome, versao: s.versao, paginas: lista,
    podeDesfazer: s.podeDesfazer, podeRefazer: s.podeRefazer, modificado: s.modificado,
    protegido: s.protegidoAoSalvar, assinado: assinado(s.doc), reparado: s.reparado,
  };
}

type Resposta = [unknown, Transferable[]?];

// deno-lint-ignore no-explicit-any
type Args = any;

const operacoes: Record<string, (a: Args) => unknown> = {
  girar: (a) => paginas.girar(sessao(), a.indices, a.graus),
  excluir: (a) => paginas.excluir(sessao(), a.indices),
  reordenar: (a) => paginas.reordenar(sessao(), a.ordem),
  duplicar: (a) => paginas.duplicar(sessao(), a.indice),
  inserirEmBranco: (a) => paginas.inserirEmBranco(sessao(), a.posicao),
  inserirArquivo: (a) => paginas.inserirArquivo(sessao(), new Uint8Array(a.bytes), a.nome, a.posicao, a.tipo),
  textoLivre: (a) => anot.textoLivre(sessao(), a.pagina, a.rect, a.texto, a.estilo),
  nota: (a) => anot.nota(sessao(), a.pagina, a.ponto, a.texto, a.estilo),
  marcar: (a) => anot.marcarTexto(sessao(), a.pagina, a.rect, a.tipo, a.estilo),
  caneta: (a) => anot.caneta(sessao(), a.pagina, a.tracos, a.estilo),
  forma: (a) => anot.forma(sessao(), a.pagina, a.tipo, a.inicio, a.fim, a.estilo),
  excluirAnotacao: (a) => anot.excluirAnotacao(sessao(), a.pagina, a.id),
  moverAnotacao: (a) => anot.moverAnotacao(sessao(), a.pagina, a.id, a.dx, a.dy),
  inserirImagem: (a) => conteudo.inserirImagem(sessao(), a.pagina, a.rect, new Uint8Array(a.bytes), a.descricao),
  inserirTexto: (a) => conteudo.inserirTexto(sessao(), a.pagina, a.origem, a.texto, a.opcoes),
  tarjar: (a) => seg.tarjar(sessao(), a.areas),
  tarjarTexto: (a) => seg.tarjarTexto(sessao(), a.termo),
  preencherCampo: (a) => form.preencherCampo(sessao(), a.pagina, a.id, a.valor),
  substituirTrecho: (a) => texto.substituirTrecho(sessao(), a.trecho, a.novo, a.opcoes),
  marcaDagua: (a) => extras.marcaDagua(sessao(), a.texto, a.opcoes),
  numerar: (a) => extras.numerar(sessao(), a.opcoes),
  proteger: (a) => sessao().proteger(a.senhaAbrir, a.senhaDono, a.permissoes),
  removerProtecao: () => sessao().removerProtecao(),
  comprimir: (a) => otim.comprimir(sessao(), a.opcoes),
  recortarRetangulo: (a) => recorte.recortarRetangulo(sessao(), a.indices, a.rect),
  recortarMargens: (a) => recorte.recortarMargens(sessao(), a.indices, a.margens),
  criarCampos: (a) => campos.criarCampos(sessao(), a.campos),
  marcaDaguaImagem: (a) => extras.marcaDaguaImagem(sessao(), new Uint8Array(a.bytes), a.opcoes),
  camadaOcr: (a) => ocr.aplicarCamadaOcrVarias(sessao(), a.paginas),
  substituirEmTudo: (a) => mais.substituirEmTudo(sessao(), a.procurado, a.novo),
  definirMetadados: (a) => mais.definirMetadados(sessao(), a.valores),
  carimbo: (a) => mais.carimbo(sessao(), a.pagina, a.centro, a.texto, a.cor),
  desfazer: () => sessao().desfazer(),
  refazer: () => sessao().refazer(),
};

function executar(tipo: string, a: Args): Resposta {
  if (tipo in operacoes) {
    const r = operacoes[tipo](a);
    return [{ r, estado: estado() }];
  }
  switch (tipo) {
    case "abrir": {
      const nova = Sessao.abrir(new Uint8Array(a.bytes), a.nome, a.senha ?? undefined, a.tipo ?? "");
      s?.fechar();
      s = nova;
      cacheVersao = -1;
      return [estado()];
    }
    case "fechar":
      s?.fechar();
      s = null;
      return [estado()];
    case "estado":
      return [estado()];
    case "render": {
      const ss = sessao();
      if (a.pagina >= ss.paginas) throw new Error("obsoleto");
      const img = renderizar(pagina(a.pagina), a.escala);
      return [{ ...img, versao: ss.versao }, [img.rgba.buffer]];
    }
    case "anotacoes":
      return [anot.listarAnotacoes(pagina(a.pagina))];
    case "campos":
      return [form.listarCampos(pagina(a.pagina), a.pagina)];
    case "trechoEm":
      return [texto.trechoEm(pagina(a.pagina), a.pagina, a.ponto)];
    case "buscar":
      return [seg.buscar(sessao().doc, a.termo, true)];
    case "salvar": {
      const b = sessao().salvar();
      return [{ bytes: b, estado: estado() }, [b.buffer as ArrayBuffer]];
    }
    case "extrair": {
      const b = paginas.extrair(sessao(), a.indices);
      return [b, [b.buffer as ArrayBuffer]];
    }
    case "dividir": {
      const partes = paginas.dividir(sessao(), a.grupos);
      if (a.zip) {
        const z = criarZip(partes);
        return [{ zip: z }, [z.buffer as ArrayBuffer]];
      }
      return [{ partes }, partes.map((p) => p.bytes.buffer as ArrayBuffer)];
    }
    case "extrairTexto":
      return [seg.extrairTexto(sessao().doc)];
    case "reparar": {
      const r = otim.reparar(new Uint8Array(a.bytes));
      return [r, [r.bytes.buffer as ArrayBuffer]];
    }
    case "exportarImagens": {
      const z = criarZip(conv.paginasComoImagens(sessao(), a.dpi, a.formato, a.indices));
      return [z, [z.buffer as ArrayBuffer]];
    }
    case "imagensEmbutidas": {
      const imgs = conv.imagensEmbutidas(sessao());
      if (!imgs.length) return [null];
      const z = criarZip(imgs);
      return [{ zip: z, quantas: imgs.length }, [z.buffer as ArrayBuffer]];
    }
    case "markdown":
      return [conv.paraMarkdown(sessao().doc)];
    case "docx": {
      const z = criarZip(conv.paraDocx(sessao().doc, nomeBase(sessao().nome)));
      return [z, [z.buffer as ArrayBuffer]];
    }
    case "detectarCampos": {
      const ss = sessao();
      const lista: campos.Sugestao[] = [];
      for (let i = 0; i < ss.paginas; i++) lista.push(...campos.detectarCampos(pagina(i), i));
      return [lista];
    }
    case "paginaParaOcr": {
      const p = pagina(a.pagina);
      const tem = ocr.temTexto(p);
      const pix = p.toPixmap(mupdf.Matrix.scale(a.escala, a.escala), mupdf.ColorSpace.DeviceRGB, false, false);
      const png = pix.asPNG().slice();
      pix.destroy();
      return [{ png, temTexto: tem, limites: p.getBounds() }, [png.buffer as ArrayBuffer]];
    }
    case "metadados":
      return [mais.metadados(sessao().doc)];
    case "marcadores":
      return [mais.marcadores(sessao().doc)];
    case "links":
      return [mais.linksDaPagina(sessao().doc, pagina(a.pagina))];
    case "juntarImagens": {
      const b = paginas.juntar(a.arquivos.map((x: { bytes: ArrayBuffer; nome: string }) =>
        ({ bytes: new Uint8Array(x.bytes), nome: x.nome, tipo: "image/jpeg" })));
      return [b, [b.buffer as ArrayBuffer]];
    }
    case "compararAbrir":
      return [compararAbrir(a)];
    case "renderComparacao": {
      if (!comparacao) throw new Error("obsoleto");
      const doc = a.lado === "a" ? comparacao.a : comparacao.b;
      const img = renderizar(doc.loadPage(a.pagina), a.escala);
      return [img, [img.rgba.buffer]];
    }
    case "compararFechar":
      comparacao?.a.destroy();
      comparacao?.b.destroy();
      comparacao = null;
      return [null];
    default:
      throw new Error("Pedido desconhecido: " + tipo);
  }
}

// ------------------------------------------------------------ comparacao

let comparacao: { a: mupdf.PDFDocument; b: mupdf.PDFDocument } | null = null;

function geometrias(doc: mupdf.PDFDocument): InfoPagina[] {
  const lista: InfoPagina[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const g = geometria(doc.loadPage(i));
    lista.push({ ...g, largura: g.limites[2] - g.limites[0], altura: g.limites[3] - g.limites[1] });
  }
  return lista;
}

/** A = o documento aberto (estado atual) ou um arquivo; B = outro arquivo. */
function compararAbrir(a: Args): { paginasA: InfoPagina[]; paginasB: InfoPagina[]; diferencas: Diferenca[]; nomeA: string } {
  comparacao?.a.destroy();
  comparacao?.b.destroy();
  comparacao = null;
  let docA: mupdf.PDFDocument, nomeA: string;
  if (a.bytesA) {
    docA = Sessao.abrir(new Uint8Array(a.bytesA), a.nomeA, a.senhaA ?? undefined).doc;
    nomeA = a.nomeA;
  } else {
    const ss = sessao();
    docA = mupdf.Document.openDocument(ss.instantaneo(), "application/pdf").asPDF()!;
    nomeA = ss.nome;
  }
  const docB = Sessao.abrir(new Uint8Array(a.bytesB), a.nomeB, a.senhaB ?? undefined).doc;
  comparacao = { a: docA, b: docB };
  return { paginasA: geometrias(docA), paginasB: geometrias(docB), diferencas: comparar(docA, docB), nomeA };
}

function mensagemDeErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // As nossas mensagens comecam com maiuscula e estao em portugues; as do
  // MuPDF comecam com minuscula ("cannot ...", "syntax error ...").
  if (/^[A-ZÀ-Ú“]/.test(m)) return m;
  return "Erro do motor de PDF: " + m;
}

self.onmessage = (ev: MessageEvent<{ id: number; tipo: string; args: Args }>) => {
  const { id, tipo, args } = ev.data;
  try {
    const [r, transferir] = executar(tipo, args ?? {});
    (self as unknown as Worker).postMessage({ id, ok: true, r }, transferir ?? []);
  } catch (e) {
    const err = e as Error & { errada?: boolean };
    (self as unknown as Worker).postMessage({
      id, ok: false, erro: mensagemDeErro(e), nome: err?.name ?? "Error", errada: err?.errada ?? false,
    });
  }
};

(self as unknown as Worker).postMessage({ id: 0, ok: true, r: "pronto" });

export type { Protecao };
