/*
 * Editar o texto que ja' esta' no PDF.
 *
 * PDF nao tem "paragrafo editavel": tem instrucoes que desenham glifos em
 * posicoes fixas. Editar e', portanto, APAGAR DE VERDADE o trecho antigo
 * (redacao so' de texto -- nao e' um retangulo branco por cima) e escrever o
 * novo no mesmo ponto de partida, com tamanho e cor iguais e a fonte Base-14
 * mais parecida. A fonte original quase nunca serve: vem em subconjunto (so'
 * os glifos usados) e uma letra nova nao existiria nela.
 */

import * as mupdf from "mupdf";
import { contem, type Ponto, type Retangulo } from "./coordenadas.ts";
import type { Sessao } from "./documento.ts";
import { escreverTexto, nomeBase14, type Familia } from "./conteudo.ts";
import type { Cor } from "./anotacoes.ts";

export interface Trecho {
  pagina: number;
  rect: Retangulo;
  /** Linha de base do primeiro caractere (espaco pagina). */
  origem: Ponto;
  texto: string;
  fonte: string;
  tamanho: number;
  cor: Cor;
  negrito: boolean;
  italico: boolean;
  familia: Familia;
  /** Horizontal para o leitor (esquerda -> direita). */
  horizontal: boolean;
}

interface Car { c: string; origem: Ponto; fonte: mupdf.Font; tamanho: number; cor: number[] }

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

/** A LINHA de texto sob o ponto (espaco pagina). Linha, e nao trecho de
 *  estilo: editar "Ola' **mundo**" palavra por palavra seria inutil. A fonte
 *  e a cor vem do estilo mais frequente da linha. */
export function trechoEm(p: mupdf.PDFPage, pagina: number, ponto: Ponto): Trecho | null {
  const st = p.toStructuredText("preserve-whitespace");
  let achado: Trecho | null = null;
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
      onChar(c, origem, fonte, tamanho, _quad, cor) {
        cars.push({ c, origem: origem as Ponto, fonte, tamanho, cor: cor as number[] });
      },
      endLine() {
        if (achado || !rect || !contem(rect, ponto, 1)) return;
        const visiveis = cars.filter((k) => k.c.trim());
        if (!visiveis.length) return;
        // Estilo principal: o (fonte, tamanho) com mais caracteres.
        const contagem = new Map<string, { n: number; k: Car }>();
        for (const k of visiveis) {
          const chave = k.fonte.getName() + "|" + k.tamanho.toFixed(1);
          const e = contagem.get(chave);
          if (e) e.n++; else contagem.set(chave, { n: 1, k });
        }
        const principal = [...contagem.values()].sort((a, b) => b.n - a.n)[0].k;
        const f = principal.fonte;
        const nome = f.getName();
        achado = {
          pagina, rect, origem: cars[0].origem,
          texto: cars.map((k) => k.c).join("").replace(/\s+$/, ""),
          fonte: nome, tamanho: principal.tamanho, cor: corRgb(principal.cor),
          negrito: f.isBold() || /bold|black|heavy|semibold/i.test(nome),
          italico: f.isItalic() || /italic|oblique/i.test(nome),
          familia: familiaDe(f),
          horizontal: Math.abs(dir[1]) < 1e-3 && dir[0] > 0,
        };
      },
    });
  } finally {
    st.destroy();
  }
  return achado;
}

/** A caixa da linha encolhida 20% na vertical: as caixas de linhas vizinhas
 *  se sobrepoem (ascendente de uma sobre descendente da outra) e redigir a
 *  caixa inteira arrancava pedaco da linha de cima. */
export function areaDaLinha(t: Trecho): Retangulo {
  const folga = (t.rect[3] - t.rect[1]) * 0.2;
  return [t.rect[0], t.rect[1] + folga, t.rect[2], t.rect[3] - folga];
}

export function substituirTrecho(s: Sessao, t: Trecho, novo: string,
  opcoes: { tamanho?: number; cor?: Cor } = {}): void {
  if (!t.horizontal) throw new Error("Só é possível editar texto horizontal.");
  const tamanho = opcoes.tamanho ?? t.tamanho;
  const cor = opcoes.cor ?? t.cor;
  s.operacao("Editar texto", () => {
    const p = s.pagina(t.pagina);
    const a = p.createAnnotation("Redact");
    a.setRect(areaDaLinha(t));
    a.update();
    p.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    if (novo) {
      escreverTexto(s, s.pagina(t.pagina), t.origem, novo,
        { tamanho, cor, fonte: nomeBase14(t.familia, t.negrito, t.italico) });
    }
  });
}
