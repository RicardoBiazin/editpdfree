/*
 * EditPDFree para navegador: a interface.
 *
 * Todo o trabalho com o PDF acontece no worker (MuPDF.js/WASM), no proprio
 * navegador. Nada e' enviado para lugar nenhum.
 */

import "./style.css";
import { Motor, ErroWorker, type Estado } from "./rpc.ts";
import { Visor } from "./ui/visor.ts";
import { Miniaturas } from "./ui/miniaturas.ts";
import { FALHOU, FERRAMENTAS, Ferramentas, type NomeFerramenta } from "./ui/ferramentas.ts";
import { avisar, campo, confirmar, dialogo, el, pedirTexto } from "./ui/dialogos.ts";
import { icone } from "./ui/icones.ts";
import type { Estilo } from "./core/anotacoes.ts";
import type { Resultado } from "./core/seguranca.ts";
import { gruposACada, lerIntervalos, nomeBase } from "./core/intervalos.ts";
import { CAMPOS_METADADOS, NIVEIS_COMPRESSAO, POSICOES, type Posicao } from "./core/formatos.ts";
import type { Sugestao } from "./core/criarcampos.ts";
import type { Diferenca } from "./core/comparar.ts";
import type { InfoPagina } from "./rpc.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Icones nos botoes marcados com data-icone.
for (const e of document.querySelectorAll<HTMLElement>("[data-icone]")) {
  e.insertAdjacentHTML("afterbegin", icone(e.dataset.icone!));
}

const motor = new Motor();
const visor = new Visor($("visor"), $("paginas"), motor);
const minis = new Miniaturas($("miniaturas"), motor);
let estado: Estado | null = null;
let operando = 0;

// ---------------------------------------------------------------- estilo

const inCor = $<HTMLInputElement>("inCor");
const inEspessura = $<HTMLInputElement>("inEspessura");
const inOpacidade = $<HTMLInputElement>("inOpacidade");
const inFonte = $<HTMLInputElement>("inFonte");

function estilo(): Estilo {
  const c = inCor.value;
  return {
    cor: [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255) as [number, number, number],
    espessura: Number(inEspessura.value) || 2,
    opacidade: (Number(inOpacidade.value) || 100) / 100,
    tamanhoFonte: Math.max(4, Math.min(144, Number(inFonte.value) || 12)),
  };
}

// Lembra o estilo entre visitas (conveniencia; sem armazenamento, tudo bem).
try {
  const salvo = JSON.parse(localStorage.getItem("editpdfree.estilo") ?? "null");
  if (salvo) {
    inCor.value = salvo.cor ?? inCor.value;
    inEspessura.value = salvo.espessura ?? inEspessura.value;
    inOpacidade.value = salvo.opacidade ?? inOpacidade.value;
    inFonte.value = salvo.fonte ?? inFonte.value;
  }
} catch { /* sem armazenamento */ }
for (const i of [inCor, inEspessura, inOpacidade, inFonte]) {
  i.addEventListener("change", () => {
    try {
      localStorage.setItem("editpdfree.estilo", JSON.stringify({
        cor: inCor.value, espessura: inEspessura.value, opacidade: inOpacidade.value, fonte: inFonte.value,
      }));
    } catch { /* sem armazenamento */ }
  });
}

// ---------------------------------------------------------------- operacoes

function mostrarOcupado(): void {
  $("ocupado").hidden = operando === 0;
  document.body.classList.toggle("trabalhando", operando > 0);
}

async function operar(tipo: string, args: unknown = {}, transferir: Transferable[] = []): Promise<unknown> {
  operando++;
  const t = setTimeout(mostrarOcupado, 250);
  try {
    const { r, estado: novo } = await motor.operar(tipo, args, transferir);
    aplicarEstado(novo);
    return r;
  } catch (e) {
    avisar((e as Error).message || "Não foi possível concluir a operação.", "erro");
    return FALHOU;
  } finally {
    clearTimeout(t);
    operando--;
    mostrarOcupado();
  }
}

const ferramentas = new Ferramentas({
  visor, motor, estilo, operar,
  escolherImagem: () => escolherArquivo($<HTMLInputElement>("arquivoImagem")).then(async (f) =>
    f ? { bytes: new Uint8Array(await f.arrayBuffer()), nome: f.name } : null),
  aoMudarFerramenta: (nome) => {
    for (const b of document.querySelectorAll<HTMLButtonElement>(".bt-ferramenta")) {
      const ativo = b.dataset.ferramenta === nome;
      b.classList.toggle("ativo", ativo);
      b.setAttribute("aria-pressed", String(ativo));
    }
  },
  irPara: (i) => visor.irPara(i),
});

visor.aoConstruirPagina = (p) => ferramentas.instalar(p);
visor.aoMostrarPagina = (p) => void ferramentas.mostrar(p);
visor.aoMudarPagina = (i) => {
  $<HTMLInputElement>("inPagina").value = String(i + 1);
  minis.marcarAtual(i);
};
visor.aoMudarZoom = (z) => {
  $("btZoom").textContent = `${Math.round(z * 100)}%`;
};
minis.aoIrPara = (i) => {
  visor.irPara(i);
  // Em tela estreita a lateral fica por cima do documento: fecha ao escolher.
  if (window.innerWidth < 760) {
    document.body.classList.add("sem-lateral");
    $("lateral").hidden = true;
  }
};
minis.aoReordenar = (ordem) => void operar("reordenar", { ordem });
minis.aoSoltarArquivos = (arquivos, pos) => void inserirArquivos(arquivos, pos);

function aplicarEstado(novo: Estado): void {
  const antes = estado;
  estado = novo;
  const aberto = novo.aberto;
  document.body.classList.toggle("com-documento", aberto);
  $("boasVindas").hidden = aberto;
  $("ferramentas").hidden = !aberto;
  $("lateral").hidden = !aberto || document.body.classList.contains("sem-lateral");
  for (const id of ["btSalvar", "btZoomMenos", "btZoom", "btZoomMais", "btLargura", "inPagina", "btBuscar", "btLateral"]) {
    ($(id) as HTMLButtonElement).disabled = !aberto;
  }
  for (const m of document.querySelectorAll<HTMLDetailsElement>("details.menu:not([data-sempre])")) {
    m.classList.toggle("desativado", !aberto);
  }
  const bd = $<HTMLButtonElement>("btDesfazer"), br = $<HTMLButtonElement>("btRefazer");
  bd.disabled = !novo.podeDesfazer;
  br.disabled = !novo.podeRefazer;
  bd.title = novo.podeDesfazer ? `Desfazer: ${novo.podeDesfazer} (Ctrl+Z)` : "Desfazer (Ctrl+Z)";
  br.title = novo.podeRefazer ? `Refazer: ${novo.podeRefazer} (Ctrl+Y)` : "Refazer (Ctrl+Y)";
  $("totalPaginas").textContent = `/ ${novo.paginas.length}`;
  document.title = aberto ? `${novo.modificado ? "• " : ""}${novo.nome} — EditPDFree` : "EditPDFree — editor de PDF gratuito";
  $("btSalvar").classList.toggle("pendente", novo.modificado);
  if (!antes || antes.paginas.length !== novo.paginas.length || antes.nome !== novo.nome) {
    ferramentas.esquecer();
    limparBusca();
  }
  if (aberto && (!antes || antes.versao !== novo.versao || antes.nome !== novo.nome)) void atualizarMarcadores();
  if (aberto) {
    visor.aplicar(novo);
    minis.aplicar(novo);
    minis.marcarAtual(visor.paginaAtual);
    $<HTMLInputElement>("inPagina").value = String(visor.paginaAtual + 1);
  } else {
    visor.limpar();
    minis.limpar();
  }
}

// ---------------------------------------------------------------- abrir / salvar

function escolherArquivo(input: HTMLInputElement): Promise<File | null> {
  return new Promise((resolver) => {
    input.value = "";
    const ao = () => {
      input.removeEventListener("change", ao);
      resolver(input.files?.[0] ?? null);
    };
    input.addEventListener("change", ao);
    input.click();
  });
}

async function abrirArquivo(f: File, criadoPeloApp = false): Promise<void> {
  if (estado?.modificado && !(await confirmar("Abrir outro arquivo",
    `As alterações em “${estado.nome}” ainda não foram salvas e serão perdidas.`, "Abrir mesmo assim", true))) return;
  let senha: string | undefined;
  let tentativa = 0;
  operando++;
  mostrarOcupado();
  try {
    await motor.pronto;
    for (;;) {
      const bytes = await f.arrayBuffer();
      try {
        const novo = await motor.pedir<Estado>("abrir", { bytes, nome: f.name, tipo: f.type, senha, novo: criadoPeloApp }, [bytes]);
        visor.zoom = 1;
        visor.paginaAtual = 0;
        minis.limparSelecao();
        aplicarEstado(novo);
        const larg = visor.zoomLargura();
        visor.definirZoom(window.innerWidth < 800 ? larg : Math.min(1.25, larg));
        visor.irPara(0, false);
        ferramentas.definir("selecionar");
        if (novo.reparado) {
          avisar(`O arquivo estava danificado e foi reparado ao abrir (${novo.paginas.length} página(s)). Salve para gravar a versão reparada.`, "info", 9000);
        }
        return;
      } catch (e) {
        if (e instanceof ErroWorker && e.nomeOriginal === "SenhaNecessaria") {
          tentativa++;
          const s = await pedirTexto("PDF protegido",
            e.errada ? "Senha incorreta. Tente de novo:" : `“${f.name}” é protegido por senha. Digite a senha para abrir:`,
            { senha: true, ok: "Abrir" });
          if (s === null) return;
          senha = s;
          if (tentativa > 20) return;
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    avisar((e as Error).message || "Não foi possível abrir o arquivo.", "erro");
  } finally {
    operando--;
    mostrarOcupado();
  }
}

function baixar(bytes: Uint8Array | ArrayBuffer, nome: string, tipo = "application/pdf"): void {
  const blob = new Blob([bytes as BlobPart], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function salvar(): Promise<void> {
  if (!estado?.aberto) return;
  if (estado.assinado && !(await confirmar("Documento assinado digitalmente",
    "Este PDF tem assinatura digital. Salvar com alterações invalida a assinatura.", "Salvar mesmo assim", true))) return;
  operando++;
  mostrarOcupado();
  try {
    const { bytes, estado: novo } = await motor.pedir<{ bytes: Uint8Array; estado: Estado }>("salvar");
    baixar(bytes, estado.nome);
    aplicarEstado(novo);
    avisar(novo.protegido ? `“${novo.nome}” salvo (protegido por senha).` : `“${novo.nome}” salvo.`, "ok");
  } catch (e) {
    avisar((e as Error).message, "erro");
  } finally {
    operando--;
    mostrarOcupado();
  }
}

async function inserirArquivos(arquivos: File[], posicao: number): Promise<void> {
  let pos = posicao;
  for (const f of arquivos) {
    const bytes = await f.arrayBuffer();
    const n = await operar("inserirArquivo", { bytes, nome: f.name, tipo: f.type, posicao: pos }, [bytes]);
    if (n === FALHOU) return;
    pos += Number(n);
    avisar(`${f.name}: ${n} página(s) inserida(s).`, "ok");
  }
}

// ---------------------------------------------------------------- paginas

function alvo(): number[] {
  return minis.alvo();
}

function descreverPaginas(l: number[]): string {
  if (l.length === 1) return `a página ${l[0] + 1}`;
  return `${l.length} páginas`;
}

const acoes: Record<string, () => unknown> = {
  girarE: () => operar("girar", { indices: alvo(), graus: -90 }),
  girarD: () => operar("girar", { indices: alvo(), graus: 90 }),
  duplicar: () => operar("duplicar", { indice: alvo()[0] }),
  excluir: async () => {
    const l = alvo();
    if (await confirmar("Excluir páginas", `Excluir ${descreverPaginas(l)}? (Ctrl+Z desfaz)`, "Excluir", true)) {
      minis.limparSelecao();
      await operar("excluir", { indices: l });
    }
  },
  branco: () => operar("inserirEmBranco", { posicao: Math.max(...alvo()) + 1 }),
  inserirArquivo: async () => {
    const input = $<HTMLInputElement>("arquivoInserir");
    input.value = "";
    const arquivos = await new Promise<File[]>((r) => {
      const ao = () => { input.removeEventListener("change", ao); r([...(input.files ?? [])]); };
      input.addEventListener("change", ao);
      input.click();
    });
    if (arquivos.length) await inserirArquivos(arquivos, Math.max(...alvo()) + 1);
  },
  extrair: async () => {
    if (!estado) return;
    const sel = alvo().map((i) => i + 1);
    const inicial = sel.length > 1 ? sel.join(", ") : String(sel[0]);
    const t = await pedirTexto("Extrair páginas", "Páginas para o novo PDF",
      { inicial, ok: "Extrair", dica: "Exemplos: 1-3, 5, 8- (8 até o fim). Selecione miniaturas com Ctrl/Shift+clique." });
    if (!t) return;
    let grupos: number[][];
    try {
      grupos = lerIntervalos(t, estado.paginas.length);
    } catch (e) {
      avisar((e as Error).message, "erro");
      return;
    }
    const indices = grupos.flat();
    try {
      const b = await motor.pedir<Uint8Array>("extrair", { indices });
      baixar(b, `${nomeBase(estado.nome)}_paginas.pdf`);
    } catch (e) {
      avisar((e as Error).message, "erro");
    }
  },
  dividir: async () => {
    if (!estado) return;
    const modoN = el("input", { type: "radio", name: "modo", value: "n", checked: true });
    const modoI = el("input", { type: "radio", name: "modo", value: "i" });
    const n = el("input", { type: "number", min: "1", value: "1" });
    const intervalos = el("input", { type: "text", placeholder: "1-3, 5, 8-" });
    const zip = el("input", { type: "checkbox", checked: true });
    const total = estado.paginas.length;
    const { valor } = await dialogo("Dividir documento", [
      el("label", { classe: "campo-check" }, modoN, " A cada ", n, " página(s)"),
      el("label", { classe: "campo-check" }, modoI, " Por intervalos: ", intervalos),
      el("p", { classe: "dica", textContent: "Cada intervalo vira um arquivo. “8-” vai da 8 até o fim." }),
      el("label", { classe: "campo-check" }, zip, " Baixar tudo num arquivo .zip"),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Dividir", valor: "ok", primario: true }],
    (f) => {
      intervalos.addEventListener("focus", () => { modoI.checked = true; });
      n.addEventListener("focus", () => { modoN.checked = true; });
      void f;
      n.focus();
    },
    () => {
      try {
        if (modoN.checked) gruposACada(total, Number(n.value));
        else lerIntervalos(intervalos.value, total);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    if (valor !== "ok") return;
    const grupos = modoN.checked ? gruposACada(total, Number(n.value)) : lerIntervalos(intervalos.value, total);
    operando++;
    mostrarOcupado();
    try {
      const r = await motor.pedir<{ zip?: Uint8Array; partes?: { nome: string; bytes: Uint8Array }[] }>(
        "dividir", { grupos, zip: zip.checked });
      if (r.zip) baixar(r.zip, `${nomeBase(estado.nome)}_dividido.zip`, "application/zip");
      else for (const p of r.partes ?? []) baixar(p.bytes, p.nome);
      avisar(`Documento dividido em ${grupos.length} arquivo(s).`, "ok");
    } catch (e) {
      avisar((e as Error).message, "erro");
    } finally {
      operando--;
      mostrarOcupado();
    }
  },
  buscar: () => abrirBusca(),
  tarjarTexto: async () => {
    const t = await pedirTexto("Tarjar todas as ocorrências", "Texto a remover do documento inteiro",
      { ok: "Tarjar", dica: "Ex.: um CPF ou um nome. O texto é removido do arquivo, não só coberto. Ctrl+Z desfaz." });
    if (!t) return;
    const n = await operar("tarjarTexto", { termo: t });
    if (n === FALHOU) return;
    avisar(n ? `${n} ocorrência(s) tarjada(s).` : "Nenhuma ocorrência encontrada.", n ? "ok" : "info");
  },
  marcaDagua: async () => {
    const texto = el("input", { type: "text", value: "CONFIDENCIAL" });
    const tamanho = el("input", { type: "number", min: "8", max: "200", value: "60" });
    const opac = el("input", { type: "range", min: "5", max: "100", value: "30" });
    const diagonal = el("input", { type: "checkbox", checked: true });
    const { valor } = await dialogo("Marca d’água", [
      campo("Texto", texto),
      el("div", { classe: "linha-campos" }, campo("Tamanho", tamanho), campo("Opacidade", opac)),
      el("label", { classe: "campo-check" }, diagonal, " Na diagonal"),
      el("p", { classe: "dica", textContent: "Usa a cor escolhida na barra de ferramentas. Vai em todas as páginas." }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Aplicar", valor: "ok", primario: true }],
    () => { texto.focus(); texto.select(); }, () => (!texto.value.trim() ? "Digite o texto." : null));
    if (valor !== "ok") return;
    await operar("marcaDagua", { texto: texto.value, opcoes: {
      tamanho: Number(tamanho.value) || 60, opacidade: Number(opac.value) / 100, diagonal: diagonal.checked,
      cor: estilo().cor,
    } });
  },
  numerar: async () => {
    const formato = el("input", { type: "text", value: "{n} / {total}" });
    const posicao = el("select");
    for (const [k, v] of Object.entries(POSICOES)) posicao.append(el("option", { value: k, textContent: v }));
    const tamanho = el("input", { type: "number", min: "6", max: "48", value: "10" });
    const inicio = el("input", { type: "number", min: "0", value: "1" });
    const { valor } = await dialogo("Numerar páginas, cabeçalho e rodapé", [
      campo("Texto", formato, "{n} = número da página, {total} = total, {arquivo} = nome do arquivo, {data} = data de hoje. Ex.: Página {n} de {total}"),
      el("div", { classe: "linha-campos" }, campo("Posição", posicao), campo("Tamanho", tamanho), campo("Começar em", inicio)),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Numerar", valor: "ok", primario: true }],
    () => formato.focus(), () => (!formato.value.trim() ? "Digite o texto." : /\{(?!(n|total|arquivo|data)\})/.test(formato.value) ? "Use só {n}, {total}, {arquivo} e {data}." : null));
    if (valor !== "ok") return;
    await operar("numerar", { opcoes: {
      formato: formato.value, posicao: posicao.value as Posicao, tamanho: Number(tamanho.value) || 10,
      inicio: Number(inicio.value) || 1, cor: [0, 0, 0],
    } });
  },
  proteger: async () => {
    const s1 = el("input", { type: "password", autocomplete: "new-password" });
    const s2 = el("input", { type: "password", autocomplete: "new-password" });
    const dono = el("input", { type: "password", autocomplete: "new-password" });
    const { valor } = await dialogo("Proteger com senha", [
      campo("Senha para abrir", s1),
      campo("Repita a senha", s2),
      campo("Senha de proprietário (opcional)", dono, "Quem abrir com a senha de proprietário pode alterar o documento; com a de abrir, só ler, imprimir e copiar."),
      el("p", { classe: "dica", textContent: "Criptografia AES-256, aplicada ao salvar. Guarde a senha: sem ela, o arquivo não abre." }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Proteger", valor: "ok", primario: true }],
    () => s1.focus(), () => {
      if (!s1.value) return "Digite a senha.";
      if (s1.value !== s2.value) return "As senhas não conferem.";
      if (s1.value.includes(",") || dono.value.includes(",")) return "A senha não pode conter vírgula.";
      return null;
    });
    if (valor !== "ok") return;
    const r = await operar("proteger", { senhaAbrir: s1.value, senhaDono: dono.value || s1.value,
      permissoes: dono.value ? undefined : -1 });
    if (r !== FALHOU) avisar("A senha será aplicada quando você salvar.", "ok");
  },
  removerSenha: async () => {
    if (!estado?.protegido) {
      avisar("O documento não está protegido por senha.");
      return;
    }
    const r = await operar("removerProtecao");
    if (r !== FALHOU) avisar("A senha será removida quando você salvar.", "ok");
  },
  extrairTexto: async () => {
    if (!estado) return;
    try {
      const t = await motor.pedir<string>("extrairTexto");
      baixar(new TextEncoder().encode(t), `${nomeBase(estado.nome)}.txt`, "text/plain;charset=utf-8");
    } catch (e) {
      avisar((e as Error).message, "erro");
    }
  },
  sobre: () => sobre(),
  comprimir: async () => {
    if (!exigirDocumento()) return;
    // Tres opcoes, cada uma com o tamanho estimado (calculado no worker, numa
    // copia do documento, enquanto o dialogo ja' esta' aberto).
    const atual = el("p", { classe: "dica", textContent: "Calculando o tamanho de cada opção…" });
    const estimativas: Record<string, HTMLElement> = {};
    const opcoes = Object.entries(NIVEIS_COMPRESSAO).map(([k, v]) => {
      const radio = el("input", { type: "radio", name: "nivel", value: k, checked: k === "media" });
      estimativas[k] = el("strong", { classe: "estimativa", textContent: "…" });
      return el("label", { classe: "opcao-compressao" }, radio,
        el("span", {}, el("span", { classe: "opcao-titulo" }, `${v.rotulo} `, estimativas[k]),
          el("small", { textContent: `${v.descricao} Imagens a ${v.dpi} dpi, JPEG ${v.qualidade}%.` })));
    });
    const niveis = Object.entries(NIVEIS_COMPRESSAO).map(([chave, v]) => ({ chave, dpi: v.dpi, qualidade: v.qualidade }));
    motor.operar("estimarCompressao", { niveis }).then(({ r }) => {
      const t = r as Record<string, number>;
      atual.textContent = `Tamanho atual: ${tamanho(t.atual)}`;
      for (const [k, e] of Object.entries(estimativas)) {
        const pct = t.atual ? Math.round((1 - t[k] / t.atual) * 100) : 0;
        e.textContent = `≈ ${tamanho(t[k])}${pct > 0 ? ` (−${pct}%)` : " (sem ganho)"}`;
      }
    }).catch(() => { atual.textContent = "Não foi possível estimar os tamanhos."; });
    const { valor, form } = await dialogo("Comprimir PDF", [atual, ...opcoes,
      el("p", { classe: "dica", textContent: "A compressão atua sobretudo nas imagens: um PDF só de texto quase não diminui. Ctrl+Z desfaz." }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Comprimir", valor: "ok", primario: true }]);
    if (valor !== "ok") return;
    const escolhido = (form.querySelector("input[name=nivel]:checked") as HTMLInputElement | null)?.value ?? "media";
    const nivel = NIVEIS_COMPRESSAO[escolhido as keyof typeof NIVEIS_COMPRESSAO];
    const r = await operar("comprimir", { opcoes: { dpi: nivel.dpi, qualidade: nivel.qualidade } });
    if (r === FALHOU) return;
    const { antes, depois, imagens } = r as { antes: number; depois: number; imagens: number };
    const pct = antes ? Math.round((1 - depois / antes) * 100) : 0;
    await dialogo("Comprimir", [el("p", {}, el("strong", { textContent: `${tamanho(antes)} → ${tamanho(depois)}` }),
      pct > 0 ? ` (${pct}% menor)` : " (o arquivo já estava enxuto)"),
    el("p", { classe: "dica", textContent: `${imagens} imagem(ns) regravada(s). O tamanho vale para o próximo “Salvar”.` })],
    [{ rotulo: "OK", valor: "ok", primario: true }]);
  },
  reparar: async () => {
    const f = await escolherArquivo($<HTMLInputElement>("arquivoPdf"));
    if (!f) return;
    operando++;
    mostrarOcupado();
    try {
      const bytes = await f.arrayBuffer();
      const r = await motor.pedir<{ bytes: Uint8Array; paginas: number; paginasComErro: number; estavaDanificado: boolean }>(
        "reparar", { bytes }, [bytes]);
      const nome = `${nomeBase(f.name)}_reparado.pdf`;
      baixar(r.bytes, nome);
      await dialogo("Reparar PDF", [el("p", { textContent: r.estavaDanificado
        ? `O arquivo estava danificado. ${r.paginas - r.paginasComErro} de ${r.paginas} página(s) recuperada(s).`
        : `O arquivo não tinha danos na estrutura (${r.paginas} página(s)); foi regravado limpo.` }),
      el("p", { classe: "dica", textContent: `Baixado como “${nome}”.` })], [{ rotulo: "OK", valor: "ok", primario: true }]);
    } catch (e) {
      avisar((e as Error).message, "erro");
    } finally {
      operando--;
      mostrarOcupado();
    }
  },
  margens: async () => {
    if (!exigirDocumento()) return;
    const campos = ["cima", "direita", "baixo", "esquerda"] as const;
    const rotulos = { cima: "Em cima", direita: "À direita", baixo: "Embaixo", esquerda: "À esquerda" };
    const entradas = Object.fromEntries(campos.map((c) => [c, el("input", { type: "number", min: "0", step: "1", value: "10" })]));
    const todas = el("input", { type: "checkbox", checked: true });
    const { valor } = await dialogo("Recortar margens", [
      el("div", { classe: "linha-campos" }, ...campos.map((c) => campo(`${rotulos[c]} (mm)`, entradas[c]))),
      el("label", { classe: "campo-check" }, todas, " Em todas as páginas (senão, só na atual)"),
      el("p", { classe: "dica", textContent: "As margens valem como a página aparece na tela, mesmo girada. O conteúdo fora do recorte fica escondido (CropBox), não é apagado." }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Recortar", valor: "ok", primario: true }], () => entradas.cima.focus());
    if (valor !== "ok" || !estado) return;
    const margens = Object.fromEntries(campos.map((c) => [c, Number(entradas[c].value) || 0]));
    await operar("recortarMargens", { indices: todas.checked ? [...estado.paginas.keys()] : [visor.paginaAtual], margens });
  },
  exportarImagens: async () => {
    if (!exigirDocumento() || !estado) return;
    const formato = el("select");
    formato.append(el("option", { value: "png", textContent: "PNG (sem perda)" }), el("option", { value: "jpg", textContent: "JPG (menor)" }));
    const dpi = el("input", { type: "number", min: "24", max: "600", value: "150" });
    const quais = el("input", { type: "text", placeholder: "todas", value: "" });
    const total = estado.paginas.length;
    const { valor } = await dialogo("Exportar páginas como imagem", [
      el("div", { classe: "linha-campos" }, campo("Formato", formato), campo("Resolução (dpi)", dpi)),
      campo("Páginas", quais, "Vazio = todas. Ex.: 1-3, 5"),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Exportar", valor: "ok", primario: true }], () => dpi.focus(), () => {
      const n = Number(dpi.value);
      if (!(n >= 24 && n <= 600)) return "Escolha uma resolução entre 24 e 600 dpi.";
      try { if (quais.value.trim()) lerIntervalos(quais.value, total); } catch (e) { return (e as Error).message; }
      return null;
    });
    if (valor !== "ok") return;
    const indices = quais.value.trim() ? lerIntervalos(quais.value, total).flat() : undefined;
    await tarefa(async () => {
      const z = await motor.pedir<Uint8Array>("exportarImagens", { dpi: Number(dpi.value), formato: formato.value, indices });
      baixar(z, `${nomeBase(estado!.nome)}_imagens.zip`, "application/zip");
    });
  },
  imagensEmbutidas: () => tarefa(async () => {
    if (!exigirDocumento()) return;
    const r = await motor.pedir<{ zip: Uint8Array; quantas: number } | null>("imagensEmbutidas");
    if (!r) {
      avisar("Este PDF não tem imagens embutidas.");
      return;
    }
    baixar(r.zip, `${nomeBase(estado!.nome)}_imagens_embutidas.zip`, "application/zip");
    avisar(`${r.quantas} imagem(ns) extraída(s).`, "ok");
  }),
  docx: () => tarefa(async () => {
    if (!exigirDocumento()) return;
    const b = await motor.pedir<Uint8Array>("docx");
    baixar(b, `${nomeBase(estado!.nome)}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    avisar("Convertido para Word. Parágrafos, fontes e imagens vêm junto; tabelas e colunas não.", "ok", 7000);
  }),
  markdown: () => tarefa(async () => {
    if (!exigirDocumento()) return;
    const t = await motor.pedir<string>("markdown");
    baixar(new TextEncoder().encode(t), `${nomeBase(estado!.nome)}.md`, "text/markdown;charset=utf-8");
  }),
  comparar: () => compararDocumentos(),
  ocr: () => executarOcr(),
  detectarCampos: () => tarefa(async () => {
    if (!exigirDocumento()) return;
    const lista = await motor.pedir<Sugestao[]>("detectarCampos");
    if (!lista.length) {
      avisar("Nenhum campo sugerido: não achei sublinhados, rótulos com “:” seguidos de espaço nem quadradinhos vazios.", "info", 7000);
      return;
    }
    void ferramentas.definir("selecionar");
    ferramentas.mostrarSugestoes(lista);
  }),
  marcaImagem: async () => {
    if (!exigirDocumento()) return;
    const f = await escolherArquivo($<HTMLInputElement>("arquivoImagem"));
    if (!f) return;
    const opac = el("input", { type: "range", min: "5", max: "100", value: "30" });
    const escala = el("input", { type: "range", min: "5", max: "100", value: "50" });
    const modo = el("select");
    modo.append(el("option", { value: "centro", textContent: "Centralizada" }), el("option", { value: "mosaico", textContent: "Em mosaico (repetida)" }));
    const camada = el("select");
    camada.append(el("option", { value: "sobre", textContent: "Por cima do conteúdo" }), el("option", { value: "sob", textContent: "Por baixo do conteúdo" }));
    const { valor } = await dialogo("Marca d’água de imagem", [
      el("p", { classe: "dica", textContent: f.name }),
      el("div", { classe: "linha-campos" }, campo("Opacidade", opac), campo("Tamanho (% da largura)", escala)),
      el("div", { classe: "linha-campos" }, campo("Posição", modo), campo("Camada", camada)),
      el("p", { classe: "dica", textContent: "“Por baixo” só aparece onde a página é transparente (fundo branco sem desenho)." }),
    ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Aplicar", valor: "ok", primario: true }]);
    if (valor !== "ok") return;
    const bytes = await f.arrayBuffer();
    await operar("marcaDaguaImagem", { bytes, opcoes: { opacidade: Number(opac.value) / 100, escala: Number(escala.value) / 100,
      modo: modo.value, camada: camada.value } }, [bytes]);
  },
  substituir: async () => {
    if (!exigirDocumento()) return;
    const de = el("input", { type: "text" });
    const para = el("input", { type: "text" });
    const { valor } = await dialogo("Substituir texto", [campo("Procurar", de), campo("Substituir por", para,
      "Diferencia maiúsculas. Cada ocorrência é apagada de verdade e reescrita no mesmo lugar, com a fonte padrão mais parecida (Helvetica, Times ou Courier).")],
    [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Substituir tudo", valor: "ok", primario: true }], () => de.focus(),
    () => (!de.value ? "Digite o texto a procurar." : null));
    if (valor !== "ok") return;
    const n = await operar("substituirEmTudo", { procurado: de.value, novo: para.value });
    if (n === FALHOU) return;
    avisar(n ? `${n} ocorrência(s) substituída(s).` : "Nenhuma ocorrência encontrada.", n ? "ok" : "info");
  },
  propriedades: async () => {
    if (!exigirDocumento()) return;
    const atual = await motor.pedir<Record<string, string>>("metadados");
    const entradas: Record<string, HTMLInputElement> = {};
    const corpo = Object.entries(CAMPOS_METADADOS).map(([k, [, rot]]) => {
      entradas[k] = el("input", { type: "text", value: atual[k] ?? "" });
      return campo(rot, entradas[k]);
    });
    const { valor } = await dialogo("Propriedades do documento", corpo,
      [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Gravar", valor: "ok", primario: true }], () => entradas.titulo.focus());
    if (valor !== "ok") return;
    const valores = Object.fromEntries(Object.keys(entradas).map((k) => [k, entradas[k].value]));
    const r = await operar("definirMetadados", { valores });
    if (r === true) avisar("Propriedades atualizadas.", "ok");
  },
  camera: () => digitalizarCamera(),
  juntar: () => juntarPdfsAcao(),
};

function exigirDocumento(): boolean {
  if (estado?.aberto) return true;
  avisar("Abra um PDF primeiro.");
  return false;
}

function tamanho(b: number): string {
  if (b < 1024) return `${b} bytes`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;
}

/** Tarefa que nao altera o documento, com indicador de ocupado e aviso de erro. */
async function tarefa(fn: () => Promise<void>): Promise<void> {
  operando++;
  mostrarOcupado();
  try {
    await fn();
  } catch (e) {
    avisar((e as Error).message || "Não foi possível concluir.", "erro");
  } finally {
    operando--;
    mostrarOcupado();
  }
}

async function compararDocumentos(): Promise<void> {
  let bytesA: ArrayBuffer | undefined, nomeA: string | undefined;
  if (!estado?.aberto) {
    avisar("Escolha o primeiro PDF (A, a versão antiga).");
    const fa = await escolherArquivo($<HTMLInputElement>("arquivoPdf"));
    if (!fa) return;
    bytesA = await fa.arrayBuffer();
    nomeA = fa.name;
    avisar("Agora escolha o segundo PDF (B, a versão nova).");
  } else {
    avisar(`Escolha o PDF para comparar com “${estado.nome}” (que será o A, a versão antiga).`);
  }
  const fb = await escolherArquivo($<HTMLInputElement>("arquivoPdf"));
  if (!fb) return;
  const bytesB = await fb.arrayBuffer();
  await tarefa(async () => {
    await motor.pronto;
    const dados = await motor.pedir<{ paginasA: InfoPagina[]; paginasB: InfoPagina[]; diferencas: Diferenca[]; nomeA: string }>(
      "compararAbrir", { bytesA, nomeA, bytesB, nomeB: fb.name }, [bytesB, ...(bytesA ? [bytesA] : [])]);
    const { mostrarComparacao } = await import("./ui/comparacao.ts");
    void mostrarComparacao(motor, dados, fb.name);
  });
}

async function executarOcr(): Promise<void> {
  if (!exigirDocumento() || !estado) return;
  const idioma = el("select");
  idioma.append(el("option", { value: "por", textContent: "Português" }), el("option", { value: "por+eng", textContent: "Português + inglês" }),
    el("option", { value: "eng", textContent: "Inglês" }));
  const quais = el("input", { type: "text", placeholder: "todas" });
  const total = estado.paginas.length;
  const { valor } = await dialogo("Reconhecer texto (OCR)", [
    el("p", { textContent: "Para PDF escaneado: o texto reconhecido entra invisível sobre a imagem, na posição de cada palavra. Assim dá para buscar, selecionar, copiar e tarjar." }),
    el("div", { classe: "linha-campos" }, campo("Idioma", idioma), campo("Páginas", quais, "Vazio = todas")),
    el("p", { classe: "dica", textContent: "Páginas que já têm texto são puladas. Na primeira vez o reconhecimento baixa ~6 MB do próprio site; depois funciona sem internet. Nada sai do seu computador." }),
  ], [{ rotulo: "Cancelar", valor: "c" }, { rotulo: "Reconhecer", valor: "ok", primario: true }], () => idioma.focus(), () => {
    try { if (quais.value.trim()) lerIntervalos(quais.value, total); } catch (e) { return (e as Error).message; }
    return null;
  });
  if (valor !== "ok") return;
  const paginas = quais.value.trim() ? [...new Set(lerIntervalos(quais.value, total).flat())] : [...Array(total).keys()];
  // Progresso num dialogo nao modal com "Cancelar".
  const barra = el("progress", { max: 1, value: 0 });
  const texto = el("p", { textContent: "Preparando…" });
  let cancelado = false;
  const painel = el("div", { classe: "progresso-ocr", role: "status" } as Partial<HTMLDivElement>, el("strong", { textContent: "Reconhecendo texto" }), texto, barra);
  const btCancelar = el("button", { type: "button", textContent: "Cancelar" });
  btCancelar.addEventListener("click", () => { cancelado = true; texto.textContent = "Cancelando…"; });
  painel.append(btCancelar);
  document.body.append(painel);
  try {
    const { reconhecer } = await import("./ui/ocr.ts");
    const r = await reconhecer(motor, paginas, idioma.value, (t, f) => { texto.textContent = t; barra.value = f; }, () => cancelado);
    const palavras = r.paginas.reduce((n, p) => n + p.palavras.length, 0);
    if (palavras) {
      const res = await operar("camadaOcr", { paginas: r.paginas });
      if (res === FALHOU) return;
    }
    const pul = r.puladas.length ? ` ${r.puladas.length} página(s) já tinham texto e foram puladas.` : "";
    avisar(palavras ? `Texto reconhecido: ${palavras} palavra(s) em ${r.paginas.length} página(s).${pul}`
      : `Nenhum texto reconhecido.${pul}`, palavras ? "ok" : "info", 8000);
  } catch (e) {
    avisar("Falha no reconhecimento de texto: " + ((e as Error).message || String(e)), "erro");
  } finally {
    painel.remove();
  }
}

async function juntarPdfsAcao(): Promise<void> {
  await motor.pronto;
  let aberto: { nome: string; bytes: Uint8Array } | undefined;
  if (estado?.aberto) {
    aberto = await motor.pedir<{ nome: string; bytes: Uint8Array }>("bytesAberto").catch(() => undefined);
  }
  const { juntarPdfs } = await import("./ui/juntar.ts");
  const r = await juntarPdfs(motor, aberto);
  if (!r) return;
  if (!r.abrir) {
    baixar(r.bytes, "juntado.pdf");
    avisar("“juntado.pdf” baixado.", "ok");
    return;
  }
  await abrirArquivo(new File([r.bytes as Uint8Array<ArrayBuffer>], "juntado.pdf", { type: "application/pdf" }), true);
}

async function digitalizarCamera(): Promise<void> {
  const { digitalizar } = await import("./ui/camera.ts");
  const paginas = await digitalizar();
  if (!paginas?.length) return;
  await tarefa(async () => {
    await motor.pronto;
    const arquivos = await Promise.all(paginas.map(async (b, i) => ({ bytes: await b.arrayBuffer(), nome: `pagina${i + 1}.jpg` })));
    const pdf = await motor.pedir<Uint8Array>("juntarImagens", { arquivos }, arquivos.map((a) => a.bytes));
    const hoje = new Date().toISOString().slice(0, 10);
    await abrirArquivo(new File([pdf as Uint8Array<ArrayBuffer>], `digitalizacao-${hoje}.pdf`, { type: "application/pdf" }));
  });
}

// ---------------------------------------------------------------- marcadores

async function atualizarMarcadores(): Promise<void> {
  const lista = $("marcadores");
  const aba = $("abaMarcadores");
  const itens = await motor.pedir<{ titulo: string; nivel: number; pagina: number | null }[]>("marcadores").catch(() => []);
  aba.hidden = itens.length === 0;
  // So' a aba "Paginas": nem mostra a barra de abas.
  (aba.parentElement as HTMLElement).hidden = itens.length === 0;
  if (!itens.length && !lista.hidden) mostrarAba("miniaturas");
  lista.textContent = "";
  for (const m of itens) {
    const b = el("button", { type: "button", classe: "marcador", textContent: m.titulo, disabled: m.pagina === null });
    b.style.paddingLeft = `${8 + m.nivel * 14}px`;
    b.title = m.pagina === null ? m.titulo : `${m.titulo} (página ${m.pagina + 1})`;
    b.addEventListener("click", () => { if (m.pagina !== null) visor.irPara(m.pagina); });
    lista.append(b);
  }
}

function mostrarAba(qual: "miniaturas" | "marcadores"): void {
  $("miniaturas").hidden = qual !== "miniaturas";
  $("marcadores").hidden = qual !== "marcadores";
  $("abaMinis").classList.toggle("ativa", qual === "miniaturas");
  $("abaMarcadores").classList.toggle("ativa", qual === "marcadores");
}
$("abaMinis").addEventListener("click", () => mostrarAba("miniaturas"));
$("abaMarcadores").addEventListener("click", () => mostrarAba("marcadores"));

async function sobre(): Promise<void> {
  const link = (href: string, t: string) => el("a", { href, textContent: t, target: "_blank", rel: "noopener" });
  await dialogo("Sobre o EditPDFree", [
    el("p", {}, "Editor de PDF gratuito e de código aberto. Esta é a versão para navegador ",
      el("strong", { textContent: `(${__VERSAO__})` }), "."),
    el("p", {}, el("strong", { textContent: "Seus arquivos não saem do seu computador." }),
      " O PDF é aberto, editado e salvo aqui mesmo, no seu navegador, pelo MuPDF compilado para WebAssembly. Não há servidor recebendo arquivos, nem contagem de acesso, nem anúncios."),
    el("p", {}, "Software livre sob a licença ", link("https://www.gnu.org/licenses/agpl-3.0.html", "AGPL-3.0"),
      ". Código-fonte: ", link("https://github.com/RicardoBiazin/editpdfree", "github.com/RicardoBiazin/editpdfree"), "."),
    el("p", { classe: "dica" }, "Motor de PDF: ", link("https://mupdf.com", "MuPDF"), " (MuPDF.js, AGPL-3.0), da Artifex Software. Reconhecimento de texto: ",
      link("https://github.com/naptha/tesseract.js", "tesseract.js"), " (Apache-2.0), servido por este site e carregado só quando usado."),
    el("p", { classe: "dica", textContent: "Atalhos: Ctrl+O abrir · Ctrl+S salvar · Ctrl+Z/Ctrl+Y desfazer/refazer · Ctrl+F localizar · Delete exclui a anotação selecionada · Ctrl+roda do mouse: zoom · Esc volta para Selecionar." }),
  ], [{ rotulo: "Fechar", valor: "ok", primario: true }]);
}

// ---------------------------------------------------------------- busca

let resultados: Resultado[] = [];
let atualBusca = -1;
let buscaPendente = 0;

function abrirBusca(): void {
  if (!estado?.aberto) return;
  $("busca").hidden = false;
  const i = $<HTMLInputElement>("inBusca");
  i.focus();
  i.select();
}

function limparBusca(): void {
  resultados = [];
  atualBusca = -1;
  $("contagemBusca").textContent = "";
  ferramentas.mostrarBusca([], -1);
}

function fecharBusca(): void {
  $("busca").hidden = true;
  limparBusca();
  $<HTMLInputElement>("inBusca").value = "";
}

async function buscar(): Promise<void> {
  const termo = $<HTMLInputElement>("inBusca").value;
  const meu = ++buscaPendente;
  if (!termo.trim()) {
    limparBusca();
    return;
  }
  const r = await motor.pedir<Resultado[]>("buscar", { termo }).catch(() => [] as Resultado[]);
  if (meu !== buscaPendente) return;
  resultados = r;
  // Comeca no primeiro resultado a partir da pagina atual.
  atualBusca = r.length ? Math.max(0, r.findIndex((x) => x.pagina >= visor.paginaAtual)) : -1;
  mostrarResultado();
}

function mostrarResultado(): void {
  const c = $("contagemBusca");
  if (!resultados.length) {
    c.textContent = $<HTMLInputElement>("inBusca").value.trim() ? "Nada encontrado" : "";
    ferramentas.mostrarBusca([], -1);
    return;
  }
  c.textContent = `${atualBusca + 1} de ${resultados.length}${resultados.length >= 500 ? "+" : ""}`;
  ferramentas.mostrarBusca(resultados, atualBusca);
  const r = resultados[atualBusca];
  visor.mostrarRetangulo(r.pagina, r.rect);
}

function passoBusca(d: number): void {
  if (!resultados.length) {
    void buscar();
    return;
  }
  atualBusca = (atualBusca + d + resultados.length) % resultados.length;
  mostrarResultado();
}

let temporizadorBusca = 0;
$("inBusca").addEventListener("input", () => {
  clearTimeout(temporizadorBusca);
  temporizadorBusca = window.setTimeout(buscar, 300);
});
$("inBusca").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    clearTimeout(temporizadorBusca);
    if (!resultados.length) void buscar();
    else passoBusca(ev.shiftKey ? -1 : 1);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    fecharBusca();
  }
});
$("btBuscaProxima").addEventListener("click", () => passoBusca(1));
$("btBuscaAnterior").addEventListener("click", () => passoBusca(-1));
$("btBuscaFechar").addEventListener("click", fecharBusca);

// ---------------------------------------------------------------- barra

const grupo = $("grupoFerramentas");
for (const f of FERRAMENTAS) {
  const b = el("button", { classe: "bt bt-ferramenta", type: "button", title: f.dica });
  b.dataset.ferramenta = f.nome;
  b.setAttribute("aria-label", f.rotulo);
  b.setAttribute("aria-pressed", String(f.nome === "selecionar"));
  b.innerHTML = icone(f.icone);
  if (f.nome === "selecionar") b.classList.add("ativo");
  b.addEventListener("click", () => void ferramentas.definir(f.nome as NomeFerramenta));
  grupo.append(b);
}

$("btAbrir").addEventListener("click", async () => {
  const f = await escolherArquivo($<HTMLInputElement>("arquivo"));
  if (f) await abrirArquivo(f);
});
$("btAbrirGrande").addEventListener("click", () => $("btAbrir").click());
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-acao-inicio]")) {
  b.addEventListener("click", () => void acoes[b.dataset.acaoInicio!]?.());
}
$("btSalvar").addEventListener("click", () => void salvar());
$("btDesfazer").addEventListener("click", () => void desfazer());
$("btRefazer").addEventListener("click", () => void refazer());
$("btZoomMenos").addEventListener("click", () => visor.definirZoom(passoZoom(-1)));
$("btZoomMais").addEventListener("click", () => visor.definirZoom(passoZoom(1)));
$("btZoom").addEventListener("click", () => visor.definirZoom(visor.zoomLargura()));
$("btLargura").addEventListener("click", () => visor.definirZoom(visor.zoomLargura()));
$("btBuscar").addEventListener("click", () => ($("busca").hidden ? abrirBusca() : fecharBusca()));
$("btLateral").addEventListener("click", () => {
  document.body.classList.toggle("sem-lateral");
  $("lateral").hidden = !estado?.aberto || document.body.classList.contains("sem-lateral");
  visor.agendar();
});
if (window.innerWidth < 800) document.body.classList.add("sem-lateral");

const NIVEIS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
function passoZoom(d: number): number {
  const z = visor.zoom;
  if (d > 0) return NIVEIS.find((n) => n > z + 0.001) ?? 5;
  return [...NIVEIS].reverse().find((n) => n < z - 0.001) ?? 0.25;
}

const inPagina = $<HTMLInputElement>("inPagina");
inPagina.addEventListener("change", () => {
  const n = parseInt(inPagina.value, 10);
  if (estado && n >= 1 && n <= estado.paginas.length) visor.irPara(n - 1);
  else inPagina.value = String(visor.paginaAtual + 1);
});
inPagina.addEventListener("focus", () => inPagina.select());

// Menus: fechar ao escolher e ao clicar fora.
for (const m of document.querySelectorAll<HTMLDetailsElement>("details.menu")) {
  m.addEventListener("toggle", () => {
    if (m.open && m.classList.contains("desativado")) m.open = false;
    if (m.open) for (const o of document.querySelectorAll<HTMLDetailsElement>("details.menu")) if (o !== m) o.open = false;
  });
  m.querySelector(".menu-itens")!.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest("button[data-acao]") as HTMLButtonElement | null;
    if (!b) return;
    m.open = false;
    void acoes[b.dataset.acao!]?.();
  });
}
document.addEventListener("pointerdown", (ev) => {
  for (const m of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) {
    if (!m.contains(ev.target as Node)) m.open = false;
  }
});

async function desfazer(): Promise<void> {
  ferramentas.desselecionar();
  const r = await operar("desfazer");
  if (typeof r === "string") avisar(`Desfeito: ${r}`);
}

async function refazer(): Promise<void> {
  ferramentas.desselecionar();
  const r = await operar("refazer");
  if (typeof r === "string") avisar(`Refeito: ${r}`);
}

// ---------------------------------------------------------------- teclado, roda, arrastar

function editando(ev: Event): boolean {
  const t = ev.target as HTMLElement;
  return !!t.closest("input, textarea, select, [contenteditable=true], dialog");
}

document.addEventListener("keydown", (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (ctrl && k === "o") {
    ev.preventDefault();
    $("btAbrir").click();
    return;
  }
  if (!estado?.aberto) return;
  if (ctrl && k === "s") {
    ev.preventDefault();
    void salvar();
  } else if (ctrl && k === "f") {
    ev.preventDefault();
    abrirBusca();
  } else if (editando(ev)) {
    return;
  } else if (ctrl && k === "z" && !ev.shiftKey) {
    ev.preventDefault();
    void desfazer();
  } else if (ctrl && (k === "y" || (k === "z" && ev.shiftKey))) {
    ev.preventDefault();
    void refazer();
  } else if ((ev.key === "Delete" || ev.key === "Backspace") && ferramentas.selecao) {
    ev.preventDefault();
    void ferramentas.excluirSelecionada();
  } else if (ev.key === "Escape") {
    ferramentas.desselecionar();
    if (ferramentas.atual !== "selecionar") void ferramentas.definir("selecionar");
  } else if (ctrl && (k === "+" || k === "=")) {
    ev.preventDefault();
    visor.definirZoom(passoZoom(1));
  } else if (ctrl && k === "-") {
    ev.preventDefault();
    visor.definirZoom(passoZoom(-1));
  } else if (ctrl && k === "0") {
    ev.preventDefault();
    visor.definirZoom(1);
  } else if (ev.key === "PageDown" && !ctrl) {
    // rolagem nativa
  } else if (ev.key === "Home" && ctrl) {
    visor.irPara(0);
  } else if (ev.key === "End" && ctrl) {
    visor.irPara(estado.paginas.length - 1);
  }
});

$("visor").addEventListener("wheel", (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || !estado?.aberto) return;
  ev.preventDefault();
  const fator = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0022));
  visor.definirZoom(visor.zoom * fator, { x: ev.clientX, y: ev.clientY });
}, { passive: false });

let profundidade = 0;
window.addEventListener("dragenter", (ev) => {
  if (!ev.dataTransfer?.types.includes("Files")) return;
  // Com "Juntar PDFs" aberto, o proprio dialogo recebe os arquivos.
  if (document.querySelector("dialog.juntar[open]")) return;
  profundidade++;
  $("soltar").hidden = false;
});
window.addEventListener("dragleave", () => {
  profundidade = Math.max(0, profundidade - 1);
  if (!profundidade) $("soltar").hidden = true;
});
window.addEventListener("dragover", (ev) => {
  if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
});
window.addEventListener("drop", (ev) => {
  profundidade = 0;
  $("soltar").hidden = true;
  if (!ev.dataTransfer?.files.length) return;
  ev.preventDefault();
  void abrirArquivo(ev.dataTransfer.files[0]);
});
// A lista de miniaturas trata o proprio "soltar" (inserir no documento).
$("lateral").addEventListener("drop", () => {
  profundidade = 0;
  $("soltar").hidden = true;
});

window.addEventListener("beforeunload", (ev) => {
  if (estado?.modificado) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});

// Abrir arquivos pelo sistema (PWA instalado como leitor de PDF).
interface LaunchQueue { setConsumer(f: (p: { files: FileSystemFileHandle[] }) => void): void }
const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
lq?.setConsumer(async (p) => {
  const h = p.files?.[0];
  if (h) await abrirArquivo(await h.getFile());
});

// ---------------------------------------------------------------- inicio

const btGrande = $<HTMLButtonElement>("btAbrirGrande");
btGrande.disabled = true;
btGrande.textContent = "Carregando o motor de PDF…";
motor.pronto.then(() => {
  btGrande.disabled = false;
  btGrande.textContent = "Abrir PDF";
}).catch((e) => {
  btGrande.textContent = "Não foi possível carregar";
  avisar((e as Error).message + " Tente recarregar a página (o navegador precisa suportar WebAssembly).", "erro", 20000);
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker:", e));
  });
}

declare const __VERSAO__: string;
