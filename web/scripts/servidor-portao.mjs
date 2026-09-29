// Servidor local que imita o Netlify: serve dist/ com os cabecalhos do
// netlify.toml e com a Edge Function do portao na frente. So' para testar o
// portao no navegador sem publicar:
//
//   npm run build && node scripts/servidor-portao.mjs [porta]
//
// Usa um segredo de teste fixo (nunca use este valor de verdade).

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORTA = Number(process.argv[2] || 4181);
const RAIZ = new URL("../dist/", import.meta.url);
const netlify = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const CSP = /Content-Security-Policy = "([^"]+)"/.exec(netlify)[1];

globalThis.Netlify = { env: { get: (k) => (k === "PORTAO_SEGREDO" ? "segredo-local-so-para-teste-0123456789" : undefined) } };
const { default: portao } = await import("../netlify/edge-functions/portao.ts");

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

function estatico(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const arq = normalize(join(RAIZ.pathname.replace(/^\/([A-Z]:)/, "$1"), rel));
  if (!existsSync(arq) || statSync(arq).isDirectory()) return new Response("404", { status: 404 });
  return new Response(readFileSync(arq), {
    headers: { "Content-Type": TIPOS[extname(arq)] ?? "application/octet-stream", "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" },
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? `localhost:${PORTA}`}`);
  const corpo = req.method === "POST" ? await new Promise((r) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => r(Buffer.concat(partes)));
  }) : undefined;
  const pedido = new Request(url, { method: req.method, headers: req.headers, body: corpo });
  const resp = await portao(pedido, { next: async () => estatico(url.pathname), deploy: { context: "production" } });
  const cab = {};
  resp.headers.forEach((v, k) => { cab[k] = v; });
  res.writeHead(resp.status, cab);
  res.end(Buffer.from(await resp.arrayBuffer()));
}).listen(PORTA, () => console.log(`portão local em http://localhost:${PORTA}/`));
