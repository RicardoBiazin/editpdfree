// Opcoes da numeracao de paginas (sem mupdf: a interface usa direto).

export const POSICOES = {
  "inferior-centro": "Rodapé, centro",
  "inferior-direita": "Rodapé, direita",
  "inferior-esquerda": "Rodapé, esquerda",
  "superior-centro": "Cabeçalho, centro",
  "superior-direita": "Cabeçalho, direita",
  "superior-esquerda": "Cabeçalho, esquerda",
} as const;

export type Posicao = keyof typeof POSICOES;

export function formatarNumero(formato: string, n: number, total: number): string {
  if (!formato.includes("{n}")) throw new Error("O formato precisa conter {n}.");
  const resto = formato.replace(/\{n\}|\{total\}/g, "");
  if (/[{}]/.test(resto)) throw new Error("O formato só aceita {n} e {total}.");
  return formato.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

