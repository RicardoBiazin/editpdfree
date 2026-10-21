/*
 * Editar o texto que ja' esta' no PDF.
 *
 * PDF nao tem "paragrafo editavel": tem instrucoes que desenham glifos em
 * posicoes fixas. Editar e', portanto, APAGAR DE VERDADE o trecho antigo
 * (redacao so' de texto -- nao e' um retangulo branco por cima) e escrever o
 * novo no mesmo ponto de partida, com tamanho e cor iguais.
 *
 * So' o que muda e' reescrito: prefixo e sufixo iguais ao original ficam
 * intactos. Se o texto novo tem outra largura, o resto da linha e' reescrito
 * deslocado, caractere por caractere, cada um na sua fonte original.
 *
 * Fonte: a ORIGINAL do PDF sempre que ela tem o glifo. A fonte embutida vem
 * quase sempre em subconjunto (so' as letras que o documento usa); ela e'
 * embutida de novo (Type0/Identity-H, o codigo e' o numero do glifo) e as
 * letras que ela nao tem saem na Base-14 mais parecida.
 */

import * as mupdf from "mupdf";
import { contem, matrizPaginaParaConteudo, type Ponto, type Retangulo } from "./coordenadas.ts";
import { fmt, geometria, type Sessao } from "./documento.ts";
import { Acrescimo, codificarWinAnsi, larguraTexto, nomeBase14 } from "./conteudo.ts";
import {
  comSelecao, diferenca, selecionarFaixa, textoSelecionado,
  type Caractere, type Cor, type EstiloTrecho, type Familia, type Trecho,
} from "./trecho.ts";

export type { Trecho } from "./trecho.ts";

interface Car { c: string; origem: Ponto; fonte: mupdf.Font; tamanho: number; cor: number[]; x0: number; x1: number }
interface Linha { rect: Retangulo; horizontal: boolean; cars: Car[] }

function corRgb(c: number[]): Cor {
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 4) {
    const [C, M, Y, K] = c;
    return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
  }
  return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
}

function familiaDe(f: mupdf.Font): Familia {
  const nome = f.getName().toLowerCase();
  if (f.isMono() || /courier|mono|consol/.test(nome)) return "courier";
  if (f.isSerif() || /times|serif|georgia|garamond|cambria|roman/.test(nome.replace("sans", ""))) {
    return /sans/.test(nome) ? "helv" : "times";
  }
  return "helv";
}

function estiloDe(k: Car): EstiloTrecho {
  const f = k.fonte, nome = f.getName();
  return {
    fonte: nome, tamanho: k.tamanho, cor: corRgb(k.cor),
    negrito: f.isBold() || /bold|black|heavy|semibold/i.test(nome),
    italico: f.isItalic() || /italic|oblique/i.test(nome),
    familia: familiaDe(f),
  };
}

/** A LINHA de texto sob o ponto (espaco pagina), com os objetos de fonte. */
function linhaEm(p: mupdf.PDFPage, ponto: Ponto): Linha | null {
  const st = p.toStructuredText("preserve-whitespace");
  let achada: Linha | null = null;
  let rect: Retangulo | null = null;
  let dir: Ponto = [1, 0];
  let cars: Car[] = [];
  try {
    st.walk({
      beginLine(bbox, _wmode, direcao) {
        rect = bbox as Retangulo;
        dir = direcao as Ponto;
        cars = [];
      },
      onChar(c, origem, fonte, tamanho, quad, cor) {
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        cars.push({ c, origem: origem as Ponto, fonte, tamanho, cor: cor as number[],
          x0: Math.min(...xs), x1: Math.max(...xs) });
      },
      endLine() {
        if (achada || !rect || !contem(rect, ponto, 1)) return;
        // O branco do fim da linha nao conta (e o texto mostrado nao o tem).
        let n = cars.length;
        while (n > 0 && !cars[n - 1].c.trim()) n--;
        if (!n) return;
        achada = { rect, horizontal: Math.abs(dir[1]) < 1e-3 && dir[0] > 0, cars: cars.slice(0, n) };
      },
    });
  } finally {
    st.destroy();
  }
  return achada;
}

/** A linha de texto sob o ponto (espaco pagina). Com `ate`, so' os
 *  caracteres entre os x de `ponto` e `ate` ficam selecionados. */
export function trechoEm(p: mupdf.PDFPage, pagina: number, ponto: Ponto, ate?: Ponto): Trecho | null {
  const l = linhaEm(p, ponto);
  if (!l) return null;
  const estilos: EstiloTrecho[] = [];
  const indice = new Map<string, number>();
  const caracteres: Caractere[] = l.cars.map((k) => {
    const chave = `${k.fonte.getName()}|${k.tamanho.toFixed(2)}|${k.cor.join(",")}`;
    let e = indice.get(chave);
    if (e === undefined) {
      e = estilos.push(estiloDe(k)) - 1;
      indice.set(chave, e);
    }
    return { c: k.c, x: k.origem[0], y: k.origem[1], x0: k.x0, x1: k.x1, e };
  });
  const t = comSelecao({
    ...estilos[0], pagina, rect: l.rect, origem: l.cars[0].origem,
    texto: l.cars.map((k) => k.c).join(""), horizontal: l.horizontal,
    caracteres, estilos, inicio: 0, fim: caracteres.length,
  }, 0, caracteres.length);
  return ate ? selecionarFaixa(t, ponto[0], ate[0]) : t;
}

/** A caixa da linha encolhida 20% na vertical: as caixas de linhas vizinhas
 *  se sobrepoem (ascendente de uma sobre descendente da outra) e redigir a
 *  caixa inteira arrancava pedaco da linha de cima. */
export function areaDaLinha(t: { rect: Retangulo }): Retangulo {
  const folga = (t.rect[3] - t.rect[1]) * 0.2;
  return [t.rect[0], t.rect[1] + folga, t.rect[2], t.rect[3] - folga];
}

export interface OpcoesEdicao {
  tamanho?: number;
  cor?: Cor;
  /** "original" (padrao) ou o nome de uma fonte Base-14. */
  fonte?: string;
}

export interface ResultadoEdicao {
  alterou: boolean;
  /** Letras que a fonte original nao tem (sairam na Base-14 parecida). */
  faltando: string;
  /** O fim da linha foi empurrado para fora da pagina. */
  passouDaPagina?: boolean;
}

const semPrefixo = (nome: string) => nome.replace(/^[A-Z]{6}\+/, "");

/** Fontes da pagina que o PDF so' NOMEIA (sem arquivo embutido): o leitor
 *  usa a dele. Reembutir a substituta do MuPDF so' engordaria o arquivo; o
 *  texto novo nelas vai na Base-14 parecida, como o resto da pagina. */
function fontesNaoEmbutidas(p: mupdf.PDFPage): Set<string> {
  const r = new Set<string>();
  const res = p.getObject().getInheritable("Resources");
  const fontes = res.isDictionary() ? res.get("Font") : mupdf.PDFObject.Null;
  if (!fontes.isDictionary()) return r;
  fontes.forEach((obj) => {
    const f = obj.resolve();
    if (!f.isDictionary()) return;
    const tipo = f.get("Subtype").isName() ? f.get("Subtype").asName() : "";
    if (tipo === "Type3" || !f.get("BaseFont").isName()) return;
    let desc = f.get("FontDescriptor");
    if (tipo === "Type0") {
      const desc0 = f.get("DescendantFonts");
      desc = desc0.isArray() && desc0.length ? desc0.get(0).get("FontDescriptor") : mupdf.PDFObject.Null;
    }
    const embutida = desc.isDictionary() && ["FontFile", "FontFile2", "FontFile3"].some((k) => !desc.get(k).isNull());
    if (!embutida) r.add(semPrefixo(f.get("BaseFont").asName()));
  });
  return r;
}

/** Glifo e avanco (pontos) de `ch`: na fonte original se ela o tem
 *  (`gid` nao nulo), senao na Base-14. */
function medir(ch: string, original: mupdf.Font | null, base14: string, tamanho: number):
  { gid: number | null; w: number } {
  const gid = original ? original.encodeCharacter(ch.codePointAt(0)!) : 0;
  if (gid > 0) return { gid, w: original!.advanceGlyph(gid) * tamanho };
  return { gid: null, w: larguraTexto(ch, base14, tamanho) };
}

/** Escreve glifos no conteudo: cada um na fonte original quando ela o tem. */
class Escritor {
  private partes: string[] = ["BT"];
  private estado = "";
  private embutidas = new Map<string, string | null>();
  faltando = new Set<string>();

  private ac: Acrescimo;
  private doc: mupdf.PDFDocument;
  private p: mupdf.PDFPage;

  constructor(ac: Acrescimo, doc: mupdf.PDFDocument, p: mupdf.PDFPage) {
    this.ac = ac;
    this.doc = doc;
    this.p = p;
  }

  private embutida(f: mupdf.Font): string | null {
    const nome = f.getName();
    if (!this.embutidas.has(nome)) {
      let r: string | null = null;
      try {
        r = this.ac.recurso("Font", this.doc.addFont(f));
      } catch {
        r = null; // fonte sem arquivo (Type3...): fica a Base-14
      }
      this.embutidas.set(nome, r);
    }
    return this.embutidas.get(nome)!;
  }

  /** Glifo de `ch`: recurso, codigo hex e avanco (pontos). */
  glifo(ch: string, original: mupdf.Font | null, base14: string, tamanho: number, registrar = true):
    { res: string; hex: string; w: number } {
    const m = medir(ch, original, base14, tamanho);
    const res = m.gid !== null ? this.embutida(original!) : null;
    if (res) return { res, hex: m.gid!.toString(16).padStart(4, "0"), w: m.w };
    if (original && registrar && ch.trim()) this.faltando.add(ch);
    return { res: this.ac.fonteBase14(base14),
      hex: codificarWinAnsi(ch).map((b) => b.toString(16).padStart(2, "0")).join(""),
      w: larguraTexto(ch, base14, tamanho) };
  }

  /** Um glifo com a origem em (x, y), espaco pagina. */
  escrever(g: { res: string; hex: string }, x: number, y: number, tamanho: number, cor: Cor): void {
    const est = `/${g.res} ${fmt(tamanho)} Tf ${cor.map((v) => fmt(Math.max(0, Math.min(1, v)))).join(" ")} rg`;
    if (est !== this.estado) {
      this.partes.push(est);
      this.estado = est;
    }
    const tm = matrizPaginaParaConteudo(geometria(this.p), [1, 0, 0, -1, x, y]);
    this.partes.push(`${tm.map(fmt).join(" ")} Tm <${g.hex}> Tj`);
  }

  conteudo(): string {
    return this.partes.length > 1 ? [...this.partes, "ET"].join("\n") : "";
  }
}

/** Avanco natural do caractere na sua fonte. */
function avanco(k: Car): number {
  const gid = k.fonte.encodeCharacter(k.c.codePointAt(0)!);
  return gid > 0 ? k.fonte.advanceGlyph(gid) * k.tamanho : k.x1 - k.x0;
}

/** Troca o texto SELECIONADO do trecho (a linha inteira, se nada foi
 *  selecionado) por `novo`. Sem mudar tamanho/cor/fonte, so' a parte que
 *  difere e' reescrita. */
export function substituirTrecho(s: Sessao, t: Trecho, novo: string,
  opcoes: OpcoesEdicao = {}): ResultadoEdicao {
  if (!t.horizontal) throw new Error("Só é possível editar texto horizontal.");
  const outraFonte = !!opcoes.fonte && opcoes.fonte !== "original";
  const mudaEstilo = opcoes.tamanho !== undefined || opcoes.cor !== undefined || outraFonte;
  let a = t.inicio, b = t.fim, meio = novo;
  if (!mudaEstilo) {
    const d = diferenca(textoSelecionado(t), novo);
    if (d.a === d.b && !d.meio) return { alterou: false, faltando: "" };
    a = t.inicio + d.a;
    b = t.inicio + d.b;
    meio = d.meio;
  }
  let faltando = "", passou = false;
  s.operacao("Editar texto", () => {
    const k0 = t.caracteres[0];
    const l = linhaEm(s.pagina(t.pagina), [(k0.x0 + k0.x1) / 2, k0.y - t.estilos[k0.e].tamanho * 0.3]);
    if (!l || l.cars.map((k) => k.c).join("") !== t.texto) {
      throw new Error("A linha mudou desde que foi clicada. Clique nela de novo.");
    }
    const cs = l.cars, n = cs.length;
    // Estilo do texto novo: o do primeiro caractere trocado (ou o anterior,
    // quando so' se insere).
    const base = cs[a < b || a === 0 ? Math.min(a, n - 1) : a - 1];
    const est = estiloDe(base);
    const tamanho = opcoes.tamanho ?? base.tamanho;
    const cor = opcoes.cor ?? est.cor;
    const soNome = fontesNaoEmbutidas(s.pagina(t.pagina));
    const fonteDe = (f: mupdf.Font) => soNome.has(semPrefixo(f.getName())) ? null : f;
    const original = outraFonte ? null : fonteDe(base.fonte);
    const base14 = outraFonte ? opcoes.fonte! : nomeBase14(est.familia, est.negrito, est.italico);

    const xIni = a < n ? cs[a].origem[0] : cs[n - 1].origem[0] + avanco(cs[n - 1]);
    const y = a < n ? cs[a].origem[1] : cs[n - 1].origem[1];
    const largura = [...meio].reduce((soma, ch) => soma + medir(ch, original, base14, tamanho).w, 0);
    const delta = b < n ? largura - (cs[b].origem[0] - xIni) : 0;
    // Com todos os glifos da linha disponiveis nas fontes originais, a linha
    // INTEIRA e' reescrita (o que nao muda sai identico, no mesmo lugar): o
    // texto continua uma linha so' para a busca, a copia e a proxima edicao.
    // Sem isso, so' o que muda (e o resto da linha, se a largura mudou).
    const linhaToda = cs.every((k) => {
      if (!k.c.trim()) return true;
      const f = fonteDe(k.fonte);
      return f ? f.encodeCharacter(k.c.codePointAt(0)!) > 0 : codificarWinAnsi(k.c)[0] !== 0x3f || k.c === "?";
    });
    const moverResto = b < n && Math.abs(delta) > 0.01;
    const de = linhaToda ? 0 : a;
    const ate = linhaToda || moverResto ? n : b;
    if (ate > de) {
      // Corte entre caracteres: no meio do vao entre um e outro, para nao
      // pegar o vizinho que fica.
      const corte = (i: number) => i <= 0 ? l.rect[0] - 1 : i >= n ? l.rect[2] + 1
        : (Math.max(cs[i - 1].x1, cs[i - 1].origem[0]) + cs[i].origem[0]) / 2;
      const r = areaDaLinha(l);
      const pg = s.pagina(t.pagina);
      const red = pg.createAnnotation("Redact");
      red.setRect([corte(de), r[1], corte(ate), r[3]]);
      red.update();
      pg.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
        mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    }

    const pg = s.pagina(t.pagina);
    const ac = new Acrescimo(s.doc, pg);
    const esc = new Escritor(ac, s.doc, pg);
    const copiar = (k: Car, dx: number) => {
      const e = estiloDe(k);
      const g = esc.glifo(k.c, fonteDe(k.fonte), nomeBase14(e.familia, e.negrito, e.italico), k.tamanho, false);
      esc.escrever(g, k.origem[0] + dx, k.origem[1], k.tamanho, e.cor);
    };
    for (const k of cs.slice(de, a)) copiar(k, 0);
    let x = xIni;
    for (const ch of meio) {
      const g = esc.glifo(ch, original, base14, tamanho);
      esc.escrever(g, x, y, tamanho, cor);
      x += g.w;
    }
    if (ate > b) for (const k of cs.slice(b, ate)) copiar(k, delta);
    const fimLinha = b < n ? cs[n - 1].x1 + delta : x;
    passou = fimLinha > pg.getBounds()[2];
    const conteudo = esc.conteudo();
    if (conteudo) ac.gravar(conteudo);
    faltando = [...esc.faltando].join("");
  });
  return { alterou: true, faltando, passouDaPagina: passou };
}
