// Service worker do EditPDFree (gerado no build a partir de src/sw-modelo.js).
// Guarda a aplicacao inteira (inclusive o motor .wasm) para funcionar sem
// internet depois da primeira visita. Nao guarda nem ve os seus PDFs: eles
// nunca passam pela rede.

const CACHE = "editpdfree-__VERSAO_CACHE__";
const ARQUIVOS = __ARQUIVOS__;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("editpdfree-") && n !== CACHE)
      .map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/__portao/")) return;
  if (req.mode === "navigate") {
    // Pagina: rede primeiro (pega versao nova), cache se estiver sem internet.
    ev.respondWith(fetch(req).catch(() => caches.match("/", { cacheName: CACHE })
      .then((r) => r || new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
    return;
  }
  // Arquivos da aplicacao (nomes com hash): cache primeiro.
  ev.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((r) => r || fetch(req)));
});
