/*
 * O documento aberto: abrir, gravar, desfazer/refazer.
 *
 * Desfazer guarda INSTANTANEOS em bytes (sem criptografia, so' na memoria),
 * limitados em quantidade e em tamanho total. Operacao inversa de uma tarja
 * nao existe -- por isso instantaneo, e nao operacao inversa. Uma operacao que
 * levanta excecao volta ao estado anterior e nao entra na pilha.
 *
 * Criptografia ao gravar: no MuPDF.js 1.28 o padrao e' MANTER a criptografia
 * de um documento autenticado (o contrario do PyMuPDF do desktop, que gravava
 * sem ela). Conferido por experimento. Consequencias:
 *  - o instantaneo do desfazer grava com `encrypt=none`, senao o instantaneo
 *    reaberto exigiria senha;
 *  - "remover protecao" precisa pedir `encrypt=none` explicitamente;
 *  - `senhaOriginal` e' guardada para regravar com a mesma senha de abrir
 *    (o instantaneo reaberto ja' nao tem a criptografia original).
 */

import * as mupdf from "mupdf";
import type { Geometria, Matriz, Retangulo } from "./coordenadas.ts";

export const NIVEIS_DESFAZER = 30;
/** Teto de memoria para os instantaneos (bytes). */
export const MEMORIA_DESFAZER = 600 * 1024 * 1024;

export class SenhaNecessaria extends Error {
  readonly errada: boolean;
  constructor(errada: boolean) {
    super(errada ? "Senha incorreta." : "Este PDF é protegido por senha.");
    this.name = "SenhaNecessaria";
    this.errada = errada;
  }
}

export interface Protecao {
  senhaAbrir: string;
  senhaDono: string;
  /** Bits de permissao do PDF (Tabela 22 da ISO 32000). */
  permissoes: number;
}

/** Permissoes padrao ao proteger: tudo, menos alterar o documento. */
export const PERMISSOES_PADRAO = 4 /* imprimir */ | 16 /* copiar */
  | 512 /* acessibilidade */ | 2048 /* imprimir em alta qualidade */;

const EXTENSOES_IMAGEM = /\.(png|jpe?g|gif|bmp|tiff?|webp|jxr|pnm|pbm|pgm|ppm|pam)$/i;

export function ehImagem(nome: string, tipo = ""): boolean {
  return tipo.startsWith("image/") || EXTENSOES_IMAGEM.test(nome);
}

/** Copia os bytes para fora da memoria do WASM e solta o buffer. */
export function bytesDoBuffer(buf: mupdf.Buffer): Uint8Array {
  try {
    return buf.asUint8Array().slice();
  } finally {
    buf.destroy();
  }
}

/** Uma imagem vira um PDF de uma pagina, do tamanho da imagem (na resolucao
 *  dela; sem resolucao, 96 dpi). */
export function imagemParaPdf(bytes: Uint8Array): mupdf.PDFDocument {
  let img: mupdf.Image;
  try {
    img = new mupdf.Image(bytes);
  } catch {
    throw new Error("Formato de imagem não suportado (use PNG, JPEG, GIF, BMP, TIFF ou WebP).");
  }
  const xres = img.getXResolution() || 96, yres = img.getYResolution() || 96;
  const w = img.getWidth() * 72 / xres, h = img.getHeight() * 72 / yres;
  const doc = new mupdf.PDFDocument();
  const ref = doc.addImage(img);
  const recursos = doc.addObject({ XObject: { Im0: ref } });
  const conteudo = `q ${fmt(w)} 0 0 ${fmt(h)} 0 0 cm /Im0 Do Q`;
  doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, recursos, conteudo));
  return doc;
}

/** Abre bytes como PDF (ou imagem convertida). Levanta SenhaNecessaria. */
export function abrirComoPdf(bytes: Uint8Array, nome = "", senha?: string,
  tipo = ""): { doc: mupdf.PDFDocument; senhaUsada: string | null } {
  if (ehImagem(nome, tipo)) return { doc: imagemParaPdf(bytes), senhaUsada: null };
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch (e) {
    throw new Error("Não foi possível abrir o arquivo: não parece um PDF válido.");
  }
  let senhaUsada: string | null = null;
  if (doc.needsPassword()) {
    if (senha === undefined || senha === null) throw new SenhaNecessaria(false);
    if (!doc.authenticatePassword(senha)) throw new SenhaNecessaria(true);
    senhaUsada = senha;
  }
  const pdf = doc.asPDF();
  if (!pdf) throw new Error("O arquivo não é um PDF.");
  if (pdf.countPages() < 1) throw new Error("O PDF não tem páginas.");
  return { doc: pdf, senhaUsada };
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error("número inválido");
  const s = n.toFixed(4);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Senha vai numa string de opcoes "chave=valor,chave=valor" do MuPDF, que nao
 *  tem escape: uma virgula quebraria a opcao (conferido -- da' erro). */
export function validarSenha(senha: string): void {
  if (senha.includes(",")) throw new Error("A senha não pode conter vírgula.");
  if (/[\u0000-\u001f]/.test(senha)) throw new Error("A senha contém caracteres inválidos.");
}

export function geometria(p: mupdf.PDFPage): Geometria {
  const ctm = p.getTransform() as Matriz;
  const limites = p.getBounds() as Retangulo;
  return { limites, ctm, rotacao: rotacaoDaPagina(p) };
}

export function rotacaoDaPagina(p: mupdf.PDFPage): number {
  const r = p.getObject().getInheritable("Rotate");
  const n = r.isNumber() ? Math.round(r.asNumber()) : 0;
  return ((n % 360) + 360) % 360;
}

interface Instantaneo { bytes: Uint8Array; descricao: string }

export class Sessao {
  doc: mupdf.PDFDocument;
  nome: string;
  /** Senha com que o arquivo foi aberto (reaplicada ao salvar). */
  senhaOriginal: string | null;
  /** undefined = manter como veio; null = sem protecao; objeto = proteger. */
  protecao: Protecao | null | undefined = undefined;
  modificado = false;
  /** Aumenta a cada mudanca: a interface descarta renders antigos por ele. */
  versao = 0;
  private pilhaDesfazer: Instantaneo[] = [];
  private pilhaRefazer: Instantaneo[] = [];

  constructor(doc: mupdf.PDFDocument, nome: string, senhaOriginal: string | null = null) {
    this.doc = doc;
    this.nome = nome;
    this.senhaOriginal = senhaOriginal;
  }

  static abrir(bytes: Uint8Array, nome: string, senha?: string, tipo = ""): Sessao {
    const { doc, senhaUsada } = abrirComoPdf(bytes, nome, senha, tipo);
    const s = new Sessao(doc, ehImagem(nome, tipo) ? nome.replace(/\.[^.]+$/, "") + ".pdf" : nome,
      senhaUsada);
    if (ehImagem(nome, tipo)) s.modificado = true;
    return s;
  }

  get paginas(): number {
    return this.doc.countPages();
  }

  pagina(i: number): mupdf.PDFPage {
    if (!(i >= 0 && i < this.paginas)) throw new RangeError("Página fora do documento.");
    return this.doc.loadPage(i);
  }

  /** Bytes do estado atual, sem criptografia e sem compactar (rapido). */
  instantaneo(): Uint8Array {
    return bytesDoBuffer(this.doc.saveToBuffer("encrypt=none"));
  }

  private restaurar(bytes: Uint8Array): void {
    const antigo = this.doc;
    this.doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
    antigo.destroy();
  }

  private empilhar(pilha: Instantaneo[], item: Instantaneo): void {
    pilha.push(item);
    let total = pilha.reduce((t, i) => t + i.bytes.length, 0);
    while (pilha.length > NIVEIS_DESFAZER || (pilha.length > 1 && total > MEMORIA_DESFAZER)) {
      total -= pilha.shift()!.bytes.length;
    }
  }

  /** Executa `fn` como uma operacao desfazivel. Se `fn` falhar, o documento
   *  volta exatamente ao que era e a excecao sobe. Se `fn` devolver `false`,
   *  nada mudou e nada entra na pilha. */
  operacao<T>(descricao: string, fn: () => T): T {
    const antes = this.instantaneo();
    let r: T;
    try {
      r = fn();
    } catch (e) {
      this.restaurar(antes);
      throw e;
    }
    if (r === false) return r;
    this.empilhar(this.pilhaDesfazer, { bytes: antes, descricao });
    this.pilhaRefazer = [];
    this.modificado = true;
    this.versao++;
    return r;
  }

  /** Marca uma mudanca que nao altera o conteudo (ex.: senha agendada). */
  marcarModificado(): void {
    this.modificado = true;
    this.versao++;
  }

  get podeDesfazer(): string | null {
    return this.pilhaDesfazer.at(-1)?.descricao ?? null;
  }

  get podeRefazer(): string | null {
    return this.pilhaRefazer.at(-1)?.descricao ?? null;
  }

  desfazer(): string | null {
    const item = this.pilhaDesfazer.pop();
    if (!item) return null;
    this.empilhar(this.pilhaRefazer, { bytes: this.instantaneo(), descricao: item.descricao });
    this.restaurar(item.bytes);
    this.modificado = true;
    this.versao++;
    return item.descricao;
  }

  refazer(): string | null {
    const item = this.pilhaRefazer.pop();
    if (!item) return null;
    this.empilhar(this.pilhaDesfazer, { bytes: this.instantaneo(), descricao: item.descricao });
    this.restaurar(item.bytes);
    this.modificado = true;
    this.versao++;
    return item.descricao;
  }

  /** Opcoes de gravacao do MuPDF, com a criptografia certa. */
  opcoesGravar(): string {
    const opcoes = ["garbage=compact", "compress=yes"];
    let prot: Protecao | null = null;
    if (this.protecao === undefined) {
      if (this.senhaOriginal !== null) {
        prot = { senhaAbrir: this.senhaOriginal, senhaDono: this.senhaOriginal,
          permissoes: -1 };
      }
    } else {
      prot = this.protecao;
    }
    if (prot) {
      validarSenha(prot.senhaAbrir);
      validarSenha(prot.senhaDono);
      opcoes.push("encrypt=aes-256");
      if (prot.senhaAbrir) opcoes.push("user-password=" + prot.senhaAbrir);
      opcoes.push("owner-password=" + (prot.senhaDono || prot.senhaAbrir));
      opcoes.push("permissions=" + prot.permissoes);
    } else {
      opcoes.push("encrypt=none");
    }
    return opcoes.join(",");
  }

  /** Bytes do arquivo final, prontos para baixar. */
  salvar(): Uint8Array {
    const bytes = bytesDoBuffer(this.doc.saveToBuffer(this.opcoesGravar()));
    this.modificado = false;
    return bytes;
  }

  proteger(senhaAbrir: string, senhaDono = "", permissoes = PERMISSOES_PADRAO): void {
    if (!senhaAbrir && !senhaDono) throw new Error("Informe ao menos uma senha.");
    validarSenha(senhaAbrir);
    validarSenha(senhaDono);
    this.protecao = { senhaAbrir, senhaDono: senhaDono || senhaAbrir, permissoes };
    this.marcarModificado();
  }

  removerProtecao(): void {
    this.protecao = null;
    this.marcarModificado();
  }

  /** A protecao que o proximo salvar vai aplicar (para a interface). */
  get protegidoAoSalvar(): boolean {
    return this.protecao === undefined ? this.senhaOriginal !== null : this.protecao !== null;
  }

  fechar(): void {
    this.doc.destroy();
    this.pilhaDesfazer = [];
    this.pilhaRefazer = [];
  }
}
