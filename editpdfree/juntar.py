"""Juntar varios arquivos num PDF so', na ordem escolhida.

Cada item ("fonte") pode ser um arquivo em disco (PDF, imagem, Office...) ou
um documento ja' aberto no programa -- neste caso entram os bytes ATUAIS,
com as edicoes ainda nao salvas. Cada fonte aceita um intervalo de paginas
("1-3, 5"; vazio = todas).

Os marcadores (sumario) de cada arquivo sao preservados e remapeados para a
posicao nova; com `marcadores=True`, cada arquivo ganha ainda um marcador de
primeiro nivel com o nome dele, e o sumario original fica por baixo.
"""

from __future__ import annotations

import dataclasses
import os
import pathlib
import re
import unicodedata
from typing import Sequence

import pymupdf

from .documento import SenhaNecessaria
from .paginas import ler_intervalos


@dataclasses.dataclass
class Fonte:
    nome: str
    dados: bytes                      # sempre PDF (ja' convertido)
    paginas: int
    caminho: pathlib.Path | None = None
    modificado_em: float = 0.0
    intervalo: str = ""
    senha: str | None = None

    def indices(self) -> list[int]:
        """Paginas escolhidas, base 0, na ordem do intervalo."""
        if not self.intervalo.strip():
            return list(range(self.paginas))
        saida: list[int] = []
        for grupo in ler_intervalos(self.intervalo, self.paginas):
            saida.extend(grupo)
        return saida


def _abrir(dados: bytes, senha: str | None) -> pymupdf.Document:
    doc = pymupdf.open(stream=dados, filetype="pdf")
    if doc.needs_pass and not (senha and doc.authenticate(senha)):
        doc.close()
        raise SenhaNecessaria()
    return doc


def carregar(caminho: str | os.PathLike, senha: str | None = None) -> Fonte:
    """Le o arquivo (convertendo se nao for PDF) e conta as paginas.

    Levanta SenhaNecessaria se o PDF pedir senha e ela nao servir."""
    from .conversao import para_pdf
    caminho = pathlib.Path(caminho)
    dados = para_pdf(caminho)
    with _abrir(dados, senha) as doc:
        paginas = doc.page_count
    return Fonte(nome=caminho.name, dados=dados, paginas=paginas,
                 caminho=caminho, modificado_em=caminho.stat().st_mtime,
                 senha=senha)


def de_documento(nome: str, doc: pymupdf.Document) -> Fonte:
    """Fonte a partir de um documento aberto (com as edicoes nao salvas)."""
    dados = doc.tobytes(garbage=0, encryption=pymupdf.PDF_ENCRYPT_NONE)
    return Fonte(nome=nome, dados=dados, paginas=doc.page_count)


def _chave_natural(nome: str) -> list:
    """"doc2" antes de "doc10", sem diferenciar maiusculas nem acentos."""
    base = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore")
    base = base.decode().lower()
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", base)]


def ordenar_por_nome(fontes: Sequence[Fonte]) -> list[Fonte]:
    return sorted(fontes, key=lambda f: _chave_natural(f.nome))


def ordenar_por_data(fontes: Sequence[Fonte]) -> list[Fonte]:
    """Mais antigo primeiro. Documentos abertos (sem data) vao para o fim,
    na ordem em que estavam."""
    return sorted(fontes, key=lambda f: (f.modificado_em == 0,
                                         f.modificado_em))


def juntar(fontes: Sequence[Fonte], *, marcadores: bool = False) -> bytes:
    if len(fontes) < 1:
        raise ValueError("Adicione arquivos para juntar.")
    for f in fontes:
        f.indices()                       # valida os intervalos antes de tudo
    novo = pymupdf.open()
    sumario: list[list] = []
    try:
        for f in fontes:
            with _abrir(f.dados, f.senha) as origem:
                indices = f.indices()
                inicio = novo.page_count
                # Mapa pagina antiga -> nova, para remapear o sumario.
                mapa = {antiga: inicio + n for n, antiga in enumerate(indices)}
                # Faixas continuas numa chamada so': copiar pagina a pagina
                # multiplicaria os recursos compartilhados (fontes, imagens).
                for a, b in _faixas(indices):
                    novo.insert_pdf(origem, from_page=a, to_page=b,
                                    annots=True, widgets=True)
                deslocamento = 1 if marcadores else 0
                if marcadores:
                    sumario.append([1, pathlib.Path(f.nome).stem, inicio + 1])
                for nivel, titulo, pagina, *_ in origem.get_toc(simple=True):
                    if pagina - 1 in mapa:
                        sumario.append([nivel + deslocamento, titulo,
                                        mapa[pagina - 1] + 1])
        if sumario:
            try:
                novo.set_toc(_normalizar(sumario))
            except Exception:                       # noqa: BLE001
                pass            # sumario de origem invalido: segue sem ele
        return novo.tobytes(garbage=3, deflate=True)
    finally:
        novo.close()


def _faixas(indices: list[int]) -> list[tuple[int, int]]:
    """[0,1,2,5,4] -> [(0,2), (5,5), (4,4)]: so' junta o que e' crescente e
    continuo -- a ordem pedida manda ("5, 1-3" copia a 5 antes)."""
    faixas: list[tuple[int, int]] = []
    for i in indices:
        if faixas and i == faixas[-1][1] + 1:
            faixas[-1] = (faixas[-1][0], i)
        else:
            faixas.append((i, i))
    return faixas


def _normalizar(sumario: list[list]) -> list[list]:
    """set_toc recusa salto de nivel (1 -> 3) e o primeiro item fora do 1."""
    saida, anterior = [], 0
    for nivel, titulo, pagina in sumario:
        nivel = max(1, min(nivel, anterior + 1))
        saida.append([nivel, titulo, pagina])
        anterior = nivel
    return saida
