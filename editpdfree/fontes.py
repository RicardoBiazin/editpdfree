"""Medida de texto nas fontes Base-14.

`pymupdf.get_text_length` mede ERRADO fora do ASCII: "CÓPIA" em Helvetica
negrito 26 deu 65 pt contra 82 pt reais -- o "Ó" contava zero. Centralizar ou
encaixar texto acentuado com ela deixava o texto vazando da caixa. `Font`
mede certo.
"""

from __future__ import annotations

import functools

import pymupdf


@functools.lru_cache(maxsize=None)
def _fonte(nome: str) -> pymupdf.Font:
    return pymupdf.Font(nome)


def largura(texto: str, fontname: str = "helv", fontsize: float = 11) -> float:
    return _fonte(fontname).text_length(texto, fontsize=fontsize)
