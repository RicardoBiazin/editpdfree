/*
 * Ferramentas de edicao sobre as paginas: selecionar/mover/excluir anotacao,
 * caixa de texto, nota, marcacoes, caneta, formas, assinatura, imagem, texto
 * novo, editar texto, tarja e os campos de formulario.
 *
 * Toda coordenada de evento vira espaco pagina por `Visor.pontoDoEvento`
 * (que usa coordenadas.ts). Os elementos sobre a pagina (selecao, campos,
 * realces de busca) sao posicionados em PORCENTAGEM da pagina: mudar o zoom
 * nao exige redesenha-los.
 */

import type { Motor } from "../rpc.ts";
import type { Visor, PaginaVisor } from "./visor.ts";
import type { InfoAnotacao, Estilo, TipoForma } from "../core/anotacoes.ts";
import type { Campo } from "../core/formularios.ts";
import type { Trecho } from "../core/texto.ts";
import type { Resultado } from "../core/seguranca.ts";
import { normalizar, type Ponto, type Retangulo } from "../core/coordenadas.ts";
import { avisar, campo, confirmar, dialogo, el, pedirTexto } from "./dialogos.ts";
import { dataUrlParaBytes, pedirAssinatura } from "./assinatura.ts";
import type { LinkPagina } from "../core/mais.ts";
import type { Sugestao } from "../core/criarcampos.ts";
import { CARIMBOS } from "../core/formatos.ts";

/** Escolher o texto do carimbo: um dos prontos ou um proprio. */
async function escolherCarimbo(atual: string): Promise<string | null> {
  const sel = el("select");
  for (const t of CARIMBOS) sel.append(el("option", { value: t, textContent: t, selected: t === atual }));
  sel.append(el("option", { value: "", textContent: "Outro texto…", selected: !(CARIMBOS as readonly string[]).includes(atual) }));
  const proprio = el("input", { type: "text", value: (CARIMBOS as readonly string[]).includes(atual) ? "" : atual, placeholder: "Ex.: ARQUIVADO" });
  const { valor } = await dialogo("Carimbo", [campo("Texto do carimbo", sel), campo("Outro texto", proprio,
    "Usa a cor escolhida na barra. O carimbo é uma anotação: dá para mover e excluir.")],
  [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Escolher", valor: "ok", primario: true }],
  () => sel.focus(), () => (!sel.value && !proprio.value.trim() ? "Escreva o texto do carimbo." : null));
  if (valor !== "ok") return null;
  return (sel.value || proprio.value).trim().toUpperCase();
}

export type NomeFerramenta = "selecionar" | "caixaTexto" | "nota" | "destacar" | "sublinhar" | "tachar"
  | "caneta" | "retangulo" | "elipse" | "linha" | "seta" | "assinatura" | "imagem" | "texto"
  | "editarTexto" | "tarjar" | "recortar" | "campoTexto" | "campoCaixa" | "carimbo";

export const FERRAMENTAS: { nome: NomeFerramenta; rotulo: string; icone: string; dica: string }[] = [
  { nome: "selecionar", rotulo: "Selecionar", icone: "selecionar", dica: "Selecionar, mover (arrastar) e excluir anotações (Delete); preencher formulários" },
  { nome: "caixaTexto", rotulo: "Caixa de texto", icone: "caixaTexto", dica: "Caixa de texto: clique ou arraste na página" },
  { nome: "nota", rotulo: "Nota", icone: "nota", dica: "Nota: clique onde a nota deve ficar" },
  { nome: "destacar", rotulo: "Destacar", icone: "destacar", dica: "Destacar: arraste sobre o texto" },
  { nome: "sublinhar", rotulo: "Sublinhar", icone: "sublinhar", dica: "Sublinhar: arraste sobre o texto" },
  { nome: "tachar", rotulo: "Tachar", icone: "tachar", dica: "Tachar: arraste sobre o texto" },
  { nome: "caneta", rotulo: "Caneta", icone: "caneta", dica: "Caneta: desenhe à mão livre" },
  { nome: "retangulo", rotulo: "Retângulo", icone: "retangulo", dica: "Retângulo: arraste" },
  { nome: "elipse", rotulo: "Elipse", icone: "elipse", dica: "Elipse: arraste" },
  { nome: "linha", rotulo: "Linha", icone: "linha", dica: "Linha: arraste" },
  { nome: "seta", rotulo: "Seta", icone: "seta", dica: "Seta: arraste do início para a ponta" },
  { nome: "assinatura", rotulo: "Assinatura", icone: "assinatura", dica: "Assinatura: desenhe e clique na página para posicionar" },
  { nome: "imagem", rotulo: "Imagem", icone: "imagem", dica: "Imagem: escolha o arquivo e clique ou arraste na página" },
  { nome: "texto", rotulo: "Adicionar texto", icone: "texto", dica: "Adicionar texto no conteúdo da página: clique onde o texto começa" },
  { nome: "editarTexto", rotulo: "Editar texto", icone: "editarTexto", dica: "Editar texto: clique numa linha de texto do PDF" },
  { nome: "tarjar", rotulo: "Tarjar", icone: "tarjar", dica: "Tarjar: arraste sobre a área — o conteúdo é removido de verdade" },
  { nome: "carimbo", rotulo: "Carimbo", icone: "carimbo", dica: "Carimbo (APROVADO, PAGO, CÓPIA…): escolha o texto e clique na página" },
  { nome: "recortar", rotulo: "Recortar", icone: "recortar", dica: "Recortar: arraste a área que deve ficar visível" },
  { nome: "campoTexto", rotulo: "Campo de texto", icone: "campoTexto", dica: "Criar campo de texto do formulário: arraste (ou clique)" },
  { nome: "campoCaixa", rotulo: "Caixa de seleção", icone: "campoCaixa", dica: "Criar caixa de seleção do formulário: clique ou arraste" },
];

const ARRASTAR = new Set<NomeFerramenta>(["destacar", "sublinhar", "tachar", "retangulo", "elipse", "linha",
  "seta", "tarjar", "caixaTexto", "imagem", "assinatura", "recortar", "campoTexto", "campoCaixa"]);

export interface Contexto {
  visor: Visor;
  motor: Motor;
  estilo(): Estilo;
  operar(tipo: string, args: unknown, transferir?: Transferable[]): Promise<unknown>;
  escolherImagem(): Promise<{ bytes: Uint8Array; nome: string } | null>;
  aoMudarFerramenta(nome: NomeFerramenta): void;
  irPara(pagina: number): void;
}

interface Selecao { pagina: number; id: number; info: InfoAnotacao }

/** Devolvido por `Contexto.operar` quando a operacao falhou (o aviso ja' foi
 *  mostrado). `undefined` e' retorno normal de operacao sem resultado. */
export const FALHOU = Symbol("falhou");

function pct(p: PaginaVisor, r: Retangulo): { left: string; top: string; width: string; height: string } {
  const [x0, y0] = [p.info.limites[0], p.info.limites[1]];
  return {
    left: `${((r[0] - x0) / p.info.largura) * 100}%`,
    top: `${((r[1] - y0) / p.info.altura) * 100}%`,
    width: `${((r[2] - r[0]) / p.info.largura) * 100}%`,
    height: `${((r[3] - r[1]) / p.info.altura) * 100}%`,
  };
}

function posicionar(e: HTMLElement, p: PaginaVisor, r: Retangulo): void {
  Object.assign(e.style, pct(p, r));
}

const SVG = "http://www.w3.org/2000/svg";

export class Ferramentas {
  private c: Contexto;
  atual: NomeFerramenta = "selecionar";
  private anotacoes = new Map<number, { versao: number; lista: InfoAnotacao[] }>();
  private campos = new Map<number, { versao: number; lista: Campo[] }>();
  selecao: Selecao | null = null;
  private assinaturaPng: string | null = null;
  private imagem: { bytes: Uint8Array; nome: string } | null = null;
  private busca: { resultados: Resultado[]; atual: number } = { resultados: [], atual: -1 };
  private links = new Map<number, { versao: number; lista: LinkPagina[] }>();
  private sugestoes: { s: Sugestao; ativa: boolean }[] = [];
  private barraSugestoes: HTMLElement | null = null;
  private carimboTexto = "APROVADO";

  constructor(c: Contexto) {
    this.c = c;
  }

  // ------------------------------------------------------------ estado

  async definir(nome: NomeFerramenta): Promise<void> {
    if (nome === "assinatura") {
      const png = await pedirAssinatura();
      if (!png) return;
      this.assinaturaPng = png;
    } else if (nome === "imagem") {
      const img = await this.c.escolherImagem();
      if (!img) return;
      this.imagem = img;
    } else if (nome === "carimbo") {
      const t = await escolherCarimbo(this.carimboTexto);
      if (!t) return;
      this.carimboTexto = t;
    }
    this.atual = nome;
    this.desselecionar();
    for (const p of this.c.visor.paginas) this.aplicarClasse(p);
    this.c.aoMudarFerramenta(nome);
  }

  private aplicarClasse(p: PaginaVisor): void {
    p.camada.dataset.ferramenta = this.atual;
    p.camada.classList.toggle("desenhando", this.atual !== "selecionar");
  }

  /** Liga os eventos numa pagina recem-criada. */
  instalar(p: PaginaVisor): void {
    this.aplicarClasse(p);
    p.camada.addEventListener("pointerdown", (ev) => this.aoApertar(p, ev));
    this.desenharBusca(p);
    this.desenharSugestoes(p);
  }

  /** Pagina ficou visivel ou o documento mudou: atualiza anotacoes e campos. */
  async mostrar(p: PaginaVisor): Promise<void> {
    const v = this.c.visor.estado?.versao ?? -1;
    const i = p.indice;
    const tarefas: Promise<void>[] = [];
    if (this.anotacoes.get(i)?.versao !== v) {
      tarefas.push(this.c.motor.pedir<InfoAnotacao[]>("anotacoes", { pagina: i }).then((lista) => {
        this.anotacoes.set(i, { versao: v, lista });
      }).catch(() => undefined));
    }
    if (this.campos.get(i)?.versao !== v) {
      tarefas.push(this.c.motor.pedir<Campo[]>("campos", { pagina: i }).then((lista) => {
        this.campos.set(i, { versao: v, lista });
        if (this.c.visor.paginas[i] === p) this.desenharCampos(p);
      }).catch(() => undefined));
    }
    if (this.links.get(i)?.versao !== v) {
      tarefas.push(this.c.motor.pedir<LinkPagina[]>("links", { pagina: i }).then((lista) => {
        this.links.set(i, { versao: v, lista });
        if (this.c.visor.paginas[i] === p) this.desenharLinks(p);
      }).catch(() => undefined));
    }
    await Promise.all(tarefas);
    this.desenharBusca(p);
    this.desenharSugestoes(p);
  }

  // ------------------------------------------------------------ links

  private desenharLinks(p: PaginaVisor): void {
    for (const e of p.extras.querySelectorAll(".link-pdf")) e.remove();
    for (const l of this.links.get(p.indice)?.lista ?? []) {
      const a = el("a", { classe: "link-pdf", href: l.externo ? l.uri : "#",
        title: l.externo ? `Link: ${l.uri}` : `Ir para a página ${(l.destino ?? 0) + 1}` });
      a.setAttribute("rel", "noopener noreferrer");
      posicionar(a, p, l.rect);
      a.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      a.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!l.externo) {
          if (l.destino !== null) this.c.irPara(l.destino);
          return;
        }
        // Sair do app e' decisao do usuario: o link vem do PDF.
        if (await confirmar("Abrir link externo", `O PDF aponta para ${l.uri}. Abrir numa nova aba?`, "Abrir")) {
          window.open(l.uri, "_blank", "noopener,noreferrer");
        }
      });
      p.extras.append(a);
    }
  }

  // ------------------------------------------------------------ sugestoes de campos

  mostrarSugestoes(lista: Sugestao[]): void {
    this.descartarSugestoes();
    if (!lista.length) return;
    this.sugestoes = lista.map((s) => ({ s, ativa: true }));
    const cont = el("span");
    const criar = el("button", { classe: "primario", type: "button" });
    const descartar = el("button", { type: "button", textContent: "Descartar" });
    const atualizar = () => {
      const n = this.sugestoes.filter((x) => x.ativa).length;
      cont.textContent = `${this.sugestoes.length} campo(s) sugerido(s). Clique numa sugestão para desmarcá-la.`;
      criar.textContent = `Criar ${n} campo(s)`;
      criar.disabled = n === 0;
    };
    this.atualizarBarra = atualizar;
    criar.addEventListener("click", async () => {
      const escolhidos = this.sugestoes.filter((x) => x.ativa).map((x) => x.s);
      this.descartarSugestoes();
      const r = await this.c.operar("criarCampos", { campos: escolhidos });
      if (r !== FALHOU) avisar(`${escolhidos.length} campo(s) criado(s). Use Selecionar para preenchê-los.`, "ok");
    });
    descartar.addEventListener("click", () => this.descartarSugestoes());
    this.barraSugestoes = el("div", { classe: "barra-sugestoes", role: "status" } as Partial<HTMLDivElement>, cont, criar, descartar);
    document.body.append(this.barraSugestoes);
    atualizar();
    for (const p of this.c.visor.paginas) this.desenharSugestoes(p);
    const primeira = lista[0];
    this.c.visor.mostrarRetangulo(primeira.pagina, primeira.rect);
  }

  private atualizarBarra: () => void = () => undefined;

  descartarSugestoes(): void {
    this.sugestoes = [];
    this.barraSugestoes?.remove();
    this.barraSugestoes = null;
    for (const e of document.querySelectorAll(".sugestao-campo")) e.remove();
  }

  private desenharSugestoes(p: PaginaVisor): void {
    for (const e of p.extras.querySelectorAll(".sugestao-campo")) e.remove();
    for (const item of this.sugestoes) {
      if (item.s.pagina !== p.indice) continue;
      const b = el("button", { classe: `sugestao-campo ${item.s.tipo}${item.ativa ? " ativa" : ""}`, type: "button",
        title: `${item.s.tipo === "texto" ? "Campo de texto" : "Caixa de seleção"} (${item.s.motivo}) — clique para ${item.ativa ? "desmarcar" : "marcar"}` });
      posicionar(b, p, item.s.rect);
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        item.ativa = !item.ativa;
        this.desenharSugestoes(p);
        this.atualizarBarra();
      });
      p.extras.append(b);
    }
  }

  /** Documento mudou de estrutura (paginas novas/removidas): esquece caches. */
  esquecer(): void {
    this.anotacoes.clear();
    this.campos.clear();
    this.links.clear();
    this.descartarSugestoes();
    this.selecao = null;
  }

  // ------------------------------------------------------------ busca

  mostrarBusca(resultados: Resultado[], atual: number): void {
    this.busca = { resultados, atual };
    for (const p of this.c.visor.paginas) this.desenharBusca(p);
  }

  private desenharBusca(p: PaginaVisor): void {
    p.realces.textContent = "";
    this.busca.resultados.forEach((r, k) => {
      if (r.pagina !== p.indice) return;
      const d = el("div", { classe: k === this.busca.atual ? "realce atual" : "realce" });
      posicionar(d, p, r.rect);
      p.realces.append(d);
    });
  }

  // ------------------------------------------------------------ campos

  private desenharCampos(p: PaginaVisor): void {
    for (const e of p.extras.querySelectorAll(".campo-form")) e.remove();
    const lista = this.campos.get(p.indice)?.lista ?? [];
    for (const cp of lista) {
      if (!["texto", "caixa", "opcao", "lista", "combo"].includes(cp.tipo)) continue;
      const z = el("button", { classe: `campo-form ${cp.tipo}${cp.somenteLeitura ? " so-leitura" : ""}`, type: "button" });
      z.title = (cp.nome ? cp.nome + ": " : "") + (cp.somenteLeitura ? "somente leitura" : "clique para preencher");
      z.setAttribute("aria-label", z.title);
      posicionar(z, p, cp.limites);
      z.addEventListener("pointerdown", (ev) => {
        if (this.atual !== "selecionar") return;
        ev.stopPropagation();
      });
      z.addEventListener("click", (ev) => {
        if (this.atual !== "selecionar" || cp.somenteLeitura) return;
        ev.stopPropagation();
        this.editarCampo(p, cp, z);
      });
      p.extras.append(z);
    }
  }

  private async editarCampo(p: PaginaVisor, cp: Campo, zona: HTMLElement): Promise<void> {
    if (cp.tipo === "caixa" || cp.tipo === "opcao") {
      await this.c.operar("preencherCampo", { pagina: p.indice, id: cp.id, valor: !cp.marcado });
      return;
    }
    // Editor posicionado sobre o campo.
    let editor: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (cp.tipo === "texto") {
      editor = cp.multilinha ? el("textarea", { value: cp.valor }) : el("input", { type: "text", value: cp.valor });
    } else {
      const s = el("select");
      for (const o of cp.opcoes) s.append(el("option", { value: o, textContent: o, selected: o === cp.valor }));
      editor = s;
    }
    editor.className = "editor-campo";
    editor.setAttribute("aria-label", cp.nome || "Campo do formulário");
    posicionar(editor, p, cp.limites);
    zona.hidden = true;
    p.extras.append(editor);
    editor.focus();
    let feito = false;
    const concluir = async (gravar: boolean) => {
      if (feito) return;
      feito = true;
      const valor = editor.value;
      editor.remove();
      zona.hidden = false;
      if (gravar && valor !== cp.valor) {
        await this.c.operar("preencherCampo", { pagina: p.indice, id: cp.id, valor });
      }
    };
    editor.addEventListener("blur", () => concluir(true));
    editor.addEventListener("change", () => { if (editor instanceof HTMLSelectElement) concluir(true); });
    editor.addEventListener("keydown", (ev) => {
      const k = ev as KeyboardEvent;
      k.stopPropagation();
      if (k.key === "Escape") concluir(false);
      else if (k.key === "Enter" && !(editor instanceof HTMLTextAreaElement && !k.ctrlKey)) {
        k.preventDefault();
        concluir(true);
      }
    });
  }

  // ------------------------------------------------------------ selecao

  desselecionar(): void {
    this.selecao = null;
    for (const e of document.querySelectorAll(".selecao-anot")) e.remove();
  }

  private selecionar(p: PaginaVisor, a: InfoAnotacao): void {
    this.desselecionar();
    this.selecao = { pagina: p.indice, id: a.id, info: a };
    const caixa = el("div", { classe: "selecao-anot" + (a.movel ? " movel" : "") });
    posicionar(caixa, p, a.limites);
    const bt = el("button", { classe: "selecao-excluir", type: "button", textContent: "Excluir", title: "Excluir anotação (Delete)" });
    bt.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    bt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.excluirSelecionada();
    });
    const rotulo = el("span", { classe: "selecao-rotulo", textContent: a.nome });
    caixa.append(rotulo, bt);
    // Arrastar a caixa move a anotacao (no toque, a caixa tem touch-action:none).
    caixa.addEventListener("pointerdown", (ev) => {
      if (!a.movel) return;
      ev.stopPropagation();
      ev.preventDefault();
      this.arrastarSelecao(p, a, caixa, ev);
    });
    p.extras.append(caixa);
  }

  async excluirSelecionada(): Promise<boolean> {
    const s = this.selecao;
    if (!s) return false;
    this.desselecionar();
    await this.c.operar("excluirAnotacao", { pagina: s.pagina, id: s.id });
    return true;
  }

  private arrastarSelecao(p: PaginaVisor, a: InfoAnotacao, caixa: HTMLElement, ev0: PointerEvent): void {
    const inicio = this.c.visor.pontoDoEvento(p, ev0).pagina;
    let d: Ponto = [0, 0];
    caixa.setPointerCapture(ev0.pointerId);
    caixa.classList.add("movendo");
    const mover = (ev: PointerEvent) => {
      const agora = this.c.visor.pontoDoEvento(p, ev).pagina;
      d = [agora[0] - inicio[0], agora[1] - inicio[1]];
      const r = a.limites;
      posicionar(caixa, p, [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]]);
    };
    const soltar = async () => {
      caixa.removeEventListener("pointermove", mover);
      caixa.removeEventListener("pointerup", soltar);
      caixa.removeEventListener("pointercancel", soltar);
      caixa.classList.remove("movendo");
      if (Math.hypot(d[0], d[1]) < 0.8) return;
      const s = this.selecao;
      const r = await this.c.operar("moverAnotacao", { pagina: p.indice, id: a.id, dx: d[0], dy: d[1] });
      if (r !== FALHOU && s) {
        // Mantem selecionada na posicao nova.
        const lim = a.limites;
        a.limites = [lim[0] + d[0], lim[1] + d[1], lim[2] + d[0], lim[3] + d[1]];
        this.selecionar(p, a);
      } else {
        posicionar(caixa, p, a.limites);
      }
    };
    caixa.addEventListener("pointermove", mover);
    caixa.addEventListener("pointerup", soltar);
    caixa.addEventListener("pointercancel", soltar);
  }

  // ------------------------------------------------------------ gestos

  private aoApertar(p: PaginaVisor, ev: PointerEvent): void {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    const pt = this.c.visor.pontoDoEvento(p, ev);
    const f = this.atual;
    if (f === "selecionar") {
      const lista = this.anotacoes.get(p.indice)?.lista ?? [];
      let achada: InfoAnotacao | null = null;
      const folga = 4 / this.c.visor.escalaCss;
      for (const a of lista) {
        const r = a.limites;
        if (pt.pagina[0] >= r[0] - folga && pt.pagina[0] <= r[2] + folga
          && pt.pagina[1] >= r[1] - folga && pt.pagina[1] <= r[3] + folga) achada = a;
      }
      if (achada) {
        this.selecionar(p, achada);
        // Com mouse, ja' permite arrastar direto.
        if (ev.pointerType === "mouse" && achada.movel) {
          const caixa = p.extras.querySelector(".selecao-anot") as HTMLElement;
          ev.preventDefault();
          this.arrastarSelecao(p, achada, caixa, ev);
        }
      } else {
        this.desselecionar();
      }
      return;
    }
    ev.preventDefault();
    p.camada.setPointerCapture(ev.pointerId);
    if (f === "caneta") {
      this.gestoCaneta(p, ev);
      return;
    }
    if (f === "nota" || f === "texto" || f === "editarTexto" || f === "carimbo") {
      const soltar = () => {
        p.camada.removeEventListener("pointerup", soltar);
        this.clique(p, pt.pagina);
      };
      p.camada.addEventListener("pointerup", soltar);
      return;
    }
    if (ARRASTAR.has(f)) this.gestoArrastar(p, pt.pagina, pt.local);
  }

  private gestoArrastar(p: PaginaVisor, inicio: Ponto, local0: Ponto): void {
    const f = this.atual;
    const svg = p.desenho;
    svg.textContent = "";
    const linha = f === "linha" || f === "seta";
    const forma = document.createElementNS(SVG, linha ? "line" : f === "elipse" ? "ellipse" : "rect");
    forma.setAttribute("class", `previa previa-${f}`);
    const cor = this.corCss();
    if (!["tarjar", "destacar", "sublinhar", "tachar", "caixaTexto", "imagem", "assinatura"].includes(f)) {
      forma.setAttribute("stroke", cor);
      forma.setAttribute("stroke-width", String(Math.max(1, this.c.estilo().espessura * this.c.visor.escalaCss)));
    }
    svg.append(forma);
    let fim = inicio, localFim = local0;
    const atualizar = () => {
      const [x0, y0] = local0, [x1, y1] = localFim;
      if (linha) {
        forma.setAttribute("x1", String(x0)); forma.setAttribute("y1", String(y0));
        forma.setAttribute("x2", String(x1)); forma.setAttribute("y2", String(y1));
      } else if (f === "elipse") {
        forma.setAttribute("cx", String((x0 + x1) / 2)); forma.setAttribute("cy", String((y0 + y1) / 2));
        forma.setAttribute("rx", String(Math.abs(x1 - x0) / 2)); forma.setAttribute("ry", String(Math.abs(y1 - y0) / 2));
      } else {
        forma.setAttribute("x", String(Math.min(x0, x1))); forma.setAttribute("y", String(Math.min(y0, y1)));
        forma.setAttribute("width", String(Math.abs(x1 - x0))); forma.setAttribute("height", String(Math.abs(y1 - y0)));
      }
    };
    const mover = (ev: PointerEvent) => {
      const pt = this.c.visor.pontoDoEvento(p, ev);
      fim = pt.pagina;
      localFim = pt.local;
      atualizar();
    };
    const soltar = () => {
      p.camada.removeEventListener("pointermove", mover);
      p.camada.removeEventListener("pointerup", soltar);
      p.camada.removeEventListener("pointercancel", cancelar);
      svg.textContent = "";
      const arrastou = Math.hypot(localFim[0] - local0[0], localFim[1] - local0[1]) > 4;
      this.concluirArrasto(p, f, inicio, fim, arrastou);
    };
    const cancelar = () => {
      p.camada.removeEventListener("pointermove", mover);
      p.camada.removeEventListener("pointerup", soltar);
      p.camada.removeEventListener("pointercancel", cancelar);
      svg.textContent = "";
    };
    p.camada.addEventListener("pointermove", mover);
    p.camada.addEventListener("pointerup", soltar);
    p.camada.addEventListener("pointercancel", cancelar);
  }

  private async concluirArrasto(p: PaginaVisor, f: NomeFerramenta, a: Ponto, b: Ponto, arrastou: boolean): Promise<void> {
    const estilo = this.c.estilo();
    const i = p.indice;
    const rect = normalizar([a[0], a[1], b[0], b[1]]);
    switch (f) {
      case "destacar": case "sublinhar": case "tachar": {
        if (!arrastou) return;
        const r = await this.c.operar("marcar", { pagina: i, rect, tipo: f, estilo });
        if (r === false) avisar("Nenhum texto nessa área. Arraste sobre as palavras.");
        return;
      }
      case "retangulo": case "elipse": case "linha": case "seta":
        if (!arrastou) return;
        await this.c.operar("forma", { pagina: i, tipo: f as TipoForma, inicio: a, fim: b, estilo });
        return;
      case "tarjar": {
        if (!arrastou) return;
        const r = await this.c.operar("tarjar", { areas: [{ pagina: i, rect }] });
        if (typeof r === "number" && r > 0) avisar("Área tarjada: o conteúdo foi removido do arquivo (Ctrl+Z desfaz).", "ok");
        return;
      }
      case "caixaTexto": {
        const t = await pedirTexto("Caixa de texto", "Texto", { multilinha: true, ok: "Inserir",
          dica: "Ctrl+Enter insere." });
        if (!t) return;
        const r: Retangulo = arrastou ? rect : [a[0], a[1], a[0] + 10, a[1] + 10];
        await this.c.operar("textoLivre", { pagina: i, rect: r, texto: t, estilo });
        return;
      }
      case "imagem": case "assinatura": {
        const bytes = f === "imagem" ? this.imagem?.bytes : this.assinaturaPng ? dataUrlParaBytes(this.assinaturaPng) : null;
        if (!bytes) return;
        let r: Retangulo = rect;
        if (!arrastou) {
          // Clique: largura padrao (assinatura 170 pt, imagem 220 pt), centrada no clique.
          const w = f === "assinatura" ? 170 : 220;
          r = [a[0] - w / 2, a[1] - w / 2, a[0] + w / 2, a[1] + w / 2];
          const dims = await this.dimensoes(bytes);
          if (dims) {
            const h = w * dims[1] / dims[0];
            r = [a[0] - w / 2, a[1] - h / 2, a[0] + w / 2, a[1] + h / 2];
          }
        }
        const copia = bytes.slice();
        await this.c.operar("inserirImagem", { pagina: i, rect: r, bytes: copia.buffer,
          descricao: f === "assinatura" ? "Assinatura" : "Inserir imagem" }, [copia.buffer]);
        if (f === "assinatura") void this.definir("selecionar");
        return;
      }
      case "recortar": {
        if (!arrastou) return;
        const total = this.c.visor.estado?.paginas.length ?? 1;
        let quais: number[] = [i];
        if (total > 1) {
          const { valor } = await dialogo("Recortar", el("p", { textContent: "A área arrastada fica visível; o resto da página é escondido (CropBox). Aplicar em quais páginas?" }),
            [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Todas as páginas", valor: "todas" }, { rotulo: "Só esta página", valor: "esta", primario: true }]);
          if (valor === null || valor === "c") return;
          if (valor === "todas") quais = [...Array(total).keys()];
        }
        await this.c.operar("recortarRetangulo", { indices: quais, rect });
        return;
      }
      case "campoTexto": case "campoCaixa": {
        let r: Retangulo = rect;
        if (!arrastou) {
          r = f === "campoTexto" ? [a[0], a[1] - 10, a[0] + 180, a[1] + 10] : [a[0] - 7, a[1] - 7, a[0] + 7, a[1] + 7];
        }
        const res = await this.c.operar("criarCampos", { campos: [{ pagina: i, tipo: f === "campoTexto" ? "texto" : "caixa", rect: r }] });
        if (res !== FALHOU) avisar("Campo criado. Use Selecionar para preenchê-lo.", "ok");
        return;
      }
      default:
        return;
    }
  }

  private async dimensoes(bytes: Uint8Array): Promise<[number, number] | null> {
    try {
      const b = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      const d: [number, number] = [b.width, b.height];
      b.close();
      return d;
    } catch {
      return null;
    }
  }

  private gestoCaneta(p: PaginaVisor, ev0: PointerEvent): void {
    const svg = p.desenho;
    svg.textContent = "";
    const caminho = document.createElementNS(SVG, "polyline");
    caminho.setAttribute("class", "previa previa-caneta");
    caminho.setAttribute("stroke", this.corCss());
    caminho.setAttribute("stroke-width", String(Math.max(1, this.c.estilo().espessura * this.c.visor.escalaCss)));
    caminho.setAttribute("opacity", String(this.c.estilo().opacidade));
    svg.append(caminho);
    const pontos: Ponto[] = [];
    const locais: string[] = [];
    const add = (ev: PointerEvent) => {
      const pt = this.c.visor.pontoDoEvento(p, ev);
      pontos.push(pt.pagina);
      locais.push(`${pt.local[0]},${pt.local[1]}`);
      caminho.setAttribute("points", locais.join(" "));
    };
    add(ev0);
    const mover = (ev: PointerEvent) => {
      const eventos = ev.getCoalescedEvents?.() ?? [ev];
      for (const e of eventos.length ? eventos : [ev]) add(e);
    };
    const soltar = async () => {
      p.camada.removeEventListener("pointermove", mover);
      p.camada.removeEventListener("pointerup", soltar);
      p.camada.removeEventListener("pointercancel", soltar);
      if (pontos.length > 1) {
        await this.c.operar("caneta", { pagina: p.indice, tracos: [simplificar(pontos, 0.35)], estilo: this.c.estilo() });
      }
      svg.textContent = "";
    };
    p.camada.addEventListener("pointermove", mover);
    p.camada.addEventListener("pointerup", soltar);
    p.camada.addEventListener("pointercancel", soltar);
  }

  private async clique(p: PaginaVisor, pt: Ponto): Promise<void> {
    const i = p.indice;
    const estilo = this.c.estilo();
    if (this.atual === "nota") {
      const t = await pedirTexto("Nota", "Texto da nota", { multilinha: true, ok: "Inserir", dica: "Ctrl+Enter insere." });
      if (t) await this.c.operar("nota", { pagina: i, ponto: pt, texto: t, estilo });
    } else if (this.atual === "texto") {
      await this.dialogoTexto(i, pt);
    } else if (this.atual === "carimbo") {
      await this.c.operar("carimbo", { pagina: i, centro: pt, texto: this.carimboTexto, cor: estilo.cor });
    } else if (this.atual === "editarTexto") {
      const t = await this.c.motor.pedir<Trecho | null>("trechoEm", { pagina: i, ponto: pt }).catch(() => null);
      if (!t) {
        avisar("Nenhuma linha de texto aqui. Clique sobre o texto que quer editar.");
        return;
      }
      if (!t.horizontal) {
        avisar("Só é possível editar texto horizontal.", "erro");
        return;
      }
      await this.dialogoEditar(p, t);
    }
  }

  private async dialogoTexto(pagina: number, pt: Ponto): Promise<void> {
    const estilo = this.c.estilo();
    const texto = el("textarea", { name: "texto", rows: 3 });
    const fonte = el("select", { name: "fonte" });
    for (const [v, r] of [["Helvetica", "Helvetica (sem serifa)"], ["Times-Roman", "Times (serifada)"],
      ["Courier", "Courier (monoespaçada)"], ["Helvetica-Bold", "Helvetica negrito"], ["Times-Bold", "Times negrito"]]) {
      fonte.append(el("option", { value: v, textContent: r }));
    }
    const tamanho = el("input", { type: "number", min: "4", max: "144", value: String(estilo.tamanhoFonte) });
    const { valor } = await dialogo("Adicionar texto", [
      campo("Texto", texto, "Entra no conteúdo da página, com a cor escolhida na barra. Letras fora do Latin-1 viram “?”."),
      el("div", { classe: "linha-campos" }, campo("Fonte", fonte), campo("Tamanho", tamanho)),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Adicionar", valor: "ok", primario: true }],
    () => texto.focus(), () => (!texto.value.trim() ? "Digite o texto." : null));
    if (valor !== "ok") return;
    const t = Number(tamanho.value) || 12;
    // O clique marca o topo do texto; a linha de base fica ~0,8 em abaixo.
    await this.c.operar("inserirTexto", { pagina, origem: [pt[0], pt[1] + t * 0.8], texto: texto.value,
      opcoes: { tamanho: t, cor: estilo.cor, fonte: fonte.value } });
  }

  private async dialogoEditar(p: PaginaVisor, t: Trecho): Promise<void> {
    const caixa = el("div", { classe: "selecao-trecho" });
    posicionar(caixa, p, t.rect);
    p.extras.append(caixa);
    const texto = el("input", { type: "text", value: t.texto });
    const tamanho = el("input", { type: "number", min: "4", max: "144", step: "0.5", value: String(Math.round(t.tamanho * 10) / 10) });
    const hex = "#" + t.cor.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    const cor = el("input", { type: "color", value: hex });
    const familia = { helv: "Helvetica", times: "Times", courier: "Courier" }[t.familia];
    const { valor } = await dialogo("Editar texto", [
      campo("Texto da linha", texto),
      el("div", { classe: "linha-campos" }, campo("Tamanho", tamanho), campo("Cor", cor)),
      el("p", { classe: "dica", textContent: `Fonte original: ${t.fonte}. O texto novo usa ${familia}${t.negrito ? " negrito" : ""}${t.italico ? " itálico" : ""} (a fonte embutida no PDF quase nunca tem todas as letras).` }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Substituir", valor: "ok", primario: true }],
    () => { texto.focus(); texto.select(); });
    caixa.remove();
    if (valor !== "ok") return;
    const c = cor.value;
    const rgb = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);
    await this.c.operar("substituirTrecho", { trecho: t, novo: texto.value,
      opcoes: { tamanho: Number(tamanho.value) || t.tamanho, cor: rgb } });
  }

  private corCss(): string {
    const [r, g, b] = this.c.estilo().cor;
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }
}

/** Reduz pontos quase colineares (Ramer-Douglas-Peucker), em pontos PDF. */
export function simplificar(pts: Ponto[], tol: number): Ponto[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maior = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    // Traco fechado (inicio = fim): distancia ao ponto inicial.
    const d = Math.hypot(dx, dy) < 1e-9 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1])
      : Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > maior) { maior = d; idx = i; }
  }
  if (maior <= tol) return [a, b];
  return [...simplificar(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplificar(pts.slice(idx), tol)];
}
