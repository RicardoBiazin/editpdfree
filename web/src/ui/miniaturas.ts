/*
 * Miniaturas: navegacao, selecao (clique, Ctrl/Shift+clique) e reordenar
 * arrastando. O arrasto e' feito com eventos de ponteiro (funciona com mouse
 * e com toque; no toque, segurar ~0,3 s para comecar a arrastar, senao a lista
 * rola normalmente). Renderizacao preguicosa, como no visor.
 */

import type { Motor, Estado } from "../rpc.ts";
import { ordemAoMover } from "../core/intervalos.ts";

const LARGURA = 132;

interface Mini { div: HTMLDivElement; canvas: HTMLCanvasElement; visivel: boolean; versao: number }

export class Miniaturas {
  private el: HTMLElement;
  private motor: Motor;
  private itens: Mini[] = [];
  private estado: Estado | null = null;
  private observador: IntersectionObserver;
  private ocupado = false;
  selecao = new Set<number>();
  private ancora = 0;
  atual = 0;
  aoIrPara: (i: number) => void = () => undefined;
  aoReordenar: (ordem: number[]) => void = () => undefined;
  aoMudarSelecao: () => void = () => undefined;
  aoSoltarArquivos: (arquivos: File[], posicao: number) => void = () => undefined;

  constructor(el: HTMLElement, motor: Motor) {
    this.el = el;
    this.motor = motor;
    this.observador = new IntersectionObserver((es) => {
      for (const e of es) {
        const i = Number((e.target as HTMLElement).dataset.indice);
        if (this.itens[i]) this.itens[i].visivel = e.isIntersecting;
      }
      this.proxima();
    }, { root: el.parentElement, rootMargin: "200px 0px" });
    this.instalarArrasto();
    // Arquivos soltos sobre a lista entram no documento naquela posicao.
    el.addEventListener("dragover", (ev) => {
      if (ev.dataTransfer?.types.includes("Files")) {
        ev.preventDefault();
        ev.stopPropagation();
        this.marcarPosicao(this.posicaoEm(ev.clientY));
      }
    });
    el.addEventListener("dragleave", () => this.marcarPosicao(-1));
    el.addEventListener("drop", (ev) => {
      if (!ev.dataTransfer?.files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pos = this.posicaoEm(ev.clientY);
      this.marcarPosicao(-1);
      this.aoSoltarArquivos([...ev.dataTransfer.files], pos);
    });
  }

  aplicar(estado: Estado): void {
    const n = estado.paginas.length;
    const mudouQtd = !this.estado || this.estado.paginas.length !== n;
    this.estado = estado;
    if (mudouQtd) {
      for (const m of this.itens) this.observador.unobserve(m.div);
      this.el.textContent = "";
      this.itens = [];
      for (let i = 0; i < n; i++) {
        const div = document.createElement("div");
        div.className = "mini";
        div.dataset.indice = String(i);
        div.tabIndex = 0;
        div.setAttribute("role", "button");
        div.setAttribute("aria-label", `Página ${i + 1}`);
        const canvas = document.createElement("canvas");
        const rot = document.createElement("span");
        rot.className = "mini-num";
        rot.textContent = String(i + 1);
        div.append(canvas, rot);
        this.el.append(div);
        this.itens.push({ div, canvas, visivel: false, versao: -1 });
        this.observador.observe(div);
        div.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            this.clicar(i, ev);
          }
        });
      }
      this.selecao = new Set([...this.selecao].filter((i) => i < n));
    }
    estado.paginas.forEach((p, i) => {
      const c = this.itens[i].canvas;
      const h = LARGURA * p.altura / p.largura;
      c.style.width = `${LARGURA}px`;
      c.style.height = `${h}px`;
    });
    this.pintarSelecao();
    this.proxima();
  }

  private async proxima(): Promise<void> {
    if (this.ocupado || !this.estado) return;
    const v = this.estado.versao;
    const i = this.itens.findIndex((m) => m.visivel && m.versao !== v);
    if (i < 0) return;
    this.ocupado = true;
    const info = this.estado.paginas[i];
    const escala = LARGURA * Math.min(window.devicePixelRatio || 1, 2) / info.largura;
    try {
      const r = await this.motor.pedir<{ largura: number; altura: number; rgba: Uint8ClampedArray; versao: number }>(
        "render", { pagina: i, escala });
      const m = this.itens[i];
      if (m) {
        m.canvas.width = r.largura;
        m.canvas.height = r.altura;
        m.canvas.getContext("2d")!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.largura, r.altura), 0, 0);
        m.versao = r.versao;
      }
    } catch {
      if (this.itens[i]) this.itens[i].versao = v;
    } finally {
      this.ocupado = false;
    }
    this.proxima();
  }

  marcarAtual(i: number): void {
    this.atual = i;
    this.itens.forEach((m, k) => m.div.classList.toggle("atual", k === i));
    const m = this.itens[i];
    if (m) {
      const box = this.el.parentElement!;
      const top = m.div.offsetTop, bottom = top + m.div.offsetHeight;
      if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
        box.scrollTo({ top: top - 20 });
      }
    }
  }

  private pintarSelecao(): void {
    this.itens.forEach((m, k) => {
      m.div.classList.toggle("selecionada", this.selecao.has(k));
      m.div.setAttribute("aria-pressed", String(this.selecao.has(k)));
    });
  }

  /** Paginas alvo das operacoes: a selecao, ou a pagina atual. */
  alvo(): number[] {
    return this.selecao.size ? [...this.selecao].sort((a, b) => a - b) : [this.atual];
  }

  limparSelecao(): void {
    this.selecao.clear();
    this.pintarSelecao();
    this.aoMudarSelecao();
  }

  private clicar(i: number, ev: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    if (ev.shiftKey) {
      const [a, b] = [Math.min(this.ancora, i), Math.max(this.ancora, i)];
      this.selecao = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (ev.ctrlKey || ev.metaKey) {
      if (this.selecao.has(i)) this.selecao.delete(i); else this.selecao.add(i);
      this.ancora = i;
    } else {
      this.selecao.clear();
      this.ancora = i;
      this.aoIrPara(i);
    }
    this.pintarSelecao();
    this.aoMudarSelecao();
  }

  /** Posicao de insercao (0..n) para um y na tela. */
  private posicaoEm(clientY: number): number {
    for (let i = 0; i < this.itens.length; i++) {
      const r = this.itens[i].div.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return this.itens.length;
  }

  private marcarPosicao(pos: number): void {
    this.itens.forEach((m, k) => {
      m.div.classList.toggle("inserir-antes", k === pos);
      m.div.classList.toggle("inserir-depois", pos === this.itens.length && k === this.itens.length - 1);
    });
  }

  private instalarArrasto(): void {
    let inicio: { i: number; x: number; y: number; id: number; toque: boolean; t: number } | null = null;
    let arrastando = false;
    let timer = 0;
    const cancelar = () => {
      clearTimeout(timer);
      inicio = null;
      arrastando = false;
      this.el.classList.remove("arrastando");
      this.marcarPosicao(-1);
    };
    this.el.addEventListener("pointerdown", (ev) => {
      const div = (ev.target as HTMLElement).closest(".mini") as HTMLElement | null;
      if (!div || ev.button !== 0) return;
      const i = Number(div.dataset.indice);
      inicio = { i, x: ev.clientX, y: ev.clientY, id: ev.pointerId, toque: ev.pointerType !== "mouse", t: Date.now() };
      if (inicio.toque) {
        timer = window.setTimeout(() => {
          if (inicio) {
            arrastando = true;
            this.el.classList.add("arrastando");
            try { this.el.setPointerCapture(inicio.id); } catch { /* sem captura */ }
            navigator.vibrate?.(15);
          }
        }, 320);
      }
    });
    this.el.addEventListener("pointermove", (ev) => {
      if (!inicio || ev.pointerId !== inicio.id) return;
      const d = Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y);
      if (!arrastando) {
        if (inicio.toque) {
          if (d > 10) cancelar(); // o usuario esta' rolando a lista
          return;
        }
        if (d < 8) return;
        arrastando = true;
        this.el.classList.add("arrastando");
        this.el.setPointerCapture(ev.pointerId);
      }
      ev.preventDefault();
      this.marcarPosicao(this.posicaoEm(ev.clientY));
      // Rola a lista perto das bordas.
      const box = this.el.parentElement!.getBoundingClientRect();
      if (ev.clientY < box.top + 30) this.el.parentElement!.scrollBy(0, -12);
      else if (ev.clientY > box.bottom - 30) this.el.parentElement!.scrollBy(0, 12);
    });
    this.el.addEventListener("pointerup", (ev) => {
      if (!inicio || ev.pointerId !== inicio.id) return;
      const i = inicio.i;
      if (arrastando) {
        const pos = this.posicaoEm(ev.clientY);
        const mover = this.selecao.has(i) ? [...this.selecao] : [i];
        const antes = mover.filter((k) => k < pos).length;
        const ordem = ordemAoMover(this.itens.length, mover, pos - antes);
        cancelar();
        if (ordem.some((v, k) => v !== k)) {
          this.selecao.clear();
          this.aoReordenar(ordem);
        }
        return;
      }
      cancelar();
      this.clicar(i, ev);
    });
    this.el.addEventListener("pointercancel", cancelar);
    // No toque, depois do "segurar", impedir que o dedo role a lista: sem
    // isso o navegador comeca a rolar e cancela os eventos de ponteiro.
    this.el.addEventListener("touchmove", (ev) => {
      if (arrastando) ev.preventDefault();
    }, { passive: false });
    this.el.addEventListener("contextmenu", (ev) => {
      if (arrastando) ev.preventDefault();
    });
  }

  limpar(): void {
    for (const m of this.itens) this.observador.unobserve(m.div);
    this.itens = [];
    this.el.textContent = "";
    this.estado = null;
    this.selecao.clear();
  }
}
