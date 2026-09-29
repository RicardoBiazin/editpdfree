// Cliente do worker: cada pedido vira uma Promise.

import type { Estado } from "./worker.ts";

export type { Estado, InfoPagina } from "./worker.ts";

export class ErroWorker extends Error {
  nomeOriginal: string;
  errada: boolean;
  constructor(msg: string, nome: string, errada: boolean) {
    super(msg);
    this.nomeOriginal = nome;
    this.errada = errada;
  }
}

type Pendente = { ok: (v: unknown) => void; falha: (e: unknown) => void };

export class Motor {
  private w: Worker;
  private seq = 0;
  private pendentes = new Map<number, Pendente>();
  pronto: Promise<void>;
  /** Pedidos em andamento (para o indicador de ocupado). */
  ocupado = 0;
  aoMudarOcupado: (n: number) => void = () => undefined;

  constructor() {
    this.w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let resolver!: () => void;
    let rejeitar!: (e: unknown) => void;
    this.pronto = new Promise<void>((r, j) => {
      resolver = r;
      rejeitar = j;
    });
    this.w.onmessage = (ev) => {
      const { id, ok, r, erro, nome, errada } = ev.data;
      if (id === 0) {
        resolver();
        return;
      }
      const p = this.pendentes.get(id);
      if (!p) return;
      this.pendentes.delete(id);
      this.ocupado--;
      this.aoMudarOcupado(this.ocupado);
      if (ok) p.ok(r);
      else p.falha(new ErroWorker(erro, nome, errada));
    };
    this.w.onerror = (ev) => {
      rejeitar(new Error("Não foi possível iniciar o motor de PDF: " + (ev.message || "erro desconhecido")));
    };
  }

  pedir<T = unknown>(tipo: string, args: unknown = {}, transferir: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    this.ocupado++;
    this.aoMudarOcupado(this.ocupado);
    return new Promise<T>((ok, falha) => {
      this.pendentes.set(id, { ok: ok as (v: unknown) => void, falha });
      this.w.postMessage({ id, tipo, args }, transferir);
    });
  }

  /** Operacao que altera o documento: devolve o resultado e o novo estado. */
  async operar<T = unknown>(tipo: string, args: unknown = {}, transferir: Transferable[] = []):
    Promise<{ r: T; estado: Estado }> {
    return this.pedir<{ r: T; estado: Estado }>(tipo, args, transferir);
  }
}
