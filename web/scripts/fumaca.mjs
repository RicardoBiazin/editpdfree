// Teste de fumaca no navegador de verdade (Chrome/Edge sem janela, via
// DevTools Protocol, sem dependencias). Opcional: nao faz parte do `npm test`
// porque precisa de um navegador instalado.
//
//   npm run build && node scripts/fumaca.mjs [--portao | --url=https://site]
//
// Com --portao, o app e' servido atras da Edge Function do portao anti-robo
// (scripts/servidor-portao.mjs): o roteiro passa primeiro pelo desafio.
//
// Sobe o `vite preview` (com a CSP do netlify.toml), abre o app, confere que
// nao ha' erro no console, abre um PDF gerado na hora, desenha um retangulo,
// desfaz, gira pagina, busca texto, salva, e recarrega SEM rede para conferir
// o modo offline (service worker). Grava capturas de tela em scratch/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as mupdf from "mupdf";
import { criarFormulario, criarPdf, criarPdfComImagemGrande, escanear, ficha, pdfEstruturado, pdfTruncado, pngTeste } from "../test/fixtures.ts";

// --url=https://... roda contra um site ja' publicado (com o portao), sem
// subir servidor local: e' a conferencia depois do deploy.
const URL_REMOTA = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
const COM_PORTAO = process.argv.includes("--portao") || Boolean(URL_REMOTA);
const DEV = process.argv.includes("--dev"); // servidor de desenvolvimento (sem service worker)
const PORTA = COM_PORTAO ? 4181 : DEV ? 4183 : 4180;
const URL_APP = URL_REMOTA ? URL_REMOTA.replace(/\/?$/, "/") : `http://127.0.0.1:${PORTA}/`;
const SAIDA = new URL("../scratch/", import.meta.url);
mkdirSync(SAIDA, { recursive: true });

const candidatos = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = candidatos.find((c) => existsSync(c));
if (!chrome) {
  console.log("Nenhum Chrome/Edge encontrado; defina CHROME=caminho.");
  process.exit(2);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FALHOU"} ${msg}`);
  if (!cond) falhas.push(msg);
};

// ------------------------------------------------------------ servidores
const vite = URL_REMOTA
  ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: ["ignore", "pipe", "pipe"] })
  : COM_PORTAO
  ? spawn(process.execPath, ["scripts/servidor-portao.mjs", String(PORTA)], { stdio: ["ignore", "pipe", "pipe"] })
  : spawn(process.execPath, ["node_modules/vite/bin/vite.js", DEV ? "dev" : "preview", "--host", "127.0.0.1",
    "--port", String(PORTA), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
vite.stdout.on("data", (d) => { if (process.env.FUMACA_LOG) process.stdout.write("[servidor] " + d); });
vite.stderr.on("data", (d) => process.stdout.write("[servidor] " + d));
vite.on("exit", (c) => { if (c) console.log("[servidor] saiu com código", c); });
for (let i = 0; i < 50; i++) {
  try { await fetch(URL_APP); break; } catch { /* ainda subindo */ }
  await espera(200);
}

const PASTA_DOWNLOADS = new URL("downloads/", SAIDA).pathname.replace(/^\/([A-Z]:)/, "$1");
const baixado = async (nome, ms = 10000) => {
  const c = PASTA_DOWNLOADS + nome;
  for (let fim = Date.now() + ms; Date.now() < fim; await espera(200)) {
    if (existsSync(c) && !existsSync(c + ".crdownload")) { await espera(200); return readFileSync(c); }
  }
  return null;
};
// Perfil do Chrome fora do projeto (o `vite dev` vigia a pasta do projeto).
const perfil = join(tmpdir(), "editpdfree-fumaca-perfil");
// Arquivos de teste gerados na hora (para os seletores de arquivo do app).
const PASTA_FIXTURES = join(tmpdir(), "editpdfree-fumaca-arquivos") + "/";
rmSync(PASTA_FIXTURES, { recursive: true, force: true });
mkdirSync(PASTA_FIXTURES, { recursive: true });
writeFileSync(PASTA_FIXTURES + "estruturado.pdf", pdfEstruturado());
writeFileSync(PASTA_FIXTURES + "ficha.pdf", ficha());
writeFileSync(PASTA_FIXTURES + "escaneado.pdf", escanear(criarPdf([{ linhas: ["Contrato de prestação de serviços", "Valor total 1234 reais"] }])));
const pdfEstruturadoB = () => pdfEstruturado("Linha nova só na versão B.");
// Perfil limpo a cada rodada: sem cookie do portao nem cache de service worker.
rmSync(perfil, { recursive: true, force: true });
const nav = spawn(chrome, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${perfil}`,
  "--no-first-run", "--no-default-browser-check", "--disable-component-update",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
let alvo;
for (let i = 0; i < 50 && !alvo; i++) {
  try {
    const lista = await (await fetch("http://127.0.0.1:9333/json")).json();
    alvo = lista.find((t) => t.type === "page");
  } catch { /* ainda abrindo */ }
  await espera(200);
}
if (!alvo) throw new Error("não conectou ao navegador");

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pend = new Map();
let arquivoParaEscolher = null;
const externas = [];
const erros = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { ok: res, no } = pend.get(m.id);
    pend.delete(m.id);
    if (m.error) no(new Error(m.error.message)); else res(m.result);
  } else if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
    erros.push("console: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  } else if (m.method === "Network.requestWillBeSent") {
    const u = m.params.request.url;
    if (!/^(data:|blob:|about:|chrome|devtools)/.test(u) && !u.startsWith(new URL(URL_APP).origin)) externas.push(u);
  } else if (m.method === "Page.fileChooserOpened") {
    // Seletor de arquivo do app: responde com o arquivo preparado pelo roteiro.
    const alvo = arquivoParaEscolher;
    arquivoParaEscolher = null;
    if (alvo) void cdp("DOM.setFileInputFiles", { files: [alvo], backendNodeId: m.params.backendNodeId }).catch(() => undefined);
  } else if (m.method === "Runtime.exceptionThrown") {
    erros.push("exceção: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    erros.push("log: " + m.params.entry.text + " " + (m.params.entry.url ?? ""));
  }
});
const cdp = (method, params = {}, ms = 15000) => new Promise((res, no) => {
  const id = ++seq;
  const t = setTimeout(() => { pend.delete(id); no(new Error(`${method}: sem resposta em ${ms} ms`)); }, ms);
  pend.set(id, { ok: (v) => { clearTimeout(t); res(v); }, no: (e) => { clearTimeout(t); no(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const avaliar = async (expr) => {
  // userGesture: o app abre seletores de arquivo com input.click(), que o
  // Chrome so' permite com "ativacao do usuario".
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, 5000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const aguardar = async (expr, ms = 15000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await avaliar(expr).catch(() => false)) return true;
    await espera(150);
  }
  return false;
};
const captura = async (nome) => {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL(nome, SAIDA), Buffer.from(data, "base64"));
};
/** Rola o visor para o ponto (x, y em pontos PDF da pagina `i`) ficar no meio
 *  da tela e devolve as coordenadas de tela dele. */
/** Rola o visor para os pontos (em pontos PDF da pagina `i`) ficarem no meio
 *  da tela e devolve as coordenadas de tela de cada um (uma rolagem so'). */
const pontosPagina = async (i, pts) => avaliar(`(() => {
  const pts = ${JSON.stringify(pts)};
  const p = document.querySelectorAll('.pagina')[${i}];
  let r = p.getBoundingClientRect();
  const s = r.width / Number(p.dataset.larguraPt);
  const meio = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  document.getElementById("visor").scrollBy(0, r.top + meio * s - window.innerHeight / 2);
  r = p.getBoundingClientRect();
  return pts.map(([x, y]) => [r.left + x * s, r.top + y * s]);
})()`);
const pontoPagina = async (i, x, y) => (await pontosPagina(i, [[x, y]]))[0];
const clicar = async (x, y) => {
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const arrastar = async (x0, y0, x1, y1) => {
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1 });
  for (let k = 1; k <= 8; k++) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * k / 8, y: y0 + (y1 - y0) * k / 8, button: "left", buttons: 1 });
  }
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1 });
};
const tecla = async (key, code, modificadores = 0, vk = 0) => {
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers: modificadores, windowsVirtualKeyCode: vk });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers: modificadores, windowsVirtualKeyCode: vk });
};

try {
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Page.setInterceptFileChooserDialog", { enabled: true });
  await cdp("DOM.enable");
  await cdp("Browser.grantPermissions", { permissions: [] }).catch(() => undefined);
  rmSync(PASTA_DOWNLOADS, { recursive: true, force: true });
  mkdirSync(PASTA_DOWNLOADS, { recursive: true });
  // Na sessao da pagina so' o Page.setDownloadBehavior (antigo) tem efeito.
  const destinoWin = PASTA_DOWNLOADS.replace(/\//g, "\\");
  await cdp("Page.setDownloadBehavior", { behavior: "allow", downloadPath: destinoWin })
    .catch(() => cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destinoWin }));
  await cdp("Page.navigate", { url: URL_APP });
  if (COM_PORTAO) {
    ok(await aguardar(`document.title.startsWith("Verificando")`, 10000), "sem cookie: página do desafio anti-robô");
    // (captura de tela aqui pode travar: a pagina esta' ocupada com a conta)
    const t0 = Date.now();
    ok(await aguardar(`!!document.getElementById("btAbrirGrande")`, 60000), "desafio resolvido: o app abriu");
    console.log(`     (desafio + recarga: ${Date.now() - t0} ms)`);
    const semCookie = await fetch(URL_APP + "assets/", { headers: { "sec-fetch-mode": "cors" } });
    ok(semCookie.status === 403, "arquivo pedido sem cookie leva 403");
  }
  const motorOk = await aguardar(`document.getElementById("btAbrirGrande")?.textContent === "Abrir PDF"`, 30000);
  ok(motorOk, "motor de PDF (wasm no worker) carregou");
  if (!motorOk) {
    console.log("     botão:", await avaliar(`document.getElementById("btAbrirGrande")?.textContent`).catch((e) => e.message));
    console.log("     avisos:", await avaliar(`document.querySelector(".avisos")?.innerText ?? "(nenhum)"`).catch((e) => e.message));
    console.log("     página:", await avaliar(`location.href + " :: " + document.body.innerText.slice(0, 300)`).catch((e) => e.message));
  }
  await captura("fumaca-1-inicio.png");

  // PDF de teste: 3 paginas, a segunda girada.
  const doc = new mupdf.PDFDocument();
  const f = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  for (const [i, rot] of [[1, 0], [2, 90], [3, 0]]) {
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], rot, { Font: { F1: f } },
      `BT /F1 24 Tf 72 760 Td (Pagina ${i} do teste de fumaca) Tj ET BT /F1 14 Tf 72 700 Td (Contrato numero 12345) Tj ET`));
  }
  const b64 = Buffer.from(doc.saveToBuffer("").asUint8Array()).toString("base64");
  await avaliar(`(() => {
    const bin = atob("${b64}"); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], "fumaça.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const abriu = await aguardar(`document.querySelectorAll(".pagina").length === 3`);
  ok(abriu, "PDF aberto: 3 páginas no visor");
  if (!abriu) {
    console.log("     páginas:", await avaliar(`document.querySelectorAll(".pagina").length`).catch((e) => e.message));
    console.log("     avisos:", await avaliar(`document.querySelector(".avisos")?.innerText ?? "(nenhum)"`).catch((e) => e.message));
    console.log("     corpo:", await avaliar(`document.body.innerText.slice(0, 400)`).catch((e) => e.message));
    console.log("     erros até aqui:", JSON.stringify(erros));
  }
  ok(await aguardar(`[...document.querySelectorAll(".pagina canvas")].some(c => c.width > 0)`), "página renderizada no canvas");
  ok(await aguardar(`document.querySelectorAll(".mini canvas").length === 3 && [...document.querySelectorAll(".mini canvas")].every(c => c.width > 0)`),
    "miniaturas renderizadas");
  ok(await avaliar(`document.title.includes("fumaça.pdf")`), "título mostra o nome do arquivo");
  await captura("fumaca-2-aberto.png");

  // Retangulo na pagina 1.
  await avaliar(`document.querySelector('[data-ferramenta="retangulo"]').click(), true`);
  const r = await avaliar(`(() => { const b = document.querySelector('.pagina').getBoundingClientRect(); return [b.left, b.top, b.width]; })()`);
  await arrastar(r[0] + 100, r[1] + 250, r[0] + 300, r[1] + 350);
  ok(await aguardar(`!document.getElementById("btDesfazer").disabled`), "retângulo criado (desfazer habilitado)");
  ok(await aguardar(`document.title.startsWith("•")`), "título marca documento modificado");
  await espera(400);
  await captura("fumaca-3-retangulo.png");
  // Selecionar e ver a caixa de selecao.
  await avaliar(`document.querySelector('[data-ferramenta="selecionar"]').click(), true`);
  await espera(200);
  await clicar(r[0] + 101, r[1] + 300);
  ok(await aguardar(`!!document.querySelector(".selecao-anot")`), "anotação selecionável com clique");
  // Mover arrastando.
  await arrastar(r[0] + 101, r[1] + 300, r[0] + 161, r[1] + 340);
  ok(await aguardar(`document.getElementById("btDesfazer").title.includes("Mover anotação")`), "anotação movida arrastando");
  // Desfazer com Ctrl+Z (foco no documento).
  await avaliar(`document.getElementById("visor").focus(), true`);
  await tecla("z", "KeyZ", 2, 90);
  ok(await aguardar(`document.getElementById("btDesfazer").title.includes("Retângulo")`), "Ctrl+Z desfez o movimento");
  // Delete exclui a selecionada.
  await clicar(r[0] + 101, r[1] + 300);
  await aguardar(`!!document.querySelector(".selecao-anot")`);
  await tecla("Delete", "Delete", 0, 46);
  ok(await aguardar(`document.getElementById("btDesfazer").title.includes("Excluir anotação")`), "Delete excluiu a anotação");

  // Girar pagina pelo menu.
  await avaliar(`document.querySelector('[data-acao="girarD"]').click(), true`);
  ok(await aguardar(`(() => { const p = document.querySelector('.pagina'); return p.offsetWidth > p.offsetHeight; })()`),
    "girar à direita deixou a página 1 deitada");

  // Busca.
  await tecla("f", "KeyF", 2, 70);
  ok(await aguardar(`!document.getElementById("busca").hidden`), "Ctrl+F abre a busca");
  await avaliar(`(() => { const i = document.getElementById("inBusca"); i.value = "contrato"; i.dispatchEvent(new Event("input")); return true; })()`);
  ok(await aguardar(`document.getElementById("contagemBusca").textContent === "1 de 3"`), "busca achou 3 resultados (sem diferenciar maiúsculas)");
  ok(await aguardar(`document.querySelectorAll(".realce").length >= 1`), "resultados realçados na página");
  await captura("fumaca-4-busca.png");

  // Tarja por arrasto na pagina 3 (texto some da busca).
  await avaliar(`document.getElementById("btBuscaFechar").click(), true`);
  await avaliar(`document.querySelectorAll('.pagina')[2].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="tarjar"]').click(), true`);
  const r3 = await avaliar(`(() => { const b = document.querySelectorAll('.pagina')[2].getBoundingClientRect(); return [b.left, b.top, b.width / 595]; })()`);
  // "Contrato numero 12345" em y_pdf=700 -> ~142 pt do topo.
  await arrastar(r3[0] + 60 * r3[2], r3[1] + 125 * r3[2], r3[0] + 330 * r3[2], r3[1] + 150 * r3[2]);
  await espera(600);
  await tecla("f", "KeyF", 2, 70);
  await avaliar(`(() => { const i = document.getElementById("inBusca"); i.value = "contrato"; i.dispatchEvent(new Event("input")); return true; })()`);
  ok(await aguardar(`document.getElementById("contagemBusca").textContent === "1 de 2"`), "tarja removeu o texto (busca agora acha 2)");
  await avaliar(`document.getElementById("btBuscaFechar").click(), true`);
  await captura("fumaca-5-tarja.png");


  // ---- mais ferramentas, na pagina 3 (ja' visivel)
  const pg3 = async () => avaliar(`(() => { const b = document.querySelectorAll('.pagina')[2].getBoundingClientRect(); return [b.left, b.top, b.width / 595]; })()`);
  const noDialogo = (js) => avaliar(`(() => { const d = document.querySelector("dialog[open]"); if (!d) return false; ${js}; return true; })()`);
  const confirmarDialogo = () => avaliar(`(() => { const b = document.querySelector("dialog[open] button.primario"); if (!b) return false; b.click(); return true; })()`);
  const desfazerDiz = (t) => aguardar(`document.getElementById("btDesfazer").title.includes(${JSON.stringify(t)})`);

  await avaliar(`document.querySelectorAll('.pagina')[2].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="caixaTexto"]').click(), true`);
  let q = await pg3();
  await clicar(q[0] + 300 * q[2], q[1] + 300 * q[2]);
  ok(await aguardar(`!!document.querySelector("dialog[open] textarea")`), "caixa de texto: diálogo abriu");
  await noDialogo(`d.querySelector("textarea").value = "Anotação com acentuação: ção"`);
  await confirmarDialogo();
  ok(await desfazerDiz("Inserir caixa de texto"), "caixa de texto inserida");

  await avaliar(`document.querySelector('[data-ferramenta="editarTexto"]').click(), true`);
  q = await pg3();
  // "Pagina 3 do teste de fumaca": linha de base em y_pdf 760 -> 82 pt do topo.
  await clicar(q[0] + 120 * q[2], q[1] + 75 * q[2]);
  ok(await aguardar(`!!document.querySelector("dialog[open] input[type=text]")`), "editar texto: diálogo com a linha");
  ok(await avaliar(`document.querySelector("dialog[open] input[type=text]").value === "Pagina 3 do teste de fumaca"`),
    "editar texto: diálogo traz o texto da linha");
  await noDialogo(`d.querySelector("input[type=text]").value = "Página 3 editada no navegador"`);
  await confirmarDialogo();
  ok(await desfazerDiz("Editar texto"), "texto editado");
  await tecla("f", "KeyF", 2, 70);
  await avaliar(`(() => { const i = document.getElementById("inBusca"); i.value = "editada no navegador"; i.dispatchEvent(new Event("input")); return true; })()`);
  ok(await aguardar(`document.getElementById("contagemBusca").textContent === "1 de 1"`), "texto editado aparece na busca");
  await avaliar(`document.getElementById("btBuscaFechar").click(), true`);

  await avaliar(`document.querySelectorAll('.pagina')[2].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="assinatura"]').click(), true`);
  ok(await aguardar(`!!document.querySelector("dialog[open] canvas.bloco-assinatura")`), "assinatura: diálogo de desenho abriu");
  const bc = await avaliar(`(() => { const b = document.querySelector("dialog[open] canvas").getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`);
  await arrastar(bc[0] + bc[2] * 0.2, bc[1] + bc[3] * 0.6, bc[0] + bc[2] * 0.7, bc[1] + bc[3] * 0.3);
  await confirmarDialogo();
  ok(await aguardar(`!document.querySelector("dialog[open]")`), "assinatura: diálogo fechou");
  await clicar(...(await pontoPagina(2, 150, 380)));
  ok(await desfazerDiz("Assinatura"), "assinatura posicionada na página");
  ok(await avaliar(`(() => { try { return !!localStorage.getItem("editpdfree.assinatura"); } catch { return false; } })()`),
    "assinatura lembrada no navegador");
  await espera(500);
  await captura("fumaca-5b-ferramentas.png");

  // ---- caneta e destaque na pagina 3
  await avaliar(`document.querySelectorAll('.pagina')[2].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="caneta"]').click(), true`);
  {
    const [[ax, ay], [bx, by]] = await pontosPagina(2, [[350, 380], [500, 420]]);
    await arrastar(ax, ay, bx, by);
  }
  q = await pg3();
  ok(await desfazerDiz("Desenho à mão livre"), "caneta desenhou");
  await avaliar(`document.querySelector('[data-ferramenta="destacar"]').click(), true`);
  {
    const [[ax, ay], [bx, by]] = await pontosPagina(2, [[60, 60], [300, 90]]);
    await arrastar(ax, ay, bx, by);
  }
  ok(await desfazerDiz("Destacar texto"), "destaque sobre o texto editado");
  await avaliar(`document.querySelector('[data-ferramenta="selecionar"]').click(), true`);

  // ---- paginas: duplicar, reordenar arrastando a miniatura, excluir
  await avaliar(`document.querySelectorAll('.mini')[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), true`);
  await clicar(...(await avaliar(`(() => { const b = document.querySelectorAll('.mini')[0].getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`)));
  await avaliar(`document.querySelector('[data-acao="duplicar"]').click(), true`);
  ok(await aguardar(`document.querySelectorAll('.pagina').length === 4`), "duplicar: 4 páginas");
  // Arrasta a miniatura 3 (pagina 2) para antes da 1: [1, 1', 2, 3] -> [2, 1, 1', 3].
  await avaliar(`document.getElementById("lateral").scrollTop = 0, true`);
  const m2 = await avaliar(`[...document.querySelectorAll('.mini')].map(e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.height]; })`);
  ok(await avaliar(`document.elementFromPoint(${m2[2][0]}, ${m2[2][1]})?.closest(".mini") === document.querySelectorAll(".mini")[2]`),
    "miniatura 3 visível para arrastar");
  await arrastar(m2[2][0], m2[2][1], m2[0][0], m2[0][1] - m2[0][2] / 2 + 4);
  ok(await desfazerDiz("Reordenar páginas"), "arrastar miniatura reordena as páginas");
  // Exclui a copia (indice 2 depois de reordenar: [2, 1, 1', 3]).
  await clicar(...(await avaliar(`(() => { const b = document.querySelectorAll('.mini')[2].getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`)));
  await espera(200);
  await avaliar(`document.querySelector('[data-acao="excluir"]').click(), true`);
  ok(await aguardar(`!!document.querySelector("dialog[open] button.primario")`), "excluir pede confirmação");
  await confirmarDialogo();
  ok(await aguardar(`document.querySelectorAll('.pagina').length === 3`), "excluir: volta a 3 páginas");

  // ---- marca d'agua e dividir em ZIP
  await avaliar(`document.querySelector('[data-acao="marcaDagua"]').click(), true`);
  ok(await aguardar(`!!document.querySelector("dialog[open]")`), "marca d’água: diálogo");
  await confirmarDialogo();
  ok(await desfazerDiz("Marca d’água"), "marca d’água aplicada");
  await avaliar(`document.querySelector('[data-acao="dividir"]').click(), true`);
  await aguardar(`!!document.querySelector("dialog[open]")`);
  await confirmarDialogo();
  const zip = await baixado("fumaça_dividido.zip");
  ok(!!zip && zip.readUInt32LE(zip.length - 22) === 0x06054b50 && zip.readUInt16LE(zip.length - 12) === 3,
    "dividir a cada 1 página: ZIP com 3 PDFs baixado");
  await espera(400);
  await captura("fumaca-5d-paginas.png");

  // Salvar: baixa o arquivo.
  await avaliar(`document.getElementById("btSalvar").click(), true`);
  ok(await aguardar(`!document.title.startsWith("•")`), "salvar limpa o indicador de modificado");
  const salvo = await baixado("fumaça.pdf");
  ok(!!salvo, "salvar baixou fumaça.pdf (mesmo nome do original)");
  if (salvo) {
    const d = mupdf.Document.openDocument(salvo, "application/pdf");
    const textos = [...Array(d.countPages()).keys()].map((i) => d.loadPage(i).toStructuredText().asText());
    const tudo = textos.join(" ");
    ok(d.countPages() === 3, "arquivo salvo: 3 páginas");
    ok(/Pagina 2/.test(textos[0]) && /Pagina 1/.test(textos[1]) && /editada/.test(textos[2]),
      "arquivo salvo: ordem 2, 1, 3 (reordenar + excluir a cópia)");
    ok(/Página 3 editada no navegador/.test(tudo), "arquivo salvo: texto editado com acento");
    ok((tudo.match(/Contrato/g) ?? []).length === 2, "arquivo salvo: o texto tarjado sumiu de verdade");
    ok(/CONFIDENCIAL/.test(tudo), "arquivo salvo: marca d’água");
    const tipos = [...Array(d.countPages()).keys()].flatMap((i) => d.loadPage(i).getAnnotations().map((a) => a.getType()));
    ok(["FreeText", "Ink", "Highlight"].every((t) => tipos.includes(t)), `arquivo salvo: anotações (${tipos.join(", ")})`);
  }


  // ---- formulario
  const abrirBytes = (bytes, nome) => avaliar(`(() => {
    const bin = atob("${Buffer.from(bytes).toString("base64")}"); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(nome)}, { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true; })()`);
  await abrirBytes(criarFormulario(), "formulário.pdf");
  ok(await aguardar(`document.querySelectorAll(".campo-form").length === 3`), "formulário: 3 campos clicáveis sobre a página");
  await avaliar(`document.querySelector(".campo-form.texto").click(), true`);
  ok(await aguardar(`!!document.querySelector("input.editor-campo")`), "formulário: editor do campo de texto");
  await avaliar(`(() => { const i = document.querySelector("input.editor-campo"); i.value = "José"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
  ok(await aguardar(`document.getElementById("btDesfazer").title.includes("Preencher formulário")`), "formulário: campo de texto preenchido");
  await avaliar(`document.querySelector(".campo-form.caixa").click(), true`);
  await espera(600);
  await captura("fumaca-5c-formulario.png");

  // ---- PDF com senha
  const protegido = new mupdf.PDFDocument();
  protegido.insertPage(-1, protegido.addPage([0, 0, 400, 400], 0, { Font: { F1: protegido.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }) } },
    "BT /F1 20 Tf 40 300 Td (Documento secreto) Tj ET"));
  const cripto = protegido.saveToBuffer("encrypt=aes-256,user-password=abc,owner-password=abc").asUint8Array().slice();
  await avaliar(`window.onbeforeunload = null; true`);
  await abrirBytes(cripto, "secreto.pdf");
  // O formulario foi alterado: primeiro vem o "abrir mesmo assim".
  if (await aguardar(`!!document.querySelector("dialog[open] button.primario")?.textContent.includes("Abrir mesmo assim")`, 3000)) {
    await confirmarDialogo();
  }
  ok(await aguardar(`!!document.querySelector("dialog[open] input[type=password]")`), "PDF com senha: pede a senha");
  await noDialogo(`d.querySelector("input[type=password]").value = "errada"`);
  await confirmarDialogo();
  ok(await aguardar(`(document.querySelector("dialog[open]")?.textContent ?? "").includes("Senha incorreta")`), "senha errada: pede de novo");
  await noDialogo(`d.querySelector("input[type=password]").value = "abc"`);
  await confirmarDialogo();
  ok(await aguardar(`document.title.includes("secreto.pdf") && document.querySelectorAll(".pagina").length === 1`), "senha certa: PDF aberto");


  // ================================================================ 0.2
  await avaliar(`window.onbeforeunload = null; true`);
  const salvarFixture = (nome, bytes) => { const c = PASTA_FIXTURES + nome; writeFileSync(c, bytes); return c; };
  const abrirArquivoNoApp = async (bytes, nome) => {
    await abrirBytes(bytes, nome);
    if (await aguardar(`!!document.querySelector("dialog[open] button.primario")?.textContent.includes("Abrir mesmo assim")`, 1500)) {
      await confirmarDialogo();
    }
    return aguardar(`document.title.includes(${JSON.stringify(nome.replace(/\.[^.]+$/, ""))})`, 20000);
  };
  const menu = (acao) => avaliar(`(() => { const b = document.querySelector('[data-acao="${acao}"]'); b.click(); return true; })()`);

  // ---- abrir DOCX/TXT (conversão pelo MuPDF)
  ok(await abrirArquivoNoApp(new TextEncoder().encode("Ata da reunião\nsegunda linha"), "ata.txt"), "abrir .txt converte para PDF");
  ok(await avaliar(`document.title.includes("ata.pdf")`), "documento convertido ganha nome .pdf");

  // ---- comprimir
  ok(await abrirArquivoNoApp(criarPdfComImagemGrande(), "foto.pdf"), "abriu PDF com imagem grande");
  await menu("comprimir");
  await aguardar(`!!document.querySelector("dialog[open] select")`);
  await noDialogo(`d.querySelector("select").value = "forte"`);
  await confirmarDialogo();
  ok(await aguardar(`(document.querySelector("dialog[open]")?.textContent ?? "").includes("→")`, 30000), "comprimir mostra tamanho antes → depois");
  ok(await avaliar(`/\\d+% menor/.test(document.querySelector("dialog[open]").textContent)`), "comprimir: arquivo ficou menor");
  const txtComp = await avaliar(`document.querySelector("dialog[open]").textContent`);
  console.log("     (" + txtComp.match(/[\d,.]+ (?:KB|MB|bytes) → [\d,.]+ (?:KB|MB|bytes)[^.]*/)?.[0] + ")");
  await confirmarDialogo();
  ok(await desfazerDiz("Comprimir"), "comprimir entra no desfazer");

  // ---- exportar como imagens, docx, markdown, imagens embutidas
  await menu("exportarImagens");
  await aguardar(`!!document.querySelector("dialog[open]")`);
  await confirmarDialogo();
  const zipImg = await baixado("foto_imagens.zip", 20000);
  ok(!!zipImg && zipImg.readUInt32LE(zipImg.length - 22) === 0x06054b50, "exportar páginas: ZIP com as imagens");
  await menu("imagensEmbutidas");
  ok(!!(await baixado("foto_imagens_embutidas.zip", 20000)), "extrair imagens embutidas: ZIP");
  ok(await abrirArquivoNoApp(readFileSync(PASTA_FIXTURES + "estruturado.pdf"), "estruturado.pdf"), "abriu PDF de texto");
  await menu("docx");
  const docx = await baixado("estruturado.docx", 20000);
  ok(!!docx && /Relatório/.test(mupdf.Document.openDocument(docx, "x.docx").loadPage(0).toStructuredText().asText()),
    "converter para Word: .docx que reabre com o texto");
  await menu("markdown");
  const md = await baixado("estruturado.md", 20000);
  ok(!!md && /^# Relatório Anual/m.test(md.toString("utf8")), "converter para Markdown: título vira #");

  // ---- recortar (ferramenta) e carimbo
  const antesCrop = await avaliar(`(() => { const p = document.querySelector('.pagina'); return p.offsetWidth / p.offsetHeight; })()`);
  await avaliar(`document.querySelectorAll('.pagina')[0].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="recortar"]').click(), true`);
  let q1 = await avaliar(`(() => { const b = document.querySelector('.pagina').getBoundingClientRect(); return [b.left, b.top, b.width / 595]; })()`);
  await arrastar(q1[0] + 40 * q1[2], q1[1] + 30 * q1[2], q1[0] + 400 * q1[2], q1[1] + 330 * q1[2]);
  if (await aguardar(`!!document.querySelector("dialog[open] button.primario")`, 2000)) await confirmarDialogo();
  ok(await desfazerDiz("Recortar"), "recortar pela área arrastada");
  const depoisCrop = await avaliar(`(() => { const p = document.querySelector('.pagina'); return p.offsetWidth / p.offsetHeight; })()`);
  ok(Math.abs(depoisCrop - 360 / 300) < 0.05 && Math.abs(antesCrop - depoisCrop) > 0.2, `página recortada (${antesCrop.toFixed(2)} → ${depoisCrop.toFixed(2)})`);
  await avaliar(`document.querySelector('[data-ferramenta="carimbo"]').click(), true`);
  ok(await aguardar(`!!document.querySelector("dialog[open] select")`), "carimbo: escolher o texto");
  await confirmarDialogo();
  q1 = await avaliar(`(() => { const b = document.querySelector('.pagina').getBoundingClientRect(); return [b.left, b.top, b.width / 360]; })()`);
  await clicar(q1[0] + 180 * q1[2], q1[1] + 200 * q1[2]);
  ok(await desfazerDiz("Carimbo"), "carimbo aplicado");
  await avaliar(`document.querySelector('[data-ferramenta="selecionar"]').click(), true`);

  // ---- propriedades e substituir
  await menu("propriedades");
  await aguardar(`!!document.querySelector("dialog[open] input")`);
  await noDialogo(`d.querySelector("input").value = "Relatório de teste"`);
  await confirmarDialogo();
  ok(await desfazerDiz("Propriedades do documento"), "propriedades gravadas");
  await menu("substituir");
  await aguardar(`!!document.querySelector("dialog[open] input")`);
  await noDialogo(`const i = d.querySelectorAll("input"); i[0].value = "primeiro item"; i[1].value = "item trocado"`);
  await confirmarDialogo();
  ok(await desfazerDiz("Substituir texto"), "substituir texto em todo o documento");

  // ---- comparar
  const pdfB = salvarFixture("versao-b.pdf", pdfEstruturadoB());
  arquivoParaEscolher = pdfB;
  await menu("comparar");
  ok(await aguardar(`!!document.querySelector(".comparacao")`, 20000), "comparar: tela lado a lado abriu");
  ok(await aguardar(`document.querySelectorAll(".item-dif").length >= 1`), "comparar: lista de diferenças");
  ok(await aguardar(`document.querySelectorAll(".marca-dif.inserido").length >= 1 && document.querySelectorAll(".comparacao canvas").length >= 2`),
    "comparar: realces verdes no documento B");
  await avaliar(`document.querySelector(".item-dif").click(), true`);
  await espera(500);
  await captura("fumaca-8-comparar.png");
  await tecla("Escape", "Escape", 0, 27);
  ok(await aguardar(`!document.querySelector(".comparacao")`), "comparar: Esc fecha");

  // ---- reparar
  arquivoParaEscolher = salvarFixture("danificado.pdf", pdfTruncado());
  await menu("reparar");
  ok(await aguardar(`(document.querySelector("dialog[open]")?.textContent ?? "").includes("recuperada")`, 20000), "reparar: relatório de páginas recuperadas");
  await confirmarDialogo();
  ok(!!(await baixado("danificado_reparado.pdf")), "reparar: baixou o arquivo reparado");

  // ---- formulário: detectar e criar; campo por clique
  ok(await abrirArquivoNoApp(readFileSync(PASTA_FIXTURES + "ficha.pdf"), "ficha.pdf"), "abriu a ficha");
  await menu("detectarCampos");
  ok(await aguardar(`document.querySelectorAll(".sugestao-campo").length === 3`), "detectar campos: 3 sugestões na página");
  await avaliar(`document.querySelector(".barra-sugestoes button.primario").click(), true`);
  ok(await aguardar(`document.querySelectorAll(".campo-form").length === 3`, 20000), "sugestões viraram campos preenchíveis");
  await avaliar(`document.querySelector('[data-ferramenta="campoTexto"]').click(), true`);
  await clicar(...(await pontoPagina(0, 300, 400)));
  ok(await aguardar(`document.querySelectorAll(".campo-form").length === 4`, 20000), "campo de texto criado com um clique");
  await avaliar(`document.querySelector('[data-ferramenta="selecionar"]').click(), true`);

  // ---- marca d'água de imagem
  arquivoParaEscolher = salvarFixture("logo.png", pngTeste(60, 30, true));
  await menu("marcaImagem");
  ok(await aguardar(`!!document.querySelector("dialog[open] input[type=range]")`), "marca d’água de imagem: diálogo");
  await confirmarDialogo();
  ok(await desfazerDiz("Marca d’água de imagem"), "marca d’água de imagem aplicada");

  // ---- OCR de um PDF escaneado
  ok(await abrirArquivoNoApp(readFileSync(PASTA_FIXTURES + "escaneado.pdf"), "escaneado.pdf"), "abriu PDF escaneado (só imagem)");
  await menu("ocr");
  await aguardar(`!!document.querySelector("dialog[open] select")`);
  await confirmarDialogo();
  const t0 = Date.now();
  ok(await aguardar(`(document.querySelector(".avisos")?.textContent ?? "").includes("Texto reconhecido")`, 120000),
    "OCR: texto reconhecido (tesseract.js servido pelo próprio site)");
  console.log(`     (OCR: ${Date.now() - t0} ms)`);
  await tecla("f", "KeyF", 2, 70);
  await avaliar(`(() => { const i = document.getElementById("inBusca"); i.value = "prestação"; i.dispatchEvent(new Event("input")); return true; })()`);
  ok(await aguardar(`document.getElementById("contagemBusca").textContent === "1 de 1"`), "OCR: a palavra reconhecida é encontrada pela busca");
  await avaliar(`document.getElementById("btBuscaFechar").click(), true`);

  // ---- digitalizar com a câmera (câmera falsa do Chrome)
  await avaliar(`window.onbeforeunload = null; true`);
  await menu("camera");
  if (await aguardar(`!!document.querySelector("dialog[open] button.primario")?.textContent.includes("Abrir mesmo assim")`, 1500)) {
    // (o aviso de alterações só aparece ao abrir o PDF, no fim)
  }
  ok(await aguardar(`(() => { const v = document.querySelector(".camera-video"); return !!v && v.videoWidth > 0; })()`, 15000), "câmera: prévia ao vivo");
  await avaliar(`document.querySelector(".camera-capturar").click(), true`);
  ok(await aguardar(`document.querySelectorAll(".camera-pagina").length === 1`), "câmera: página capturada");
  await avaliar(`document.querySelector(".camera-capturar").click(), true`);
  ok(await aguardar(`document.querySelectorAll(".camera-pagina").length === 2`), "câmera: segunda página");
  await captura("fumaca-9-camera.png");
  await avaliar(`document.querySelector(".camera-botoes button.primario").click(), true`);
  if (await aguardar(`!!document.querySelector("dialog[open] button.primario")?.textContent.includes("Abrir mesmo assim")`, 3000)) {
    await confirmarDialogo();
  }
  ok(await aguardar(`document.title.includes("digitalizacao-") && document.querySelectorAll(".pagina").length === 2`, 20000),
    "câmera: PDF de 2 páginas criado e aberto");

  // Service worker e modo offline.
  if (!DEV) {
  ok(await aguardar(`navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))`, 20000), "service worker ativo");
  await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await avaliar(`window.onbeforeunload = null; true`);
  await cdp("Page.reload", { ignoreCache: false });
  await espera(1500);
  ok(await aguardar(`document.getElementById("btAbrirGrande")?.textContent === "Abrir PDF"`, 20000),
    "sem rede: app e motor carregam do cache (offline)");
  await captura("fumaca-6-offline.png");
  await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  // Tela estreita (celular): sem rolagem horizontal da pagina.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await espera(400);
  ok(await avaliar(`document.documentElement.scrollWidth <= window.innerWidth + 1`), "390 px de largura: sem rolagem horizontal");
  await captura("fumaca-7-celular.png");
} catch (e) {
  falhas.push("erro no roteiro: " + e.message);
  console.log("ERRO", e);
} finally {
  // Avisos esperados do modo offline (a rede foi cortada de proposito).
  const reais = erros.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR/.test(e));
  ok(reais.length === 0, `nenhum erro no console (${reais.length})`);
  ok(externas.length === 0, `nenhuma requisição a outro site (${externas.length})`);
  for (const u of externas.slice(0, 10)) console.log("    ", u);
  for (const e of reais) console.log("   ", e);
  ws.close();
  nav.kill();
  vite.kill();
  console.log(falhas.length ? `\n${falhas.length} falha(s).` : "\nTudo certo.");
  process.exit(falhas.length ? 1 : 0);
}
