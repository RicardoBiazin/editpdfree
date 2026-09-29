// Dialogos modais (<dialog>) e avisos rapidos. Conteudo vindo do usuario ou
// do PDF entra sempre por textContent/value, nunca por innerHTML.

export interface Botao { rotulo: string; valor: string; primario?: boolean; perigo?: boolean }

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { classe?: string } = {},
  ...filhos: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { classe, ...resto } = props as { classe?: string } & Record<string, unknown>;
  if (classe) e.className = classe;
  Object.assign(e, resto);
  for (const f of filhos) if (f !== null && f !== undefined) e.append(f);
  return e;
}

/** Abre um dialogo. Devolve o `valor` do botao clicado (ou null se fechado com
 *  Esc). `aoAbrir` recebe o formulario, para focar/ligar eventos. */
export function dialogo(titulo: string, corpo: Node | Node[], botoes: Botao[],
  aoAbrir?: (f: HTMLFormElement) => void, validar?: (valor: string, f: HTMLFormElement) => string | null):
  Promise<{ valor: string | null; form: HTMLFormElement }> {
  return new Promise((resolver) => {
    const d = el("dialog", { classe: "dialogo" });
    const form = el("form", { method: "dialog" });
    const erro = el("p", { classe: "dialogo-erro", role: "alert" } as Partial<HTMLParagraphElement>);
    const rodape = el("div", { classe: "dialogo-botoes" });
    for (const b of botoes) {
      const bt = el("button", {
        type: b.primario ? "submit" : "button", value: b.valor, textContent: b.rotulo,
        classe: b.primario ? "primario" : b.perigo ? "perigo" : "",
      });
      if (!b.primario) {
        bt.addEventListener("click", () => fechar(b.valor));
      }
      rodape.append(bt);
    }
    form.append(el("h2", { textContent: titulo }), ...(Array.isArray(corpo) ? corpo : [corpo]), erro, rodape);
    d.append(form);
    document.body.append(d);
    let feito = false;
    const fechar = (valor: string | null) => {
      if (feito) return;
      feito = true;
      d.close();
      d.remove();
      resolver({ valor, form });
    };
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const primario = botoes.find((b) => b.primario)!;
      const msg = validar?.(primario.valor, form) ?? null;
      if (msg) {
        erro.textContent = msg;
        return;
      }
      fechar(primario.valor);
    });
    d.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      fechar(null);
    });
    d.showModal();
    aoAbrir?.(form);
    if (!aoAbrir) (form.querySelector("input,textarea,select,button") as HTMLElement | null)?.focus();
  });
}

export function campo(rotulo: string, entrada: HTMLElement, dica?: string): HTMLLabelElement {
  return el("label", { classe: "campo" }, el("span", { textContent: rotulo }), entrada,
    dica ? el("small", { textContent: dica }) : null);
}

export async function pedirTexto(titulo: string, rotulo: string, opcoes: {
  inicial?: string; multilinha?: boolean; senha?: boolean; dica?: string; ok?: string; obrigatorio?: boolean;
} = {}): Promise<string | null> {
  const entrada = opcoes.multilinha
    ? el("textarea", { name: "v", rows: 4, value: opcoes.inicial ?? "" })
    : el("input", { name: "v", type: opcoes.senha ? "password" : "text", value: opcoes.inicial ?? "", autocomplete: "off" });
  if (opcoes.multilinha) {
    entrada.addEventListener("keydown", (ev) => {
      const k = ev as KeyboardEvent;
      if (k.key === "Enter" && (k.ctrlKey || k.metaKey)) (entrada.closest("form") as HTMLFormElement).requestSubmit();
    });
  }
  const { valor } = await dialogo(titulo, campo(rotulo, entrada, opcoes.dica),
    [{ rotulo: "Cancelar", valor: "cancelar" }, { rotulo: opcoes.ok ?? "OK", valor: "ok", primario: true }],
    () => {
      entrada.focus();
      if (entrada instanceof HTMLInputElement) entrada.select();
    },
    () => (opcoes.obrigatorio !== false && !(entrada as HTMLInputElement).value.trim() && !opcoes.senha
      ? "Preencha o campo." : null));
  return valor === "ok" ? (entrada as HTMLInputElement).value : null;
}

export async function confirmar(titulo: string, mensagem: string, ok = "Continuar", perigo = false): Promise<boolean> {
  const { valor } = await dialogo(titulo, el("p", { textContent: mensagem }), [
    { rotulo: "Cancelar", valor: "cancelar" },
    { rotulo: ok, valor: "ok", primario: true, perigo },
  ]);
  return valor === "ok";
}

let areaAvisos: HTMLElement | null = null;

export function avisar(mensagem: string, tipo: "info" | "erro" | "ok" = "info", ms = 4500): void {
  if (!areaAvisos) {
    areaAvisos = el("div", { classe: "avisos", role: "status" } as Partial<HTMLDivElement>);
    areaAvisos.setAttribute("aria-live", "polite");
    document.body.append(areaAvisos);
  }
  const a = el("div", { classe: `aviso ${tipo}`, textContent: mensagem });
  areaAvisos.append(a);
  setTimeout(() => {
    a.classList.add("saindo");
    setTimeout(() => a.remove(), 300);
  }, tipo === "erro" ? Math.max(ms, 7000) : ms);
}
