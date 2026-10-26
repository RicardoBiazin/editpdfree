"""Itens inseridos no CONTEUDO da pagina que continuam moveis.

Texto, imagem e assinatura inseridos vao para o conteudo da pagina (nao sao
anotacao: nao somem com um "excluir anotacao" e saem em qualquer leitor e
impressora). Para poderem ser arrastados depois, cada um fica num fluxo de
conteudo proprio, marcado no dicionario do fluxo:

    /EPFItem /Texto   /EPFCaixa [x0 y0 x1 y1]   (espaco do ARQUIVO, y para cima)

e comecando por ``q 1 0 0 1 tx ty cm``: mover e' so' trocar tx ty. E' o mesmo
formato da versao web -- um PDF salvo numa e' movido na outra.

Uma operacao que reescreve o conteudo da pagina inteira (tarja, editar texto)
junta os fluxos, e o item vira conteudo comum, fixo.
"""

from __future__ import annotations

import re

import pymupdf

from .documento import Documento

NOMES = {"Texto": "Texto inserido", "Imagem": "Imagem",
         "Assinatura": "Assinatura"}

_PREFIXO = re.compile(rb"^q 1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n")


def _para_arquivo(p: pymupdf.Page) -> pymupdf.Matrix:
    """Espaco PDF do PyMuPDF (sem rotacao, y para baixo) -> espaco do arquivo.

    `transformation_matrix` vai do arquivo ao espaco SEM rotacao (conferido
    numa pagina a 90 graus: compor com a `derotation_matrix` girava o
    deslocamento)."""
    return ~p.transformation_matrix


def _num(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _caixa(doc: pymupdf.Document, xref: int) -> list[float] | None:
    tipo, valor = doc.xref_get_key(xref, "EPFCaixa")
    if tipo != "array":
        return None
    try:
        return [float(v) for v in valor.strip("[]").split()]
    except ValueError:
        return None


def _tipo(doc: pymupdf.Document, xref: int) -> str | None:
    tipo, valor = doc.xref_get_key(xref, "EPFItem")
    return valor.lstrip("/") if tipo == "name" else None


def registrar(p: pymupdf.Page, antes: list[int], tipo: str,
              rect: pymupdf.Rect) -> int | None:
    """Marca como item o fluxo que a insercao acabou de criar.

    `antes`: os fluxos da pagina antes da insercao. `rect`: caixa do item no
    espaco PDF do PyMuPDF. Devolve o xref do item (None se a insercao nao
    criou um fluxo proprio)."""
    doc = p.parent
    novos = [x for x in p.get_contents() if x not in antes]
    alvo = None
    for x in novos:
        # O PyMuPDF pode acrescentar fluxos so' com "q"/"Q" ao embrulhar.
        if doc.xref_stream(x).strip() not in (b"", b"q", b"Q"):
            alvo = x
    if alvo is None:
        return None
    dados = doc.xref_stream(alvo)
    doc.update_stream(alvo, b"q 1 0 0 1 0 0 cm\n" + dados + b"\nQ\n")
    r = pymupdf.Rect(rect) * _para_arquivo(p)
    r.normalize()
    doc.xref_set_key(alvo, "EPFItem", "/" + tipo)
    doc.xref_set_key(alvo, "EPFCaixa",
                     "[%s]" % " ".join(_num(v) for v in (r.x0, r.y0, r.x1, r.y1)))
    return alvo


def listar(p: pymupdf.Page) -> list[tuple[int, str, pymupdf.Rect]]:
    """(xref, tipo, caixa no espaco PDF do PyMuPDF) de cada item, na ordem
    de desenho."""
    doc = p.parent
    volta = ~_para_arquivo(p)
    itens = []
    for x in p.get_contents():
        tipo, caixa = _tipo(doc, x), _caixa(doc, x)
        if tipo and caixa and len(caixa) == 4:
            r = pymupdf.Rect(caixa) * volta
            r.normalize()
            itens.append((x, tipo, r))
    return itens


def eh_item(p: pymupdf.Page, xref: int) -> bool:
    return any(x == xref for x, _t, _r in listar(p))


def caixa_do_item(p: pymupdf.Page, xref: int) -> pymupdf.Rect | None:
    for x, _t, r in listar(p):
        if x == xref:
            return r
    return None


def item_em(p: pymupdf.Page, ponto: pymupdf.Point,
            folga: float = 3.0) -> int | None:
    """O item sob o ponto -- o de cima, se houver varios."""
    ponto = pymupdf.Point(ponto)
    achado = None
    for x, _t, r in listar(p):
        if ponto in pymupdf.Rect(r.x0 - folga, r.y0 - folga, r.x1 + folga,
                                 r.y1 + folga):
            achado = x
    return achado


def mover(d: Documento, pagina: int, xref: int, dx: float, dy: float) -> None:
    """Desloca o item em (dx, dy) pontos (espaco PDF do PyMuPDF)."""
    if abs(dx) < 0.01 and abs(dy) < 0.01:
        return
    if not eh_item(d.doc[pagina], xref):
        raise LookupError("item não encontrado")
    with d.operacao("Mover item"):
        p = d.doc[pagina]
        doc = d.doc
        m = _para_arquivo(p)
        v = pymupdf.Point(dx, dy) * m - pymupdf.Point(0, 0) * m
        dados = doc.xref_stream(xref)
        achado = _PREFIXO.match(dados)
        if not achado:
            raise LookupError("item não encontrado")
        tx = float(achado.group(1)) + v.x
        ty = float(achado.group(2)) + v.y
        doc.update_stream(xref, b"q 1 0 0 1 %s %s cm\n" % (
            _num(tx).encode(), _num(ty).encode()) + dados[achado.end():])
        c = _caixa(doc, xref)
        doc.xref_set_key(xref, "EPFCaixa", "[%s]" % " ".join(
            _num(c[i] + (v.x if i % 2 == 0 else v.y)) for i in range(4)))


def excluir(d: Documento, pagina: int, xref: int) -> None:
    """Tira o item do conteudo da pagina."""
    if not eh_item(d.doc[pagina], xref):
        raise LookupError("item não encontrado")
    with d.operacao("Excluir item"):
        p = d.doc[pagina]
        resto = [x for x in p.get_contents() if x != xref]
        d.doc.xref_set_key(p.xref, "Contents",
                           "[%s]" % " ".join(f"{x} 0 R" for x in resto))
