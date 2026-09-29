"""Tarja (redacao de verdade) e senha.

**Tarja nao e' retangulo preto.** Um retangulo por cima deixa o texto no
arquivo: qualquer um seleciona, copia e cola -- e' o vazamento classico de
documento "tarjado". Aqui a area passa por `apply_redactions`, que REMOVE os
glifos do conteudo e apaga os pixels das imagens sob ela. O teste confere que
o texto sumiu de `get_text`, nao so' que a pagina ficou preta.
"""

from __future__ import annotations

from typing import Iterable

import pymupdf

from .documento import Documento

#: Permissoes padrao ao proteger: tudo, menos alterar o documento.
PERMISSOES_PADRAO = (pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_COPY
                     | pymupdf.PDF_PERM_ACCESSIBILITY
                     | pymupdf.PDF_PERM_PRINT_HQ)


def tarjar(d: Documento, areas: Iterable[tuple[int, pymupdf.Rect]], *,
           cor=(0, 0, 0)) -> int:
    """Remove definitivamente o conteudo das `areas` (pagina, retangulo PDF)."""
    por_pagina: dict[int, list[pymupdf.Rect]] = {}
    for pagina, rect in areas:
        por_pagina.setdefault(pagina, []).append(pymupdf.Rect(rect))
    if not por_pagina:
        return 0
    with d.operacao("Tarjar"):
        for pagina, rects in por_pagina.items():
            p = d.doc[pagina]
            for r in rects:
                p.add_redact_annot(r, fill=cor)
            p.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
    return sum(len(r) for r in por_pagina.values())


def tarjar_texto(d: Documento, procurado: str) -> int:
    """Tarja toda ocorrencia de `procurado` no documento (ex.: um CPF)."""
    if not procurado:
        return 0
    areas = [(i, r) for i in range(d.paginas)
             for r in d.doc[i].search_for(procurado)]
    return tarjar(d, areas)


def proteger(d: Documento, senha_abrir: str, senha_dono: str | None = None,
             permissoes: int = PERMISSOES_PADRAO) -> None:
    """Agenda criptografia AES-256 para o proximo salvar.

    Sem senha de dono, usa a de abrir -- um PDF com senha de dono vazia deixa
    qualquer leitor ignorar as permissoes."""
    if not senha_abrir and not senha_dono:
        raise ValueError("Informe ao menos uma senha.")
    d.criptografia = {
        "encryption": pymupdf.PDF_ENCRYPT_AES_256,
        "user_pw": senha_abrir or "",
        "owner_pw": senha_dono or senha_abrir,
        "permissions": permissoes,
    }
    d.modificado = True
    d.avisar()


def remover_protecao(d: Documento) -> None:
    d.criptografia = {"encryption": pymupdf.PDF_ENCRYPT_NONE}
    d.modificado = True
    d.avisar()
