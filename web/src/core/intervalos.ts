/*
 * Funcoes puras sobre numeros de pagina (sem mupdf): a interface usa estas
 * direto, sem carregar o motor na linha principal.
 *
 * Indices sao BASE 0; so' o que o usuario digita ("1-3, 5") e' base 1.
 */

/** Move as paginas `indices` para que a primeira delas fique em `destino`
 *  (indice na lista SEM as paginas movidas). Devolve a nova ordem. */
export function ordemAoMover(total: number, indices: number[], destino: number): number[] {
  const mover = [...new Set(indices)].sort((a, b) => a - b);
  const resto = [...Array(total).keys()].filter((i) => !mover.includes(i));
  const pos = Math.max(0, Math.min(destino, resto.length));
  return [...resto.slice(0, pos), ...mover, ...resto.slice(pos)];
}

/** "1-3, 5, 8-" -> [[0,1,2], [4], [7..total-1]]. Cada parte vira um grupo.
 *  Levanta Error com mensagem legivel para o usuario. */
export function lerIntervalos(texto: string, total: number): number[][] {
  const grupos: number[][] = [];
  for (const bruta of texto.replace(/;/g, ",").split(",")) {
    const parte = bruta.trim();
    if (!parte) continue;
    let inicio: number, fim: number;
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(parte);
    if (m) {
      if (!m[1] && !m[2]) throw new Error(`Intervalo inválido: “${parte}”.`);
      inicio = m[1] ? Number(m[1]) : 1;
      fim = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(parte)) {
      inicio = fim = Number(parte);
    } else {
      throw new Error(`Intervalo inválido: “${parte}”.`);
    }
    if (!(inicio >= 1 && inicio <= fim && fim <= total)) {
      throw new Error(`Intervalo fora do documento (1 a ${total}): “${parte}”.`);
    }
    grupos.push(Array.from({ length: fim - inicio + 1 }, (_, k) => inicio - 1 + k));
  }
  if (!grupos.length) throw new Error("Nenhum intervalo informado.");
  return grupos;
}

export function gruposACada(total: number, n: number): number[][] {
  if (!(Number.isInteger(n) && n >= 1)) throw new Error("Informe um número de páginas maior que zero.");
  const grupos: number[][] = [];
  for (let i = 0; i < total; i += n) {
    grupos.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  }
  return grupos;
}

export function nomeBase(nome: string): string {
  return nome.replace(/\.pdf$/i, "") || "documento";
}


const colacao = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Ordem "natural" de nomes de arquivo: "doc2" antes de "doc10", sem
 *  diferenciar maiusculas nem acentos. */
export function compararNomes(a: string, b: string): number {
  return colacao.compare(a, b);
}
