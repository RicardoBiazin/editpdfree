/*
 * Digitalizar com a camera: recorte automatico das bordas do documento e
 * realce de contraste. Trabalha sobre pixels RGBA (o formato do ImageData do
 * canvas), sem mupdf, para rodar na interface e nos testes.
 *
 * Recorte: supoe o papel mais claro que o fundo (o caso comum: folha sobre a
 * mesa). O limiar claro/escuro sai do metodo de Otsu; as bordas sao as
 * linhas e colunas em que a maior parte dos pixels e' "papel". Nao corrige
 * perspectiva -- e' o recorte simples; a foto tirada de cima fica boa.
 */

export interface ImagemRGBA { largura: number; altura: number; dados: Uint8ClampedArray }
export type ModoRealce = "cor" | "cinza" | "pb";

function cinzaDe(d: Uint8ClampedArray, o: number): number {
  return (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000;
}

function histograma(img: ImagemRGBA, passo = 1): Uint32Array {
  const h = new Uint32Array(256);
  const { largura, altura, dados } = img;
  for (let y = 0; y < altura; y += passo) {
    for (let x = 0; x < largura; x += passo) h[Math.round(cinzaDe(dados, (y * largura + x) * 4))]++;
  }
  return h;
}

/** Limiar de Otsu (0-255) de um histograma. */
export function limiarOtsu(h: Uint32Array): number {
  let total = 0, soma = 0;
  for (let i = 0; i < 256; i++) { total += h[i]; soma += i * h[i]; }
  let somaB = 0, pesoB = 0, melhor = 0, limiar = 127;
  for (let t = 0; t < 256; t++) {
    pesoB += h[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    somaB += t * h[t];
    const mB = somaB / pesoB, mF = (soma - somaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (entre > melhor) { melhor = entre; limiar = t; }
  }
  return limiar;
}

/** Retangulo [x0, y0, x1, y1] do papel na foto, ou a imagem inteira se nao
 *  houver contraste claro entre papel e fundo. */
export function detectarDocumento(img: ImagemRGBA): [number, number, number, number] {
  const { largura: w, altura: h, dados } = img;
  const inteiro: [number, number, number, number] = [0, 0, w, h];
  const passo = Math.max(1, Math.floor(Math.max(w, h) / 400));
  const hist = histograma(img, passo);
  const t = limiarOtsu(hist);
  let claros = 0, total = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; if (i > t) claros += hist[i]; }
  // Quase tudo claro ou quase tudo escuro: nao ha' borda a achar.
  if (claros / total > 0.93 || claros / total < 0.08) return inteiro;
  const linhas = new Float32Array(h), colunas = new Float32Array(w);
  const nLin = Math.ceil(w / passo), nCol = Math.ceil(h / passo);
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      if (cinzaDe(dados, (y * w + x) * 4) > t) { linhas[y] += 1 / nLin; colunas[x] += 1 / nCol; }
    }
  }
  const limite = 0.35;
  const acha = (v: Float32Array, n: number, reverso: boolean) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i += passo) idx.push(i);
    if (reverso) idx.reverse();
    for (const i of idx) if (v[i] >= limite) return reverso ? Math.min(n, i + passo) : i;
    return reverso ? n : 0;
  };
  const x0 = acha(colunas, w, false), x1 = acha(colunas, w, true);
  const y0 = acha(linhas, h, false), y1 = acha(linhas, h, true);
  if (x1 - x0 < w * 0.2 || y1 - y0 < h * 0.2) return inteiro;
  return [x0, y0, x1, y1];
}

export function recortarImagem(img: ImagemRGBA, r: [number, number, number, number]): ImagemRGBA {
  const [x0, y0, x1, y1] = r.map(Math.round);
  const largura = Math.max(1, x1 - x0), altura = Math.max(1, y1 - y0);
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    const de = ((y0 + y) * img.largura + x0) * 4;
    dados.set(img.dados.subarray(de, de + largura * 4), y * largura * 4);
  }
  return { largura, altura, dados };
}

/** Realce: estica o contraste (2% mais escuros viram preto, 2% mais claros
 *  viram branco). "cinza" tira a cor; "pb" binariza pelo limiar de Otsu. */
export function realcar(img: ImagemRGBA, modo: ModoRealce): ImagemRGBA {
  const { largura, altura, dados } = img;
  const hist = histograma(img, 1);
  const n = largura * altura;
  let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
  if (hi - lo < 10) { lo = 0; hi = 255; }
  const esc = 255 / (hi - lo);
  const saida = new Uint8ClampedArray(dados.length);
  const limiar = modo === "pb" ? (limiarOtsu(hist) - lo) * esc : 0;
  for (let o = 0; o < dados.length; o += 4) {
    if (modo === "cor") {
      saida[o] = (dados[o] - lo) * esc;
      saida[o + 1] = (dados[o + 1] - lo) * esc;
      saida[o + 2] = (dados[o + 2] - lo) * esc;
    } else {
      let g = (cinzaDe(dados, o) - lo) * esc;
      if (modo === "pb") g = g > limiar ? 255 : 0;
      saida[o] = saida[o + 1] = saida[o + 2] = g;
    }
    saida[o + 3] = 255;
  }
  return { largura, altura, dados: saida };
}
