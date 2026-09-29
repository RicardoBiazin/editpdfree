"""Operacoes sobre paginas: girar, excluir, mover, duplicar, inserir, extrair,
juntar e dividir.

Indices sao sempre **base 0** aqui dentro. So' o que o usuario digita (os
intervalos "1-3, 5") e' base 1, e a conversao acontece em `ler_intervalos`.
"""

from __future__ import annotations

import os
import pathlib
from typing import Iterable, Sequence

import pymupdf

from .documento import Documento

EXTENSOES_IMAGEM = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff",
                    ".webp")


def girar(d: Documento, indices: Iterable[int], graus: int) -> None:
    indices = sorted(set(indices))
    with d.operacao("Girar página" if len(indices) == 1 else "Girar páginas"):
        for i in indices:
            pagina = d.doc[i]
            pagina.set_rotation((pagina.rotation + graus) % 360)


def excluir(d: Documento, indices: Iterable[int]) -> None:
    indices = sorted(set(indices))
    if len(indices) >= d.paginas:
        raise ValueError("Um PDF precisa de pelo menos uma página.")
    with d.operacao("Excluir página" if len(indices) == 1
                    else "Excluir páginas"):
        d.doc.delete_pages(indices)


def mover(d: Documento, origem: int, destino: int) -> None:
    """Move a pagina `origem` para que ela passe a ocupar a posicao `destino`.

    O `move_page` do PyMuPDF recebe "inserir ANTES de", o que da' um erro de
    um quando se move para baixo; a traducao fica aqui."""
    total = d.paginas
    if not (0 <= origem < total and 0 <= destino < total):
        raise IndexError("página fora do documento")
    if origem == destino:
        return
    with d.operacao("Mover página"):
        if destino > origem:
            antes_de = destino + 1
            d.doc.move_page(origem, -1 if antes_de >= total else antes_de)
        else:
            d.doc.move_page(origem, destino)


def reordenar(d: Documento, nova_ordem: Sequence[int]) -> None:
    """Aplica uma permutacao inteira de uma vez (um so' desfazer)."""
    if sorted(nova_ordem) != list(range(d.paginas)):
        raise ValueError("a nova ordem precisa conter cada página uma vez")
    if list(nova_ordem) == list(range(d.paginas)):
        return
    with d.operacao("Reordenar páginas"):
        d.doc.select(list(nova_ordem))


def duplicar(d: Documento, indice: int) -> None:
    with d.operacao("Duplicar página"):
        destino = indice + 1
        d.doc.fullcopy_page(indice, -1 if destino >= d.paginas else destino)


def inserir_em_branco(d: Documento, posicao: int,
                      largura: float | None = None,
                      altura: float | None = None) -> None:
    """Pagina em branco na `posicao`. Sem medidas, copia as da pagina vizinha
    (um PDF em A4 ganha uma pagina A4, e nao Carta)."""
    if largura is None or altura is None:
        vizinha = d.doc[min(max(posicao - 1, 0), d.paginas - 1)]
        largura, altura = vizinha.rect.width, vizinha.rect.height
    with d.operacao("Inserir página em branco"):
        d.doc.new_page(pno=posicao if posicao < d.paginas else -1,
                       width=largura, height=altura)


def _abrir_como_pdf(caminho: str | os.PathLike) -> pymupdf.Document:
    caminho = pathlib.Path(caminho)
    if caminho.suffix.lower() in EXTENSOES_IMAGEM:
        with pymupdf.open(caminho) as imagem:
            return pymupdf.open("pdf", imagem.convert_to_pdf())
    return pymupdf.open(stream=caminho.read_bytes(), filetype="pdf")


def inserir_arquivo(d: Documento, caminho: str | os.PathLike,
                    posicao: int) -> int:
    """Insere um PDF (ou uma imagem, como pagina) na `posicao`. Devolve o
    numero de paginas inseridas."""
    with _abrir_como_pdf(caminho) as origem:
        if origem.needs_pass:
            raise ValueError("O arquivo a inserir é protegido por senha.")
        quantas = origem.page_count
        with d.operacao("Inserir arquivo"):
            d.doc.insert_pdf(origem,
                             start_at=posicao if posicao < d.paginas else -1)
    return quantas


def extrair(d: Documento, indices: Iterable[int],
            destino: str | os.PathLike) -> pathlib.Path:
    novo = pymupdf.open()
    try:
        for i in sorted(set(indices)):
            novo.insert_pdf(d.doc, from_page=i, to_page=i)
        destino = pathlib.Path(destino)
        novo.save(destino, garbage=3, deflate=True)
    finally:
        novo.close()
    return destino


def juntar(caminhos: Sequence[str | os.PathLike],
           destino: str | os.PathLike) -> pathlib.Path:
    if not caminhos:
        raise ValueError("nenhum arquivo para juntar")
    novo = pymupdf.open()
    try:
        for caminho in caminhos:
            with _abrir_como_pdf(caminho) as origem:
                if origem.needs_pass:
                    raise ValueError(
                        f"{pathlib.Path(caminho).name} é protegido por senha.")
                novo.insert_pdf(origem)
        destino = pathlib.Path(destino)
        novo.save(destino, garbage=3, deflate=True)
    finally:
        novo.close()
    return destino


def ler_intervalos(texto: str, total: int) -> list[list[int]]:
    """"1-3, 5, 8-" -> [[0,1,2], [4], [7..total-1]]. Cada parte vira um grupo.

    Levanta ValueError com mensagem legivel para o usuario."""
    grupos: list[list[int]] = []
    for parte in texto.replace(";", ",").split(","):
        parte = parte.strip()
        if not parte:
            continue
        try:
            if "-" in parte:
                a, b = (s.strip() for s in parte.split("-", 1))
                inicio = int(a) if a else 1
                fim = int(b) if b else total
            else:
                inicio = fim = int(parte)
        except ValueError:
            raise ValueError(f"Intervalo inválido: “{parte}”.") from None
        if not (1 <= inicio <= fim <= total):
            raise ValueError(
                f"Intervalo fora do documento (1 a {total}): “{parte}”.")
        grupos.append(list(range(inicio - 1, fim)))
    if not grupos:
        raise ValueError("Nenhum intervalo informado.")
    return grupos


def dividir(d: Documento, pasta: str | os.PathLike, *,
            a_cada: int | None = None,
            intervalos: str | None = None) -> list[pathlib.Path]:
    """Divide em varios arquivos: a cada N paginas, ou por intervalos."""
    if a_cada:
        grupos = [list(range(i, min(i + a_cada, d.paginas)))
                  for i in range(0, d.paginas, a_cada)]
    elif intervalos:
        grupos = ler_intervalos(intervalos, d.paginas)
    else:
        raise ValueError("informe a_cada ou intervalos")
    pasta = pathlib.Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    base = pathlib.Path(d.nome).stem
    saidas = []
    for grupo in grupos:
        rotulo = (f"{grupo[0] + 1}" if len(grupo) == 1
                  else f"{grupo[0] + 1}-{grupo[-1] + 1}")
        saidas.append(extrair(d, grupo, pasta / f"{base}_p{rotulo}.pdf"))
    return saidas
