/*
 * "Juntar PDFs": escolher varios arquivos, pôr na ordem e juntar num PDF.
 *
 * Cada item mostra a miniatura da primeira pagina (feita no worker), o nome,
 * o numero de paginas e o tamanho, e aceita um intervalo de paginas proprio.
 * Ordem: arrastar (mouse; no toque, segurar e arrastar), botoes ↑/↓,
 * Alt+↑/↓ no teclado, ordenar por nome (ordem natural) ou por data, inverter.
 * PDF com senha pede a senha no proprio item, sem travar os outros.
 */

import type { Motor } from "../rpc.ts";
import { compararNomes, lerIntervalos } from "../core/intervalos.ts";
import type { InfoArquivo } from "../core/juntar.ts";
import { el } from "./dialogos.ts";
import { icone } from "./icones.ts";

export const ACEITOS = "application/pdf,.pdf,image/*,.docx,.xlsx,.pptx,.txt,.md,.html,.htm,.xhtml,.epub,.xps,.oxps,.fb2,.cbz,.svg";

interface Item {
  id: number;
  nome: string;
  tipo: string;
  tamanho: number;
  data: number;
  obter: () => Promise<ArrayBuffer>;
  estado: "carregando" | "ok" | "senha" | "erro";
  paginas: number;
  miniatura: string | null;
  senha?: string;
  senhaErrada?: boolean;
  erro?: string;
  intervalo: string;
  erroIntervalo?: string;
  aberto?: boolean;
}

export interface ResultadoJuntar { bytes: Uint8Array; abrir: boolean }

function tamanhoLegivel(b: number): string {
  if (b < 1024) return `${b} bytes`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;
}

let proximoId = 1;

export async function juntarPdfs(motor: Motor, aberto?: { nome: string; bytes: Uint8Array }): Promise<ResultadoJuntar | null> {
  const itens: Item[] = [];
  const d = el("dialog", { classe: "dialogo juntar" });
  d.setAttribute("aria-label", "Juntar PDFs");
  const entrada = el("input", { type: "file", multiple: true, accept: ACEITOS, classe: "oculto" });
  const btAdicionar = el("button", { type: "button", classe: "primario", textContent: "Adicionar arquivos…" });
  const btNome = el("button", { type: "button", textContent: "Ordenar por nome" });
  const btData = el("button", { type: "button", textContent: "Ordenar por data" });
  const btInverter = el("button", { type: "button", textContent: "Inverter ordem" });
  const lista = el("ol", { classe: "juntar-lista" });
  lista.setAttribute("aria-label", "Arquivos, na ordem em que serão juntados");
  const vazio = el("p", { classe: "juntar-vazio", textContent: "Adicione arquivos ou arraste-os para cá: PDF, imagens e documentos (Word, Excel, PowerPoint, HTML, EPUB, TXT)." });
  const marcadores = el("input", { type: "checkbox", checked: true });
  const resumo = el("span", { classe: "juntar-resumo" });
  const aviso = el("p", { classe: "dialogo-erro", role: "alert" } as Partial<HTMLParagraphElement>);
  const btCancelar = el("button", { type: "button", textContent: "Cancelar" });
  const btBaixar = el("button", { type: "button", textContent: "Baixar direto" });
  const btJuntar = el("button", { type: "button", classe: "primario", textContent: "Juntar e abrir" });
  d.append(el("div", { classe: "juntar-caixa" },
    el("h2", { textContent: "Juntar PDFs" }),
    el("div", { classe: "linha-botoes juntar-ferramentas" }, btAdicionar, btNome, btData, btInverter, entrada),
    el("p", { classe: "dica", textContent: "Arraste os itens para mudar a ordem (no toque: segure e arraste), ou use ↑/↓ e Alt+↑/↓." }),
    vazio, lista,
    el("label", { classe: "campo-check" }, marcadores, " Criar um marcador (sumário) para cada arquivo"),
    aviso,
    el("div", { classe: "dialogo-botoes" }, resumo, btCancelar, btBaixar, btJuntar)));
  document.body.append(d);

  // ---------------------------------------------------------------- itens

  const carregar = async (it: Item) => {
    it.estado = "carregando";
    desenhar();
    try {
      const bytes = await it.obter();
      const info = await motor.pedir<InfoArquivo>("juntarInfo", { bytes, nome: it.nome, tipo: it.tipo, senha: it.senha }, [bytes]);
      if (info.precisaSenha) {
        it.estado = "senha";
        it.senhaErrada = info.senhaErrada;
      } else if (info.erro) {
        it.estado = "erro";
        it.erro = info.erro;
      } else {
        it.estado = "ok";
        it.paginas = info.paginas;
        if (it.miniatura) URL.revokeObjectURL(it.miniatura);
        it.miniatura = info.miniatura ? URL.createObjectURL(new Blob([info.miniatura as Uint8Array<ArrayBuffer>], { type: "image/png" })) : null;
        validarIntervalo(it);
      }
    } catch (e) {
      it.estado = "erro";
      it.erro = (e as Error).message;
    }
    desenhar();
  };

  const adicionar = (arquivos: File[]) => {
    for (const f of arquivos) {
      const it: Item = { id: proximoId++, nome: f.name, tipo: f.type, tamanho: f.size, data: f.lastModified,
        obter: () => f.arrayBuffer(), estado: "carregando", paginas: 0, miniatura: null, intervalo: "" };
      itens.push(it);
      void carregar(it);
    }
    desenhar();
  };

  const validarIntervalo = (it: Item) => {
    it.erroIntervalo = undefined;
    if (it.estado !== "ok" || !it.intervalo.trim()) return;
    try {
      lerIntervalos(it.intervalo, it.paginas);
    } catch (e) {
      it.erroIntervalo = (e as Error).message;
    }
  };

  const paginasDoItem = (it: Item) => {
    if (it.estado !== "ok") return 0;
    if (!it.intervalo.trim() || it.erroIntervalo) return it.paginas;
    return lerIntervalos(it.intervalo, it.paginas).flat().length;
  };

  const mover = (de: number, para: number) => {
    if (para < 0 || para >= itens.length || de === para) return;
    const [it] = itens.splice(de, 1);
    itens.splice(para, 0, it);
    desenhar();
  };

  // ---------------------------------------------------------------- desenho

  const atualizarRodape = () => {
    const pendentes = itens.filter((i) => i.estado !== "ok" || i.erroIntervalo);
    const total = itens.reduce((n, i) => n + paginasDoItem(i), 0);
    resumo.textContent = itens.length ? `${itens.length} arquivo(s) · ${total} página(s)` : "";
    const carregando = itens.some((i) => i.estado === "carregando");
    const podeJuntar = itens.length > 0 && !pendentes.length && total > 0;
    btJuntar.disabled = btBaixar.disabled = !podeJuntar;
    aviso.textContent = carregando ? "" : pendentes.length
      ? "Resolva os itens marcados (senha, erro ou intervalo inválido) ou remova-os para juntar." : "";
    vazio.hidden = itens.length > 0;
  };

  const desenhar = () => {
    const foco = (document.activeElement as HTMLElement | null)?.closest?.("li")?.dataset.id;
    lista.textContent = "";
    itens.forEach((it, i) => {
      const li = el("li", { classe: `juntar-item ${it.estado}` });
      li.dataset.id = String(it.id);
      li.tabIndex = 0;
      li.setAttribute("aria-label", `${i + 1}. ${it.nome}`);
      const pega = el("span", { classe: "juntar-pega", title: "Arraste para mudar a ordem" });
      pega.innerHTML = icone("menu");
      const mini = it.miniatura ? el("img", { src: it.miniatura, alt: "" }) : el("span", { classe: "juntar-sem-mini" });
      const meta = it.estado === "ok" ? `${it.paginas} página(s) · ${tamanhoLegivel(it.tamanho)}`
        : it.estado === "carregando" ? "Lendo…" : it.estado === "senha" ? (it.senhaErrada ? "Senha incorreta" : "Protegido por senha")
          : `Erro: ${it.erro}`;
      const info = el("div", { classe: "juntar-info" },
        el("strong", { textContent: `${i + 1}. ${it.nome}` }),
        it.aberto ? el("small", { textContent: "Documento aberto, com as alterações ainda não salvas" }) : null,
        el("small", { classe: it.estado === "erro" || it.estado === "senha" ? "juntar-erro" : "", textContent: meta }));
      if (it.estado === "senha") {
        const senha = el("input", { type: "password", placeholder: "Senha", autocomplete: "off" });
        const bt = el("button", { type: "button", textContent: "Desbloquear" });
        const desbloquear = () => {
          it.senha = senha.value;
          void carregar(it);
        };
        bt.addEventListener("click", desbloquear);
        senha.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); desbloquear(); }
        });
        info.append(el("div", { classe: "juntar-senha" }, senha, bt));
      }
      if (it.estado === "ok") {
        const intervalo = el("input", { type: "text", value: it.intervalo, placeholder: "todas", classe: "juntar-intervalo" });
        intervalo.setAttribute("aria-label", `Páginas de ${it.nome} (vazio = todas)`);
        const erro = el("small", { classe: "juntar-erro", textContent: it.erroIntervalo ?? "" });
        intervalo.addEventListener("input", () => {
          it.intervalo = intervalo.value;
          validarIntervalo(it);
          erro.textContent = it.erroIntervalo ?? "";
          intervalo.classList.toggle("invalido", !!it.erroIntervalo);
          atualizarRodape();
        });
        intervalo.classList.toggle("invalido", !!it.erroIntervalo);
        info.append(el("label", { classe: "juntar-rotulo-intervalo" }, "Páginas: ", intervalo), erro);
      }
      const acoes = el("div", { classe: "juntar-acoes" });
      for (const [nomeIc, titulo, fn, desativado] of [
        ["acima", "Subir", () => mover(i, i - 1), i === 0],
        ["abaixo", "Descer", () => mover(i, i + 1), i === itens.length - 1],
        ["fechar", "Remover da lista", () => {
          if (it.miniatura) URL.revokeObjectURL(it.miniatura);
          itens.splice(i, 1);
          desenhar();
        }, false],
      ] as const) {
        const b = el("button", { type: "button", title: titulo, disabled: desativado, classe: "bt" });
        b.setAttribute("aria-label", `${titulo}: ${it.nome}`);
        b.innerHTML = icone(nomeIc);
        b.addEventListener("click", fn);
        acoes.append(b);
      }
      li.append(pega, mini, info, acoes);
      li.addEventListener("keydown", (ev) => {
        if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
        ev.preventDefault();
        const para = i + (ev.key === "ArrowUp" ? -1 : 1);
        mover(i, para);
        (lista.querySelector(`li[data-id="${it.id}"]`) as HTMLElement | null)?.focus();
      });
      lista.append(li);
    });
    if (foco) (lista.querySelector(`li[data-id="${foco}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    atualizarRodape();
  };

  // ---------------------------------------------------------------- arrastar para reordenar

  let arrasto: { id: number; x: number; y: number; ponteiro: number; toque: boolean } | null = null;
  let arrastando = false;
  let timer = 0;
  const posicaoEm = (y: number) => {
    const lis = [...lista.children] as HTMLElement[];
    for (let k = 0; k < lis.length; k++) {
      const r = lis[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return lis.length;
  };
  const marcar = (pos: number) => {
    const lis = [...lista.children] as HTMLElement[];
    lis.forEach((li, k) => {
      li.classList.toggle("inserir-antes", k === pos);
      li.classList.toggle("inserir-depois", pos === lis.length && k === lis.length - 1);
    });
  };
  const cancelar = () => {
    clearTimeout(timer);
    arrasto = null;
    arrastando = false;
    lista.classList.remove("arrastando");
    marcar(-1);
  };
  lista.addEventListener("pointerdown", (ev) => {
    const alvo = ev.target as HTMLElement;
    const li = alvo.closest("li") as HTMLElement | null;
    if (!li || ev.button !== 0 || alvo.closest("input, button")) return;
    arrasto = { id: Number(li.dataset.id), x: ev.clientX, y: ev.clientY, ponteiro: ev.pointerId, toque: ev.pointerType !== "mouse" };
    if (arrasto.toque) {
      timer = window.setTimeout(() => {
        if (!arrasto) return;
        arrastando = true;
        lista.classList.add("arrastando");
        try { lista.setPointerCapture(arrasto.ponteiro); } catch { /* sem captura */ }
      }, 320);
    }
  });
  lista.addEventListener("pointermove", (ev) => {
    if (!arrasto || ev.pointerId !== arrasto.ponteiro) return;
    const dist = Math.hypot(ev.clientX - arrasto.x, ev.clientY - arrasto.y);
    if (!arrastando) {
      if (arrasto.toque) {
        if (dist > 10) cancelar();
        return;
      }
      if (dist < 6) return;
      arrastando = true;
      lista.classList.add("arrastando");
      lista.setPointerCapture(ev.pointerId);
    }
    ev.preventDefault();
    marcar(posicaoEm(ev.clientY));
    const caixa = lista.getBoundingClientRect();
    if (ev.clientY < caixa.top + 24) lista.scrollBy(0, -10);
    else if (ev.clientY > caixa.bottom - 24) lista.scrollBy(0, 10);
  });
  lista.addEventListener("pointerup", (ev) => {
    if (!arrasto || ev.pointerId !== arrasto.ponteiro) return;
    if (arrastando) {
      const de = itens.findIndex((i) => i.id === arrasto!.id);
      let para = posicaoEm(ev.clientY);
      if (para > de) para--;
      cancelar();
      mover(de, para);
      return;
    }
    cancelar();
  });
  lista.addEventListener("pointercancel", cancelar);
  lista.addEventListener("touchmove", (ev) => { if (arrastando) ev.preventDefault(); }, { passive: false });

  // ---------------------------------------------------------------- botoes e soltar arquivos

  btAdicionar.addEventListener("click", () => {
    entrada.value = "";
    entrada.click();
  });
  entrada.addEventListener("change", () => adicionar([...(entrada.files ?? [])]));
  btNome.addEventListener("click", () => {
    itens.sort((a, b) => compararNomes(a.nome, b.nome));
    desenhar();
  });
  btData.addEventListener("click", () => {
    itens.sort((a, b) => a.data - b.data);
    desenhar();
  });
  btInverter.addEventListener("click", () => {
    itens.reverse();
    desenhar();
  });
  d.addEventListener("dragover", (ev) => {
    if (!ev.dataTransfer?.types.includes("Files")) return;
    ev.preventDefault();
    ev.stopPropagation();
    d.classList.add("soltando");
  });
  d.addEventListener("dragleave", (ev) => {
    if (ev.target === d) d.classList.remove("soltando");
  });
  d.addEventListener("drop", (ev) => {
    if (!ev.dataTransfer?.files.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    d.classList.remove("soltando");
    adicionar([...ev.dataTransfer.files]);
  });

  if (aberto) {
    const copia = aberto.bytes;
    const it: Item = { id: proximoId++, nome: aberto.nome, tipo: "application/pdf", tamanho: copia.length, data: Date.now(),
      obter: async () => copia.slice().buffer, estado: "carregando", paginas: 0, miniatura: null, intervalo: "", aberto: true };
    itens.push(it);
    void carregar(it);
  }

  desenhar();
  d.showModal();
  if (!aberto) btAdicionar.focus();

  return new Promise((resolver) => {
    let feito = false;
    const fechar = (r: ResultadoJuntar | null) => {
      if (feito) return;
      feito = true;
      for (const it of itens) if (it.miniatura) URL.revokeObjectURL(it.miniatura);
      d.close();
      d.remove();
      resolver(r);
    };
    const juntar = async (abrir: boolean) => {
      btJuntar.disabled = btBaixar.disabled = true;
      aviso.textContent = "";
      resumo.textContent = "Juntando…";
      try {
        const partes = await Promise.all(itens.map(async (it) => ({
          bytes: await it.obter(), nome: it.nome, tipo: it.tipo, senha: it.senha, intervalo: it.intervalo,
        })));
        const bytes = await motor.pedir<Uint8Array>("juntarArquivos", { itens: partes, opcoes: { marcadores: marcadores.checked } },
          partes.map((p) => p.bytes));
        fechar({ bytes, abrir });
      } catch (e) {
        aviso.textContent = (e as Error).message;
        atualizarRodape();
      }
    };
    btJuntar.addEventListener("click", () => void juntar(true));
    btBaixar.addEventListener("click", () => void juntar(false));
    btCancelar.addEventListener("click", () => fechar(null));
    d.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      fechar(null);
    });
  });
}
