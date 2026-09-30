// Constantes e formatos sem mupdf: a interface usa direto, sem carregar o motor.

export const POSICOES = {
  "inferior-centro": "Rodapé, centro",
  "inferior-direita": "Rodapé, direita",
  "inferior-esquerda": "Rodapé, esquerda",
  "superior-centro": "Cabeçalho, centro",
  "superior-direita": "Cabeçalho, direita",
  "superior-esquerda": "Cabeçalho, esquerda",
} as const;

export type Posicao = keyof typeof POSICOES;

export interface ExtrasFormato { arquivo?: string; data?: string }

/** Texto de cabecalho/rodape: aceita {n} (numero da pagina), {total},
 *  {arquivo} (nome do arquivo) e {data} (data de hoje). */
export function formatarNumero(formato: string, n: number, total: number, extra: ExtrasFormato = {}): string {
  if (!formato.trim()) throw new Error("Informe o texto do cabeçalho ou rodapé.");
  const resto = formato.replace(/\{(n|total|arquivo|data)\}/g, "");
  if (/[{}]/.test(resto)) throw new Error("O formato só aceita {n}, {total}, {arquivo} e {data}.");
  return formato.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total))
    .replace(/\{arquivo\}/g, extra.arquivo ?? "").replace(/\{data\}/g, extra.data ?? "");
}

export function dataDeHoje(d = new Date()): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export const CAMPOS_METADADOS = {
  titulo: ["info:Title", "Título"],
  autor: ["info:Author", "Autor"],
  assunto: ["info:Subject", "Assunto"],
  palavrasChave: ["info:Keywords", "Palavras-chave"],
  criador: ["info:Creator", "Aplicativo de criação"],
  produtor: ["info:Producer", "Produtor"],
} as const;


export const CARIMBOS = ["APROVADO", "REPROVADO", "CÓPIA", "PAGO", "RECEBIDO", "CONFIDENCIAL", "RASCUNHO",
  "URGENTE", "CANCELADO", "CONFERIDO"] as const;


/** Os mesmos tres niveis do desktop (editpdfree/extras.py NIVEIS_COMPRESSAO):
 *  mudar um sem o outro faz o mesmo nome comprimir diferente em cada versao. */
export const NIVEIS_COMPRESSAO = {
  leve: { dpi: 150, qualidade: 80, rotulo: "Leve",
    descricao: "Quase sem perda visível. Bom para imprimir." },
  media: { dpi: 110, qualidade: 65, rotulo: "Recomendada",
    descricao: "Equilíbrio entre tamanho e qualidade. Bom para e-mail e sistemas." },
  forte: { dpi: 72, qualidade: 45, rotulo: "Máxima",
    descricao: "Menor arquivo, para ler na tela. Imagens perdem nitidez." },
} as const;
export type NivelCompressao = keyof typeof NIVEIS_COMPRESSAO;

