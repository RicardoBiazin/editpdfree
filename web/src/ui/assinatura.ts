// Assinatura: desenhar com mouse/toque (ou escolher uma imagem) e lembrar no
// navegador (localStorage, que pode nao existir: modo privado, bloqueio...).

import { campo, dialogo, el } from "./dialogos.ts";

const CHAVE = "editpdfree.assinatura";

export function assinaturaGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

function guardar(dataUrl: string | null): void {
  try {
    if (dataUrl) localStorage.setItem(CHAVE, dataUrl);
    else localStorage.removeItem(CHAVE);
  } catch {
    // Sem armazenamento: a assinatura vale so' para esta sessao.
  }
}

export function dataUrlParaBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Recorta as bordas transparentes do canvas e devolve PNG (data URL). */
function recortar(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const m = 6;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m); y1 = Math.min(height - 1, y1 + m);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Dialogo de assinatura. Devolve o PNG (data URL) ou null. */
export async function pedirAssinatura(): Promise<string | null> {
  const guardada = assinaturaGuardada();
  const canvas = el("canvas", { classe: "bloco-assinatura", width: 900, height: 300 });
  canvas.setAttribute("aria-label", "Área para desenhar a assinatura");
  const ctx = canvas.getContext("2d")!;
  let imagemEscolhida: string | null = null;
  let desenhou = false;
  const corInput = el("input", { type: "color", value: "#1a237e", name: "cor" });
  const lembrar = el("input", { type: "checkbox", name: "lembrar", checked: true });
  const arquivo = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", classe: "oculto" });
  const btLimpar = el("button", { type: "button", textContent: "Limpar" });
  const btImagem = el("button", { type: "button", textContent: "Usar uma imagem…" });
  const btGuardada = guardada ? el("button", { type: "button", textContent: "Usar a assinatura guardada" }) : null;

  const limpar = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    desenhou = false;
    imagemEscolhida = null;
  };
  btLimpar.addEventListener("click", limpar);
  btImagem.addEventListener("click", () => arquivo.click());
  const desenharImagem = (url: string) => {
    const img = new Image();
    img.onload = () => {
      limpar();
      const e = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
      const w = img.width * e, h = img.height * e;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      imagemEscolhida = url;
    };
    img.src = url;
  };
  arquivo.addEventListener("change", () => {
    const f = arquivo.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => desenharImagem(String(r.result));
    r.readAsDataURL(f);
  });
  btGuardada?.addEventListener("click", () => desenharImagem(guardada!));

  let ultimo: [number, number] | null = null;
  const pos = (ev: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height];
  };
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    if (imagemEscolhida) limpar();
    ultimo = pos(ev);
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!ultimo) return;
    const p = pos(ev);
    ctx.strokeStyle = corInput.value;
    ctx.lineWidth = ev.pressure > 0 && ev.pointerType === "pen" ? 2 + ev.pressure * 5 : 4.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(ultimo[0], ultimo[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ultimo = p;
    desenhou = true;
  });
  const soltar = () => { ultimo = null; };
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);

  const acoes = el("div", { classe: "linha-botoes" }, btLimpar, btImagem, btGuardada, arquivo);
  const opcoes = el("div", { classe: "linha-campos" }, campo("Cor da tinta", corInput),
    el("label", { classe: "campo-check" }, lembrar, " Lembrar neste navegador"));
  const { valor } = await dialogo("Assinatura",
    [el("p", { classe: "dica", textContent: "Desenhe com o mouse, o dedo ou a caneta. Depois clique na página para posicionar." }),
      canvas, acoes, opcoes],
    [{ rotulo: "Cancelar", valor: "cancelar" }, { rotulo: "Posicionar", valor: "ok", primario: true }],
    () => canvas.focus(),
    () => (!desenhou && !imagemEscolhida ? "Desenhe a assinatura ou escolha uma imagem." : null));
  if (valor !== "ok") return null;
  const png = recortar(canvas);
  if (!png) return null;
  guardar(lembrar.checked ? png : null);
  return png;
}
