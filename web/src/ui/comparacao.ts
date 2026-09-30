/*
 * Tela de comparacao: os dois documentos lado a lado, com o que saiu em
 * vermelho (em A) e o que entrou em verde (em B), e a lista clicavel das
 * diferencas. As paginas sao desenhadas so' quando aparecem (como no visor).
 */

import type { Motor, InfoPagina } from "../rpc.ts";
import { rotulo, type Diferenca } from "../core/comparar.ts";
import { el } from "./dialogos.ts";
import { icone } from "./icones.ts";

interface Dados { paginasA: InfoPagina[]; paginasB: InfoPagina[]; diferencas: Diferenca[]; nomeA: string }

export async function mostrarComparacao(motor: Motor, dados: Dados, nomeB: string): Promise<void> {
  const fundo = el("div", { classe: "comparacao", role: "dialog" } as Partial<HTMLDivElement>);
  fundo.setAttribute("aria-modal", "true");
  fundo.setAttribute("aria-label", "Comparação de documentos");
  const fechar = el("button", { classe: "bt", type: "button", title: "Fechar a comparação (Esc)" });
  fechar.innerHTML = icone("fechar");
  fechar.setAttribute("aria-label", "Fechar a comparação");
  const n = dados.diferencas.length;
  const topo = el("div", { classe: "comparacao-topo" },
    el("strong", { textContent: "Comparação" }),
    el("span", { classe: "comparacao-nomes", textContent: `A: ${dados.nomeA}  ×  B: ${nomeB}` }),
    el("span", { classe: "comparacao-total", textContent: n ? `${n} diferença(s)` : "Nenhuma diferença no texto" }),
    el("span", { classe: "legenda" }, el("i", { classe: "removido" }), " removido em A ", el("i", { classe: "inserido" }), " inserido em B"),
    fechar);
  const lista = el("ol", { classe: "comparacao-lista" });
  const painelA = el("div", { classe: "comparacao-painel" });
  const painelB = el("div", { classe: "comparacao-painel" });
  const colA = el("section", { classe: "comparacao-coluna" }, el("h3", { textContent: `A — ${dados.nomeA}` }), painelA);
  const colB = el("section", { classe: "comparacao-coluna" }, el("h3", { textContent: `B — ${nomeB}` }), painelB);
  fundo.append(topo, el("div", { classe: "comparacao-corpo" }, lista, colA, colB));
  document.body.append(fundo);
  document.body.classList.add("com-comparacao");

  type Pg = { div: HTMLDivElement; canvas: HTMLCanvasElement; info: InfoPagina; feito: boolean; visivel: boolean; lado: "a" | "b"; i: number };
  const pags: Pg[] = [];
  let ocupado = false;
  const larguraPainel = () => Math.max(120, painelA.clientWidth - 24);
  const desenharProxima = async () => {
    if (ocupado) return;
    const p = pags.find((x) => x.visivel && !x.feito);
    if (!p) return;
    ocupado = true;
    const escala = (larguraPainel() / p.info.largura) * Math.min(window.devicePixelRatio || 1, 2);
    try {
      const r = await motor.pedir<{ largura: number; altura: number; rgba: Uint8ClampedArray }>("renderComparacao",
        { lado: p.lado, pagina: p.i, escala });
      p.canvas.width = r.largura;
      p.canvas.height = r.altura;
      p.canvas.getContext("2d")!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.largura, r.altura), 0, 0);
    } catch { /* comparacao fechada */ }
    p.feito = true;
    ocupado = false;
    void desenharProxima();
  };
  const obs = new IntersectionObserver((es) => {
    for (const e of es) {
      const p = pags.find((x) => x.div === e.target);
      if (p) p.visivel = e.isIntersecting;
    }
    void desenharProxima();
  }, { rootMargin: "50% 0px" });

  const montar = (painel: HTMLElement, infos: InfoPagina[], lado: "a" | "b") => {
    infos.forEach((info, i) => {
      const div = el("div", { classe: "comparacao-pagina" });
      const canvas = el("canvas");
      div.append(canvas, el("span", { classe: "comparacao-num", textContent: String(i + 1) }));
      div.style.aspectRatio = `${info.largura} / ${info.altura}`;
      painel.append(div);
      const p: Pg = { div, canvas, info, feito: false, visivel: false, lado, i };
      pags.push(p);
      obs.observe(div);
    });
  };
  montar(painelA, dados.paginasA, "a");
  montar(painelB, dados.paginasB, "b");

  // Realces: posicionados em % da pagina.
  const marcas: HTMLElement[][] = dados.diferencas.map(() => []);
  const marcar = (lado: "a" | "b", infos: InfoPagina[], painel: HTMLElement) => {
    const divs = [...painel.querySelectorAll<HTMLDivElement>(".comparacao-pagina")];
    dados.diferencas.forEach((d, k) => {
      for (const loc of lado === "a" ? d.emA : d.emB) {
        const info = infos[loc.pagina], div = divs[loc.pagina];
        if (!info || !div) continue;
        const [x0, y0] = [info.limites[0], info.limites[1]];
        const m = el("button", { classe: `marca-dif ${lado === "a" ? "removido" : "inserido"}`, type: "button", title: rotulo(d) });
        Object.assign(m.style, {
          left: `${((loc.rect[0] - x0) / info.largura) * 100}%`, top: `${((loc.rect[1] - y0) / info.altura) * 100}%`,
          width: `${((loc.rect[2] - loc.rect[0]) / info.largura) * 100}%`, height: `${((loc.rect[3] - loc.rect[1]) / info.altura) * 100}%`,
        });
        m.addEventListener("click", () => ir(k));
        div.append(m);
        marcas[k].push(m);
      }
    });
  };
  marcar("a", dados.paginasA, painelA);
  marcar("b", dados.paginasB, painelB);

  const itens: HTMLButtonElement[] = [];
  let atual = -1;
  const ir = (k: number) => {
    if (atual >= 0) {
      itens[atual]?.classList.remove("atual");
      for (const m of marcas[atual]) m.classList.remove("atual");
    }
    atual = k;
    itens[k]?.classList.add("atual");
    itens[k]?.scrollIntoView({ block: "nearest" });
    for (const m of marcas[k]) m.classList.add("atual");
    const d = dados.diferencas[k];
    const rolar = (painel: HTMLElement, lado: "a" | "b") => {
      const alvo = marcas[k].find((m) => m.classList.contains(lado === "a" ? "removido" : "inserido"));
      if (alvo) {
        const pag = alvo.parentElement as HTMLElement;
        painel.scrollTo({ top: pag.offsetTop + alvo.offsetTop - painel.clientHeight / 3, behavior: "smooth" });
      } else {
        // Sem marca deste lado (so' inserido ou so' removido): vai para a pagina correspondente.
        const outra = lado === "a" ? d.emB[0] : d.emA[0];
        const divs = painel.querySelectorAll<HTMLElement>(".comparacao-pagina");
        const pagina = divs[Math.min(outra?.pagina ?? 0, divs.length - 1)];
        if (pagina) painel.scrollTo({ top: pagina.offsetTop - 8, behavior: "smooth" });
      }
    };
    rolar(painelA, "a");
    rolar(painelB, "b");
  };
  dados.diferencas.forEach((d, k) => {
    const b = el("button", { classe: `item-dif ${d.tipo}`, type: "button" });
    const pagA = d.emA[0]?.pagina, pagB = d.emB[0]?.pagina;
    b.append(el("span", { classe: "item-texto", textContent: rotulo(d) }),
      el("small", { textContent: `${pagA !== undefined ? `A p. ${pagA + 1}` : ""}${pagA !== undefined && pagB !== undefined ? " · " : ""}${pagB !== undefined ? `B p. ${pagB + 1}` : ""}` }));
    b.addEventListener("click", () => ir(k));
    itens.push(b);
    lista.append(el("li", {}, b));
  });
  if (!n) lista.append(el("li", { classe: "vazio", textContent: "Os dois documentos têm o mesmo texto." }));

  await new Promise<void>((resolver) => {
    const sair = () => {
      obs.disconnect();
      fundo.remove();
      document.body.classList.remove("com-comparacao");
      document.removeEventListener("keydown", tecla, true);
      void motor.pedir("compararFechar").catch(() => undefined);
      resolver();
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !document.querySelector("dialog[open]")) {
        ev.preventDefault();
        ev.stopPropagation();
        sair();
      } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && n && !(ev.target as HTMLElement).closest("input")) {
        ev.preventDefault();
        ir(Math.max(0, Math.min(n - 1, atual + (ev.key === "ArrowDown" ? 1 : -1))));
      }
    };
    document.addEventListener("keydown", tecla, true);
    fechar.addEventListener("click", sair);
    fechar.focus();
    if (n) setTimeout(() => ir(0), 300);
  });
}
