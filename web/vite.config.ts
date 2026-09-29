import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const pacote = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const c = join(pasta, nome);
    if (statSync(c).isDirectory()) saida.push(...arquivosDe(c));
    else saida.push(c);
  }
  return saida;
}

/**
 * Gera o service worker com a lista exata do que o build produziu (nomes com
 * hash) + o que esta' em public/. A versao do cache e' o hash dessa lista:
 * build novo = cache novo, e o antigo e' apagado na ativacao.
 */
function serviceWorker(): Plugin {
  return {
    name: "editpdfree-service-worker",
    apply: "build",
    generateBundle(_opcoes, bundle) {
      const publico = join(process.cwd(), "public");
      const doPublico = arquivosDe(publico)
        .map((c) => "/" + relative(publico, c).split("\\").join("/"))
        .filter((c) => !/^\/(robots\.txt|_headers|_redirects)$/.test(c));
      const doBuild = Object.keys(bundle).filter((n) => !n.endsWith(".map") && n !== "index.html")
        .map((n) => "/" + n);
      const lista = ["/", ...doBuild, ...doPublico].sort();
      const h = createHash("sha256");
      for (const n of lista) h.update(n);
      for (const c of arquivosDe(publico)) h.update(readFileSync(c));
      for (const n of Object.keys(bundle)) {
        const b = bundle[n];
        h.update(b.type === "chunk" ? b.code : typeof b.source === "string" ? b.source : Buffer.from(b.source));
      }
      const versao = h.digest("hex").slice(0, 12);
      const modelo = readFileSync(new URL("./src/sw-modelo.js", import.meta.url), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: modelo.replace("__VERSAO_CACHE__", versao).replace("__ARQUIVOS__", JSON.stringify(lista, null, 1)),
      });
    },
  };
}

// O `vite preview` usa os MESMOS cabecalhos de seguranca do netlify.toml (lidos
// de la'), para que um teste no navegador pegue violacao de CSP antes do deploy.
const netlify = readFileSync(new URL("./netlify.toml", import.meta.url), "utf8");
const csp = /Content-Security-Policy = "([^"]+)"/.exec(netlify)?.[1] ?? "";

export default defineConfig({
  server: {
    watch: { ignored: ["**/scratch/**", "**/dist/**"] },
  },
  preview: {
    headers: { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" },
  },
  define: {
    __VERSAO__: JSON.stringify(pacote.version),
  },
  // O mupdf acha o .wasm por `new URL(..., import.meta.url)`; pre-empacotar
  // no modo dev quebraria esse caminho.
  optimizeDeps: { exclude: ["mupdf"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
  },
  plugins: [serviceWorker()],
});
