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
import { criarFormulario } from "../test/fixtures.ts";

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
// Perfil limpo a cada rodada: sem cookie do portao nem cache de service worker.
rmSync(perfil, { recursive: true, force: true });
const nav = spawn(chrome, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${perfil}`,
  "--no-first-run", "--no-default-browser-check", "--disable-component-update", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
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
const erros = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { ok: res, no } = pend.get(m.id);
    pend.delete(m.id);
    if (m.error) no(new Error(m.error.message)); else res(m.result);
  } else if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) {
    erros.push("console: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
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
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, 5000);
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
  q = await pg3();
  await clicar(q[0] + 150 * q[2], q[1] + 380 * q[2]);
  ok(await desfazerDiz("Assinatura"), "assinatura posicionada na página");
  ok(await avaliar(`(() => { try { return !!localStorage.getItem("editpdfree.assinatura"); } catch { return false; } })()`),
    "assinatura lembrada no navegador");
  await espera(500);
  await captura("fumaca-5b-ferramentas.png");

  // ---- caneta e destaque na pagina 3
  await avaliar(`document.querySelectorAll('.pagina')[2].scrollIntoView(), true`);
  await espera(300);
  await avaliar(`document.querySelector('[data-ferramenta="caneta"]').click(), true`);
  q = await pg3();
  await arrastar(q[0] + 350 * q[2], q[1] + 380 * q[2], q[0] + 500 * q[2], q[1] + 420 * q[2]);
  ok(await desfazerDiz("Desenho à mão livre"), "caneta desenhou");
  await avaliar(`document.querySelector('[data-ferramenta="destacar"]').click(), true`);
  await arrastar(q[0] + 60 * q[2], q[1] + 60 * q[2], q[0] + 300 * q[2], q[1] + 90 * q[2]);
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
  for (const e of reais) console.log("   ", e);
  ws.close();
  nav.kill();
  vite.kill();
  console.log(falhas.length ? `\n${falhas.length} falha(s).` : "\nTudo certo.");
  process.exit(falhas.length ? 1 : 0);
}
