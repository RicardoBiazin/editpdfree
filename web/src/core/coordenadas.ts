/*
 * Conversao entre os espacos de coordenadas -- num lugar so'.
 *
 * No MuPDF.js existem, na pratica, TRES espacos:
 *
 *  - tela:   pixel do canvas desenhado, ja' multiplicado pelo zoom, com a origem
 *            no canto superior esquerdo da pagina desenhada;
 *  - pagina: pontos PDF como o LEITOR ve a pagina (ja' girada, y para baixo).
 *            E' o espaco de `page.getBounds()`, do render (`toPixmap`), do texto
 *            estruturado, da busca e de TODA a API de anotacoes do MuPDF.js
 *            (setRect, setLine, setInkList, setQuadPoints...). Isso e' diferente
 *            do PyMuPDF, em que as anotacoes usam o espaco sem rotacao.
 *  - PDF:    o espaco do arquivo (sem rotacao, y para cima). So' aparece quando
 *            escrevemos no conteudo da pagina (texto, imagem, assinatura) ou
 *            mexemos direto nas chaves /Rect, /L, /InkList de uma anotacao.
 *            pagina = PDF x ctm, com ctm = `page.getTransform()`.
 *
 * Tudo que converte entre esses espacos passa por aqui. Nada depende do mupdf:
 * a interface usa o mesmo modulo que o worker e os testes.
 */

export type Matriz = [number, number, number, number, number, number];
export type Ponto = [number, number];
export type Retangulo = [number, number, number, number];
export type Quad = [number, number, number, number, number, number, number, number];

/** O que a interface precisa saber de uma pagina para converter coordenadas. */
export interface Geometria {
  /** `page.getBounds()`: retangulo da pagina girada, no espaco pagina. */
  limites: Retangulo;
  /** `page.getTransform()`: PDF -> pagina. */
  ctm: Matriz;
  /** Rotacao efetiva da pagina (0, 90, 180, 270). */
  rotacao: number;
}

export const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/** Aplica `m` ao ponto (convencao do MuPDF: ponto x matriz). */
export function aplicar(m: Matriz, p: Ponto): Ponto {
  return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]];
}

/** Aplica so' a parte linear (para deslocamentos, sem translacao). */
export function aplicarVetor(m: Matriz, v: Ponto): Ponto {
  return [v[0] * m[0] + v[1] * m[2], v[0] * m[1] + v[1] * m[3]];
}

/** `concatenar(a, b)`: primeiro a, depois b (igual ao fz_concat). */
export function concatenar(a: Matriz, b: Matriz): Matriz {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function inverter(m: Matriz): Matriz {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error("matriz não inversível");
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -m[4] * a - m[5] * c, -m[4] * b - m[5] * d];
}

export function normalizar(r: Retangulo): Retangulo {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]),
    Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** Retangulo que envolve os quatro cantos de `r` transformados por `m`. */
export function transformarRetangulo(r: Retangulo, m: Matriz): Retangulo {
  const cantos: Ponto[] = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]
    .map((p) => aplicar(m, p as Ponto));
  const xs = cantos.map((p) => p[0]), ys = cantos.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------- tela <-> pagina

/** Pixel da tela (zoom ja' aplicado) -> ponto no espaco pagina. */
export function telaParaPagina(g: Geometria, x: number, y: number, zoom: number): Ponto {
  return [x / zoom + g.limites[0], y / zoom + g.limites[1]];
}

export function paginaParaTela(g: Geometria, p: Ponto, zoom: number): Ponto {
  return [(p[0] - g.limites[0]) * zoom, (p[1] - g.limites[1]) * zoom];
}

/** Dois cantos quaisquer arrastados na tela -> retangulo normalizado (pagina). */
export function retanguloTelaParaPagina(g: Geometria, x0: number, y0: number,
  x1: number, y1: number, zoom: number): Retangulo {
  const a = telaParaPagina(g, x0, y0, zoom), b = telaParaPagina(g, x1, y1, zoom);
  return normalizar([a[0], a[1], b[0], b[1]]);
}

export function retanguloPaginaParaTela(g: Geometria, r: Retangulo, zoom: number): Retangulo {
  const a = paginaParaTela(g, [r[0], r[1]], zoom), b = paginaParaTela(g, [r[2], r[3]], zoom);
  return normalizar([a[0], a[1], b[0], b[1]]);
}

// ---------------------------------------------------------------- pagina <-> PDF

export function paginaParaPdf(g: Geometria, p: Ponto): Ponto {
  return aplicar(inverter(g.ctm), p);
}

export function pdfParaPagina(g: Geometria, p: Ponto): Ponto {
  return aplicar(g.ctm, p);
}

/** Deslocamento (dx, dy) no espaco pagina -> o mesmo deslocamento no espaco PDF.
 *  Numa pagina sem rotacao so' troca o sinal de dy; a 90 graus troca os eixos. */
export function deslocamentoPaginaParaPdf(g: Geometria, dx: number, dy: number): Ponto {
  return aplicarVetor(inverter(g.ctm), [dx, dy]);
}

/**
 * Matriz de desenho (para o operador `cm` ou `Tm`) que poe algo "de pe'" para o
 * leitor. `m` e' a matriz desejada no espaco pagina (y para baixo); o resultado
 * e' a mesma matriz no espaco PDF: primeiro m, depois pagina -> PDF.
 */
export function matrizPaginaParaConteudo(g: Geometria, m: Matriz): Matriz {
  return concatenar(m, inverter(g.ctm));
}

/** Quad (ul, ur, ll, lr) de um retangulo no espaco pagina. */
export function quadDoRetangulo(r: Retangulo): Quad {
  return [r[0], r[1], r[2], r[1], r[0], r[3], r[2], r[3]];
}

export function retanguloDoQuad(q: Quad): Retangulo {
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function intersecta(a: Retangulo, b: Retangulo): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

export function uniao(a: Retangulo, b: Retangulo): Retangulo {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function contem(r: Retangulo, p: Ponto, folga = 0): boolean {
  return p[0] >= r[0] - folga && p[0] <= r[2] + folga && p[1] >= r[1] - folga && p[1] <= r[3] + folga;
}
