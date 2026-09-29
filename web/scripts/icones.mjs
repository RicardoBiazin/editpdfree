// Gera os icones do EditPDFree (SVG + PNGs) sem dependencia nenhuma:
// quadrado vermelho arredondado, folha branca com canto dobrado, linhas de
// texto e um traco de caneta. Rasterizacao por amostragem (4x4 por pixel).
//
//   node scripts/icones.mjs      -> public/icons/*

import { mkdirSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const VERMELHO = [198, 40, 40];
const DOBRA = [239, 190, 190];
const LINHA = [206, 211, 218];
const TINTA = [198, 40, 40];
const BRANCO = [255, 255, 255];

// Geometria em coordenadas 0..1 (y para baixo).
const PAGINA = { x0: 0.27, y0: 0.18, x1: 0.73, y1: 0.82, dobra: 0.13 };
const LINHAS = [[0.34, 0.36, 0.56], [0.34, 0.45, 0.66], [0.34, 0.54, 0.62]]; // x0, y, x1
const TRACO = []; // polilinha da "assinatura"
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  TRACO.push([0.33 + t * 0.34, 0.69 - Math.sin(t * Math.PI * 2.2) * 0.035 - t * 0.02]);
}
const ESP_LINHA = 0.022, ESP_TRACO = 0.03;

function dentroRetArred(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function distSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Cor do ponto (x, y) em 0..1, ou null (transparente). */
function cor(x, y, mascaravel) {
  // No icone "maskable" o fundo ocupa tudo e o desenho encolhe para a zona segura.
  let u = x, v = y;
  if (mascaravel) {
    u = 0.5 + (x - 0.5) / 0.8;
    v = 0.5 + (y - 0.5) / 0.8;
  } else if (!dentroRetArred(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) {
    return null;
  }
  const P = PAGINA;
  if (u >= P.x0 && u <= P.x1 && v >= P.y0 && v <= P.y1) {
    // Canto dobrado (superior direito).
    const fx = u - (P.x1 - P.dobra), fy = v - P.y0;
    if (fx > 0 && fy < P.dobra) {
      if (fx > fy) return VERMELHO; // recorte do canto
      return DOBRA;
    }
    for (let i = 1; i < TRACO.length; i++) {
      if (distSegmento(u, v, ...TRACO[i - 1], ...TRACO[i]) < ESP_TRACO / 2) return TINTA;
    }
    for (const [x0, yl, x1] of LINHAS) {
      if (distSegmento(u, v, x0, yl, x1, yl) < ESP_LINHA / 2) return LINHA;
    }
    return BRANCO;
  }
  return VERMELHO;
}

function png(tamanho, mascaravel = false) {
  const N = 4;
  const linhas = [];
  for (let py = 0; py < tamanho; py++) {
    const linha = Buffer.alloc(1 + tamanho * 4);
    for (let px = 0; px < tamanho; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = cor((px + (sx + 0.5) / N) / tamanho, (py + (sy + 0.5) / N) / tamanho, mascaravel);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = 1 + px * 4;
      if (a) {
        linha[o] = Math.round(r / a); linha[o + 1] = Math.round(g / a); linha[o + 2] = Math.round(b / a);
      }
      linha[o + 3] = Math.round((a / (N * N)) * 255);
    }
    linhas.push(linha);
  }
  const bruto = zlib.deflateSync(Buffer.concat(linhas), { level: 9 });
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0); ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pedaco("IHDR", ihdr),
    pedaco("IDAT", bruto), pedaco("IEND", Buffer.alloc(0))]);
}

function svg() {
  const s = (v) => +(v * 512).toFixed(1);
  const P = PAGINA;
  const rgb = (c) => `rgb(${c.join(",")})`;
  const pagina = `M${s(P.x0)} ${s(P.y0)}H${s(P.x1 - P.dobra)}L${s(P.x1)} ${s(P.y0 + P.dobra)}V${s(P.y1)}H${s(P.x0)}Z`;
  const dobra = `M${s(P.x1 - P.dobra)} ${s(P.y0)}V${s(P.y0 + P.dobra)}H${s(P.x1)}Z`;
  const linhas = LINHAS.map(([x0, y, x1]) => `<path d="M${s(x0)} ${s(y)}H${s(x1)}"/>`).join("");
  const traco = "M" + TRACO.map(([x, y]) => `${s(x)} ${s(y)}`).join("L");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect x="${s(0.02)}" y="${s(0.02)}" width="${s(0.96)}" height="${s(0.96)}" rx="${s(0.2)}" fill="${rgb(VERMELHO)}"/>
<path d="${pagina}" fill="#fff"/><path d="${dobra}" fill="${rgb(DOBRA)}"/>
<g stroke="${rgb(LINHA)}" stroke-width="${s(ESP_LINHA)}" stroke-linecap="round">${linhas}</g>
<path d="${traco}" fill="none" stroke="${rgb(TINTA)}" stroke-width="${s(ESP_TRACO)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

const destino = new URL("../public/icons/", import.meta.url);
mkdirSync(destino, { recursive: true });
writeFileSync(new URL("icone.svg", destino), svg());
for (const [nome, t, m] of [["icone-32.png", 32], ["apple-touch-icon.png", 180, true], ["icone-192.png", 192],
  ["icone-512.png", 512], ["icone-mascaravel-512.png", 512, true]]) {
  writeFileSync(new URL(nome, destino), png(t, m));
}
// favicon.ico com o PNG de 32 px dentro (formato aceito desde o Windows Vista).
const p32 = png(32);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 32; ico[7] = 32; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(p32.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(new URL("../favicon.ico", destino), Buffer.concat([ico, p32]));
console.log("ícones gerados em public/icons/ e public/favicon.ico");
