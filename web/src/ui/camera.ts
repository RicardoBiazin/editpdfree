/*
 * Digitalizar com a camera: captura varias paginas, recorta as bordas da
 * folha e realca o contraste (core/digitalizar.ts), deixa reordenar/excluir e
 * monta o PDF. As fotos nunca saem do navegador.
 *
 * Precisa de HTTPS (ou localhost) e de `Permissions-Policy: camera=(self)`.
 */

import { detectarDocumento, realcar, recortarImagem, type ImagemRGBA, type ModoRealce } from "../core/digitalizar.ts";
import { avisar, el } from "./dialogos.ts";
import { icone } from "./icones.ts";

interface Captura { blob: Blob; url: string }

function mensagemDeErro(e: unknown): string {
  const nome = (e as DOMException)?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "A permissão para usar a câmera foi negada. Libere a câmera nas configurações do navegador para este site.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Nenhuma câmera foi encontrada neste aparelho.";
  if (nome === "NotReadableError") return "A câmera está sendo usada por outro programa.";
  return "Não foi possível abrir a câmera.";
}

/** Abre a tela de digitalizacao. Devolve as paginas (JPEG) ou null se cancelou. */
export async function digitalizar(): Promise<Blob[] | null> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    avisar("A câmera só funciona em conexão segura (HTTPS) e num navegador com suporte a câmera.", "erro");
    return null;
  }
  let fluxo: MediaStream;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false,
    });
  } catch (e) {
    avisar(mensagemDeErro(e), "erro", 9000);
    return null;
  }
  const video = el("video", { autoplay: true, muted: true, playsInline: true, classe: "camera-video" });
  video.srcObject = fluxo;
  const modo = el("select", { classe: "camera-modo", title: "Realce" });
  for (const [v, t] of [["cinza", "Cinza (realçado)"], ["pb", "Preto e branco"], ["cor", "Colorido (realçado)"]]) {
    modo.append(el("option", { value: v, textContent: t }));
  }
  const recorte = el("input", { type: "checkbox", checked: true });
  const btCapturar = el("button", { classe: "primario camera-capturar", type: "button", textContent: "Capturar página" });
  const btConcluir = el("button", { classe: "primario", type: "button", textContent: "Criar PDF", disabled: true });
  const btCancelar = el("button", { type: "button", textContent: "Cancelar" });
  const miniaturas = el("div", { classe: "camera-paginas" });
  miniaturas.setAttribute("aria-label", "Páginas capturadas");
  const status = el("span", { classe: "camera-status", textContent: "Aponte a câmera para a folha, de cima, e capture." });
  const tela = el("div", { classe: "camera", role: "dialog" } as Partial<HTMLDivElement>,
    el("div", { classe: "camera-topo" }, el("strong", { textContent: "Digitalizar com a câmera" }), status),
    el("div", { classe: "camera-visor" }, video),
    el("div", { classe: "camera-controles" },
      el("label", { classe: "campo-check" }, recorte, " Recortar as bordas"), modo, btCapturar),
    miniaturas,
    el("div", { classe: "camera-botoes" }, btCancelar, btConcluir));
  tela.setAttribute("aria-modal", "true");
  document.body.append(tela);
  const capturas: Captura[] = [];

  const redesenhar = () => {
    miniaturas.textContent = "";
    capturas.forEach((c, i) => {
      const img = el("img", { src: c.url, alt: `Página ${i + 1}` });
      const esq = el("button", { type: "button", title: "Mover para a esquerda", disabled: i === 0 });
      esq.innerHTML = icone("acima");
      esq.classList.add("girar-esq");
      const dir = el("button", { type: "button", title: "Mover para a direita", disabled: i === capturas.length - 1 });
      dir.innerHTML = icone("abaixo");
      dir.classList.add("girar-dir");
      const del = el("button", { type: "button", title: "Excluir esta página" });
      del.innerHTML = icone("lixeira");
      esq.addEventListener("click", () => { [capturas[i - 1], capturas[i]] = [capturas[i], capturas[i - 1]]; redesenhar(); });
      dir.addEventListener("click", () => { [capturas[i + 1], capturas[i]] = [capturas[i], capturas[i + 1]]; redesenhar(); });
      del.addEventListener("click", () => { URL.revokeObjectURL(c.url); capturas.splice(i, 1); redesenhar(); });
      miniaturas.append(el("figure", { classe: "camera-pagina" }, img,
        el("figcaption", {}, el("span", { textContent: String(i + 1) }), esq, dir, del)));
    });
    btConcluir.disabled = capturas.length === 0;
    btConcluir.textContent = capturas.length ? `Criar PDF (${capturas.length} pág.)` : "Criar PDF";
  };

  btCapturar.addEventListener("click", async () => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    btCapturar.disabled = true;
    try {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, w, h);
      let img: ImagemRGBA = { largura: w, altura: h, dados: ctx.getImageData(0, 0, w, h).data };
      if (recorte.checked) img = recortarImagem(img, detectarDocumento(img));
      img = realcar(img, modo.value as ModoRealce);
      c.width = img.largura;
      c.height = img.altura;
      ctx.putImageData(new ImageData(img.dados as Uint8ClampedArray<ArrayBuffer>, img.largura, img.altura), 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (!blob) throw new Error("falhou");
      capturas.push({ blob, url: URL.createObjectURL(blob) });
      redesenhar();
      status.textContent = `${capturas.length} página(s) capturada(s).`;
    } catch {
      avisar("Não foi possível capturar a imagem da câmera.", "erro");
    } finally {
      btCapturar.disabled = false;
    }
  });

  return new Promise((resolver) => {
    const sair = (resultado: Blob[] | null) => {
      for (const t of fluxo.getTracks()) t.stop();
      for (const c of capturas) URL.revokeObjectURL(c.url);
      tela.remove();
      document.removeEventListener("keydown", tecla, true);
      resolver(resultado);
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        sair(null);
      }
    };
    document.addEventListener("keydown", tecla, true);
    btCancelar.addEventListener("click", () => sair(null));
    btConcluir.addEventListener("click", () => sair(capturas.map((c) => c.blob)));
    btCapturar.focus();
  });
}
