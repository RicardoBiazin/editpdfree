/*
 * Campos de formulario (AcroForm) existentes: listar e preencher.
 */

import type * as mupdf from "mupdf";
import type { Retangulo } from "./coordenadas.ts";
import type { Sessao } from "./documento.ts";

export type TipoCampo = "texto" | "caixa" | "opcao" | "lista" | "combo" | "botao" | "assinatura" | "outro";

export interface Campo {
  id: number;
  pagina: number;
  nome: string;
  tipo: TipoCampo;
  valor: string;
  marcado: boolean;
  opcoes: string[];
  limites: Retangulo;
  somenteLeitura: boolean;
  multilinha: boolean;
}

function tipoDe(w: mupdf.PDFWidget): TipoCampo {
  const t = w.getFieldType();
  switch (t) {
    case "text": return "texto";
    case "checkbox": return "caixa";
    case "radiobutton": return "opcao";
    case "listbox": return "lista";
    case "combobox": return "combo";
    case "button": return "botao";
    case "signature": return "assinatura";
    default: return "outro";
  }
}

function marcado(v: string): boolean {
  return !!v && v !== "Off" && v !== "false";
}

export function listarCampos(p: mupdf.PDFPage, pagina: number): Campo[] {
  return p.getWidgets().map((w) => {
    const tipo = tipoDe(w);
    const valor = w.getValue() ?? "";
    return {
      id: w.getObject().asIndirect(), pagina, nome: w.getName() || w.getLabel() || "",
      tipo, valor, marcado: marcado(valor),
      opcoes: tipo === "lista" || tipo === "combo" ? w.getOptions() : [],
      limites: w.getBounds() as Retangulo,
      somenteLeitura: w.isReadOnly(),
      multilinha: tipo === "texto" && w.isMultiline(),
    };
  });
}

function acharCampo(p: mupdf.PDFPage, id: number): mupdf.PDFWidget {
  for (const w of p.getWidgets()) if (w.getObject().asIndirect() === id) return w;
  throw new Error("Campo não encontrado.");
}

/** Preenche um campo. Texto/lista/combo recebem string; caixa/opcao, boolean. */
export function preencherCampo(s: Sessao, pagina: number, id: number, valor: string | boolean): boolean {
  const p0 = s.pagina(pagina);
  const w0 = acharCampo(p0, id);
  if (w0.isReadOnly()) throw new Error("Este campo é somente leitura.");
  const tipo = tipoDe(w0);
  if (tipo === "caixa" || tipo === "opcao") {
    if (marcado(w0.getValue()) === Boolean(valor)) return false;
  } else if (String(valor) === (w0.getValue() ?? "")) {
    return false;
  }
  return s.operacao("Preencher formulário", () => {
    const p = s.pagina(pagina);
    const w = acharCampo(p, id);
    if (tipo === "caixa" || tipo === "opcao") {
      w.toggle();
    } else if (tipo === "texto") {
      w.setTextValue(String(valor));
    } else if (tipo === "lista" || tipo === "combo") {
      w.setChoiceValue(String(valor));
    } else {
      throw new Error("Tipo de campo não suportado.");
    }
    w.update();
    return true;
  });
}
