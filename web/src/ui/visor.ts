/*
 * Visualizador: rolagem continua, zoom, renderizacao preguicosa.
 *
 * So' as paginas visiveis (e uma margem) sao desenhadas; o numero de paginas
 * com bitmap na memoria e' limitado (MAX_EM_CACHE). O worker desenha uma
 * pagina por vez -- mandar varias de uma vez so' enfileiraria trabalho que
 * talvez nem seja mais necessario quando chegar a vez dele.
 */

import type { Motor, Estado, InfoPagina } from "../rpc.ts";
import { paginaParaTela, retanguloPaginaParaTela, telaParaPagina, type Ponto, type Retangulo } from "../core/coordenadas.ts";

export const MAX_EM_CACHE = 14;
/** Limite de pixels do bitmap de uma pagina (celulares recusam canvas enorme). */
const MAX_PIXELS = 14_000_000;
/** 100% = tamanho real: 1 pt = 1/72 pol = 96/72 px CSS. */
export const PX_POR_PT = 96 / 72;
export const ZOOM_MIN = 0.25, ZOOM_MAX = 5;

export interface PaginaVisor {
  indice: number;
  div: HTMLDivElement;
  canvas: HTMLCanvasElement;
  camada: HTMLDivElement;
  realces: HTMLDivElement;
  extras: HTMLDivElement;
  desenho: SVGSVGElement;
  info: InfoPagina;
  /** Escala e versao do bitmap atual (null = sem bitmap). */
  feito: { escala: number; versao: number } | null;
  visivel: boolean;
}

export class Visor {
  readonly el: HTMLElement;
  private conteudo: HTMLElement;
  private motor: Motor;
  estado: Estado | null = null;
  paginas: PaginaVisor[] = [];
  zoom = 1;
  private observador: IntersectionObserver;
  private renderizando = false;
  private agendado = 0;
  aoMudarPagina: (i: number) => void = () => undefined;
  aoMudarZoom: (z: number) => void = () => undefined;
  /** Chamado quando a pagina fica visivel ou muda de versao (para buscar
   *  anotacoes/campos). */
  aoMostrarPagina: (p: PaginaVisor) => void = () => undefined;
  aoConstruirPagina: (p: PaginaVisor) => void = () => undefined;
  paginaAtual = 0;

  constructor(el: HTMLElement, conteudo: HTMLElement, motor: Motor) {
    this.el = el;
    this.conteudo = conteudo;
    this.motor = motor;
    this.observador = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        const p = this.paginas[Number((e.target as HTMLElement).dataset.indice)];
        if (!p) continue;
        const antes = p.visivel;
        p.visivel = e.isIntersecting;
        if (p.visivel && !antes) this.aoMostrarPagina(p);
      }
      this.agendar();
    }, { root: el, rootMargin: "60% 0px" });
    el.addEventListener("scroll", () => this.aoRolar(), { passive: true });
    window.addEventListener("resize", () => this.agendar());
  }

  get escalaCss(): number {
    return this.zoom * PX_POR_PT;
  }

  /** Novo estado vindo do worker. Reaproveita os elementos quando da'. */
  aplicar(estado: Estado): void {
    const antigo = this.estado;
    this.estado = estado;
    const mesmaEstrutura = antigo && antigo.paginas.length === estado.paginas.length
      && antigo.paginas.every((p, i) => p.largura === estado.paginas[i].largura
        && p.altura === estado.paginas[i].altura && p.rotacao === estado.paginas[i].rotacao);
    if (!mesmaEstrutura) {
      this.construir();
    } else {
      estado.paginas.forEach((info, i) => { this.paginas[i].info = info; });
      for (const p of this.paginas) if (p.visivel) this.aoMostrarPagina(p);
    }
    this.agendar();
  }

  private construir(): void {
    const anterior = this.paginaAtual;
    for (const p of this.paginas) this.observador.unobserve(p.div);
    this.conteudo.textContent = "";
    this.paginas = [];
    if (!this.estado) return;
    this.estado.paginas.forEach((info, i) => {
      const div = document.createElement("div");
      div.className = "pagina";
      div.dataset.indice = String(i);
      div.setAttribute("aria-label", `Página ${i + 1}`);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 0;
      const camada = document.createElement("div");
      camada.className = "camada";
      const realces = document.createElement("div");
      realces.className = "realces";
      const desenho = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      desenho.classList.add("desenho");
      const extras = document.createElement("div");
      extras.className = "extras";
      camada.append(realces, desenho, extras);
      div.append(canvas, camada);
      this.conteudo.append(div);
      const p: PaginaVisor = { indice: i, div, canvas, camada, realces, extras, desenho, info, feito: null, visivel: false };
      this.paginas.push(p);
      this.dimensionar(p);
      this.observador.observe(div);
      this.aoConstruirPagina(p);
    });
    this.irPara(Math.min(anterior, this.paginas.length - 1), false);
  }

  private dimensionar(p: PaginaVisor): void {
    const w = p.info.largura * this.escalaCss, h = p.info.altura * this.escalaCss;
    p.div.style.width = `${w}px`;
    p.div.style.height = `${h}px`;
    p.desenho.setAttribute("viewBox", `0 0 ${w} ${h}`);
    p.desenho.setAttribute("width", String(w));
    p.desenho.setAttribute("height", String(h));
  }

  definirZoom(z: number, ancora?: { x: number; y: number }): void {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    if (!this.paginas.length || Math.abs(z - this.zoom) < 0.001) {
      this.zoom = z;
      this.aoMudarZoom(z);
      return;
    }
    // Mantem parado o ponto sob a ancora (cursor ou centro da tela).
    const r = this.el.getBoundingClientRect();
    const ax = ancora ? ancora.x - r.left : r.width / 2;
    const ay = ancora ? ancora.y - r.top : r.height / 2;
    const cx = this.el.scrollLeft + ax, cy = this.el.scrollTop + ay;
    // O deslocamento vertical entre paginas (gap fixo) nao escala; aproxima
    // pela pagina sob a ancora.
    const alvo = this.paginaEm(cy);
    const pg = this.paginas[alvo];
    const relY = (cy - pg.div.offsetTop) / pg.div.offsetHeight;
    const relX = (cx - pg.div.offsetLeft) / pg.div.offsetWidth;
    this.zoom = z;
    for (const p of this.paginas) this.dimensionar(p);
    this.el.scrollTop = pg.div.offsetTop + relY * pg.div.offsetHeight - ay;
    this.el.scrollLeft = pg.div.offsetLeft + relX * pg.div.offsetWidth - ax;
    this.aoMudarZoom(z);
    this.agendar();
  }

  /** Zoom que faz a pagina atual caber na largura do visor. */
  zoomLargura(): number {
    const p = this.paginas[this.paginaAtual] ?? this.paginas[0];
    if (!p) return 1;
    // Margem das paginas (16 px de cada lado) + folga para a barra de rolagem.
    const livre = this.el.clientWidth - 48;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, livre / (p.info.largura * PX_POR_PT)));
  }

  private paginaEm(y: number): number {
    let melhor = 0;
    for (const p of this.paginas) {
      if (p.div.offsetTop <= y) melhor = p.indice;
      else break;
    }
    return melhor;
  }

  /** Durante a rolagem suave de irPara(), as paginas intermediarias nao
   *  viram "atual": senao clicar na miniatura 3 e logo em "Excluir" excluiria
   *  a pagina por onde a rolagem estava passando. */
  private destino: { i: number; ate: number } | null = null;

  private aoRolar(): void {
    const meio = this.el.scrollTop + this.el.clientHeight / 3;
    const i = this.paginaEm(meio);
    if (this.destino) {
      if (Date.now() < this.destino.ate && i !== this.destino.i) return;
      this.destino = null;
    }
    if (i !== this.paginaAtual) {
      this.paginaAtual = i;
      this.aoMudarPagina(i);
    }
  }

  irPara(i: number, suave = true): void {
    const p = this.paginas[i];
    if (!p) return;
    this.destino = { i, ate: Date.now() + 1200 };
    this.el.scrollTo({ top: p.div.offsetTop - 12, behavior: suave ? "smooth" : "auto" });
    this.paginaAtual = i;
    this.aoMudarPagina(i);
  }

  /** Rola para deixar um retangulo (espaco pagina) visivel. */
  mostrarRetangulo(i: number, r: Retangulo): void {
    const p = this.paginas[i];
    if (!p) return;
    const t = retanguloPaginaParaTela(p.info, r, this.escalaCss);
    const topo = p.div.offsetTop + t[1], esq = p.div.offsetLeft + t[0];
    const vis = this.el;
    if (topo < vis.scrollTop + 40 || topo + (t[3] - t[1]) > vis.scrollTop + vis.clientHeight - 40) {
      vis.scrollTo({ top: topo - vis.clientHeight / 3, behavior: "smooth" });
    }
    if (esq < vis.scrollLeft || esq + (t[2] - t[0]) > vis.scrollLeft + vis.clientWidth) {
      vis.scrollTo({ left: esq - 40, behavior: "smooth" });
    }
    this.destino = { i, ate: Date.now() + 1200 };
    this.paginaAtual = i;
    this.aoMudarPagina(i);
  }

  /** Coordenadas de um evento -> (pagina, ponto no espaco pagina, ponto CSS local). */
  pontoDoEvento(p: PaginaVisor, ev: { clientX: number; clientY: number }): { pagina: Ponto; local: Ponto } {
    const r = p.div.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    return { pagina: telaParaPagina(p.info, x, y, this.escalaCss), local: [x, y] };
  }

  paraTela(p: PaginaVisor, pt: Ponto): Ponto {
    return paginaParaTela(p.info, pt, this.escalaCss);
  }

  retanguloParaTela(p: PaginaVisor, r: Retangulo): Retangulo {
    return retanguloPaginaParaTela(p.info, r, this.escalaCss);
  }

  /** Pede nova renderizacao (depois de rolar, mudar zoom ou editar). */
  agendar(): void {
    if (this.agendado) return;
    this.agendado = requestAnimationFrame(() => {
      this.agendado = 0;
      this.proxima();
    });
  }

  private escalaDesejada(p: PaginaVisor): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let e = this.escalaCss * dpr;
    const px = p.info.largura * p.info.altura * e * e;
    if (px > MAX_PIXELS) e *= Math.sqrt(MAX_PIXELS / px);
    return e;
  }

  private precisa(p: PaginaVisor): boolean {
    if (!p.visivel || !this.estado) return false;
    const e = this.escalaDesejada(p);
    return !p.feito || p.feito.versao !== this.estado.versao || Math.abs(p.feito.escala - e) / e > 0.02;
  }

  private async proxima(): Promise<void> {
    if (this.renderizando || !this.estado) return;
    // Visiveis primeiro, da mais perto do centro para a mais longe.
    const centro = this.el.scrollTop + this.el.clientHeight / 2;
    const fila = this.paginas.filter((p) => this.precisa(p))
      .sort((a, b) => Math.abs(a.div.offsetTop + a.div.offsetHeight / 2 - centro)
        - Math.abs(b.div.offsetTop + b.div.offsetHeight / 2 - centro));
    const p = fila[0];
    if (!p) {
      this.liberar();
      return;
    }
    this.renderizando = true;
    const escala = this.escalaDesejada(p);
    try {
      const r = await this.motor.pedir<{ largura: number; altura: number; rgba: Uint8ClampedArray; versao: number }>(
        "render", { pagina: p.indice, escala });
      // A pagina pode ter sumido (excluida) enquanto desenhava.
      if (this.paginas[p.indice] === p) {
        p.canvas.width = r.largura;
        p.canvas.height = r.altura;
        p.canvas.getContext("2d")!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.largura, r.altura), 0, 0);
        p.feito = { escala, versao: r.versao };
      }
    } catch (e) {
      if (!/obsoleto|Nenhum documento/.test(String((e as Error).message))) console.warn(e);
      p.feito = { escala, versao: this.estado?.versao ?? -1 };
    } finally {
      this.renderizando = false;
    }
    this.agendar();
  }

  /** Solta os bitmaps das paginas mais longe da atual acima do limite. */
  private liberar(): void {
    const com = this.paginas.filter((p) => p.feito && p.canvas.width > 0);
    if (com.length <= MAX_EM_CACHE) return;
    com.sort((a, b) => Math.abs(b.indice - this.paginaAtual) - Math.abs(a.indice - this.paginaAtual));
    for (const p of com.slice(0, com.length - MAX_EM_CACHE)) {
      if (p.visivel) continue;
      p.canvas.width = p.canvas.height = 0;
      p.feito = null;
    }
  }

  limpar(): void {
    for (const p of this.paginas) this.observador.unobserve(p.div);
    this.paginas = [];
    this.conteudo.textContent = "";
    this.estado = null;
  }
}
