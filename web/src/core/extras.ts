/*
 * Marca d'agua e numeracao de paginas.
 *
 * As posicoes sao calculadas no espaco pagina (o que o leitor ve) e escritas
 * por `escreverTexto`, que leva a matriz para o espaco PDF: numa pagina girada
 * a marca continua diagonal "para cima e para a direita" e o numero continua
 * no rodape que o leitor ve.
 */

import type { Ponto } from "./coordenadas.ts";
import type { Sessao } from "./documento.ts";
import * as mupdf from "mupdf";
import { Acrescimo, escreverTexto, larguraTexto } from "./conteudo.ts";
import { matrizPaginaParaConteudo } from "./coordenadas.ts";
import { fmt, geometria } from "./documento.ts";
import type { Cor } from "./anotacoes.ts";
import { dataDeHoje, formatarNumero, POSICOES, type Posicao } from "./formatos.ts";

export { formatarNumero, POSICOES, type Posicao } from "./formatos.ts";

export interface OpcoesMarca {
  tamanho?: number;
  cor?: Cor;
  opacidade?: number;
  diagonal?: boolean;
}

export function marcaDagua(s: Sessao, texto: string, op: OpcoesMarca = {}): void {
  if (!texto.trim()) throw new Error("Informe o texto da marca d’água.");
  const tamanho = op.tamanho ?? 60;
  const angulo = op.diagonal === false ? 0 : 45;
  const fonte = "Helvetica-Bold";
  const largura = larguraTexto(texto, fonte, tamanho);
  s.operacao("Marca d’água", () => {
    for (let i = 0; i < s.paginas; i++) {
      const p = s.pagina(i);
      const b = p.getBounds();
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      const rad = angulo * Math.PI / 180;
      // Direcao do texto (y para baixo) e o "para cima" do glifo.
      const dir: Ponto = [Math.cos(rad), -Math.sin(rad)];
      const cima: Ponto = [-Math.sin(rad), -Math.cos(rad)];
      // Recua meia largura ao longo do texto e ~1/3 da altura para baixo, para
      // o CENTRO do texto cair no centro da pagina.
      const origem: Ponto = [cx - dir[0] * largura / 2 - cima[0] * tamanho * 0.35,
        cy - dir[1] * largura / 2 - cima[1] * tamanho * 0.35];
      escreverTexto(s, p, origem, texto, {
        tamanho, cor: op.cor ?? [0.6, 0.6, 0.6], fonte, opacidade: op.opacidade ?? 0.3,
      }, angulo);
    }
  });
}

export interface OpcoesNumeracao {
  formato?: string;
  posicao?: Posicao;
  tamanho?: number;
  cor?: Cor;
  inicio?: number;
  /** Data para {data} (padrao: hoje). */
  data?: string;
  margem?: number;
}

export function numerar(s: Sessao, op: OpcoesNumeracao = {}): void {
  const formato = op.formato ?? "{n} / {total}";
  const posicao = op.posicao ?? "inferior-centro";
  if (!(posicao in POSICOES)) throw new Error("Posição inválida.");
  const tamanho = op.tamanho ?? 10, margem = op.margem ?? 24, inicio = op.inicio ?? 1;
  const total = s.paginas + inicio - 1;
  const extra = { arquivo: s.nome, data: op.data ?? dataDeHoje() };
  formatarNumero(formato, 1, 1, extra);
  s.operacao("Numerar páginas", () => {
    for (let i = 0; i < s.paginas; i++) {
      const p = s.pagina(i);
      const texto = formatarNumero(formato, i + inicio, total, extra);
      const largura = larguraTexto(texto, "Helvetica", tamanho);
      const b = p.getBounds();
      const [vertical, horizontal] = posicao.split("-");
      const y = vertical === "inferior" ? b[3] - margem : b[1] + margem + tamanho;
      const x = horizontal === "centro" ? (b[0] + b[2] - largura) / 2
        : horizontal === "esquerda" ? b[0] + margem : b[2] - margem - largura;
      escreverTexto(s, p, [x, y], texto, { tamanho, cor: op.cor ?? [0, 0, 0], fonte: "Helvetica" });
    }
  });
}

export interface OpcoesMarcaImagem {
  opacidade?: number;
  /** Largura da imagem como fracao da largura da pagina (0,05 a 1). */
  escala?: number;
  modo?: "centro" | "mosaico";
  camada?: "sobre" | "sob";
}

/** Marca d'agua de imagem em todas as paginas: centrada ou em mosaico, por
 *  cima ou por baixo do conteudo, com opacidade. Sai de pe' para o leitor em
 *  pagina girada (a matriz e' montada no espaco pagina). */
export function marcaDaguaImagem(s: Sessao, bytes: Uint8Array, op: OpcoesMarcaImagem = {}): void {
  let img: mupdf.Image;
  try {
    img = new mupdf.Image(bytes);
  } catch {
    throw new Error("Não foi possível ler a imagem.");
  }
  const escala = Math.max(0.05, Math.min(1, op.escala ?? 0.5));
  const opacidade = Math.max(0.02, Math.min(1, op.opacidade ?? 0.3));
  const proporcao = img.getHeight() / img.getWidth();
  s.operacao("Marca d’água de imagem", () => {
    const ref = s.doc.addImage(img);
    for (let i = 0; i < s.paginas; i++) {
      const p = s.pagina(i);
      const g = geometria(p);
      const b = g.limites;
      const w = (b[2] - b[0]) * escala, h = w * proporcao;
      const posicoes: [number, number][] = [];
      if (op.modo === "mosaico") {
        const passoX = w * 1.5, passoY = h * 1.5;
        for (let y = b[1] + h * 0.25; y < b[3]; y += passoY) {
          for (let x = b[0] + w * 0.25; x < b[2]; x += passoX) posicoes.push([x, y]);
        }
      } else {
        posicoes.push([(b[0] + b[2] - w) / 2, (b[1] + b[3] - h) / 2]);
      }
      const ac = new Acrescimo(s.doc, p);
      const nome = ac.recurso("XObject", ref);
      const gs = ac.opacidade(opacidade);
      const ops = posicoes.map(([x, y]) => {
        const cm = matrizPaginaParaConteudo(g, [w, 0, 0, -h, x, y + h]);
        return `q ${cm.map(fmt).join(" ")} cm /${nome} Do Q`;
      });
      ac.gravar(`/${gs} gs\n${ops.join("\n")}`, op.camada === "sob");
    }
  });
}
