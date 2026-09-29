"""Marcadores (sumario lateral) e links.

O sumario e' tratado como uma LISTA PLANA de (nivel, titulo, pagina base 0),
na ordem de leitura -- o mesmo formato do `get_toc` do PyMuPDF, so' que base
0. A arvore da interface e' so' a exibicao dessa lista. Um nivel so' pode ser
no maximo um a mais que o do item anterior; `normalizar` garante isso antes de
gravar, porque o `set_toc` recusa a lista inteira por um item fora da regra.
"""

from __future__ import annotations

import dataclasses
import re

import pymupdf

from .documento import Documento


@dataclasses.dataclass
class Marcador:
    nivel: int
    titulo: str
    pagina: int          # base 0


def ler(d: Documento) -> list[Marcador]:
    return [Marcador(nivel, titulo, max(0, pagina - 1))
            for nivel, titulo, pagina, *_ in d.doc.get_toc(simple=True)]


def normalizar(lista: list[Marcador]) -> list[Marcador]:
    saida = []
    anterior = 0
    for m in lista:
        nivel = max(1, min(m.nivel, anterior + 1))
        saida.append(Marcador(nivel, m.titulo, m.pagina))
        anterior = nivel
    return saida


def gravar(d: Documento, lista: list[Marcador],
           descricao: str = "Editar marcadores") -> None:
    lista = normalizar(lista)
    total = d.paginas
    with d.operacao(descricao):
        d.doc.set_toc([[m.nivel, m.titulo, min(max(m.pagina, 0), total - 1) + 1]
                       for m in lista])


def adicionar(d: Documento, titulo: str, pagina: int,
              depois_de: int | None = None) -> int:
    """Insere um marcador (no nivel do anterior). Devolve o indice dele."""
    lista = ler(d)
    if depois_de is None:
        # Na ordem das paginas: depois do ultimo marcador que aponta para
        # uma pagina anterior ou igual.
        pos = sum(1 for m in lista if m.pagina <= pagina)
    else:
        pos = depois_de + 1
    nivel = lista[pos - 1].nivel if pos > 0 and lista else 1
    lista.insert(pos, Marcador(nivel, titulo, pagina))
    gravar(d, lista, "Adicionar marcador")
    return pos


def renomear(d: Documento, indice: int, titulo: str) -> None:
    lista = ler(d)
    lista[indice].titulo = titulo
    gravar(d, lista, "Renomear marcador")


def excluir(d: Documento, indice: int) -> None:
    """Exclui o marcador e sobe um nivel os filhos dele."""
    lista = ler(d)
    removido = lista.pop(indice)
    for m in lista[indice:]:
        if m.nivel <= removido.nivel:
            break
        m.nivel -= 1
    gravar(d, lista, "Excluir marcador")


def mover(d: Documento, indice: int, passo: int) -> int:
    lista = ler(d)
    novo = indice + passo
    if not (0 <= novo < len(lista)):
        return indice
    lista[indice], lista[novo] = lista[novo], lista[indice]
    gravar(d, lista, "Mover marcador")
    return novo


def mudar_nivel(d: Documento, indice: int, passo: int) -> None:
    lista = ler(d)
    lista[indice].nivel = max(1, lista[indice].nivel + passo)
    gravar(d, lista, "Mudar nível do marcador")


# -- links --------------------------------------------------------------------
@dataclasses.dataclass
class Link:
    pagina: int
    rect: pymupdf.Rect
    destino_pagina: int | None     # base 0, links internos
    url: str | None
    xref: int


def _numeros(texto: str) -> list[float]:
    return [float(n) for n in re.findall(r"[-+]?\d*\.?\d+", texto)]


def links(d: Documento, pagina: int) -> list[Link]:
    """Links da pagina, lidos DIRETO dos objetos do PDF.

    Nao usa `page.get_links()`: se outro objeto Page da mesma pagina estiver
    vivo (uma variavel qualquer segurando `doc[i]`), o MuPDF reaproveita a
    pagina ja' carregada e devolve a lista de links de ANTES da ultima
    alteracao -- o link criado some da leitura, embora esteja no arquivo
    (reproduzido no teste de interface). As chaves do PDF nao tem cache."""
    doc = d.doc
    p = doc[pagina]
    matriz = p.transformation_matrix
    paginas_por_xref = {doc.page_xref(i): i for i in range(doc.page_count)}
    tipo, valor = doc.xref_get_key(p.xref, "Annots")
    if tipo == "xref":
        valor = doc.xref_object(int(valor.split()[0]), compressed=True)
    elif tipo != "array":
        return []
    lista = []
    for ref in re.findall(r"(\d+) 0 R", valor):
        xref = int(ref)
        if doc.xref_get_key(xref, "Subtype")[1] != "/Link":
            continue
        numeros = _numeros(doc.xref_get_key(xref, "Rect")[1])
        if len(numeros) != 4:
            continue
        rect = pymupdf.Rect(numeros) * matriz
        rect.normalize()
        url = destino = None
        acao_tipo = doc.xref_get_key(xref, "A/S")[1]
        if acao_tipo == "/URI":
            url = doc.xref_get_key(xref, "A/URI")[1].strip("()")
        else:
            dest = doc.xref_get_key(xref, "Dest")[1]
            if acao_tipo == "/GoTo":
                dest = doc.xref_get_key(xref, "A/D")[1]
            alvo = re.match(r"\[?\s*(\d+) 0 R", dest or "")
            if alvo:
                destino = paginas_por_xref.get(int(alvo.group(1)))
        lista.append(Link(pagina=pagina, rect=rect, destino_pagina=destino,
                          url=url, xref=xref))
    return lista


def link_em(d: Documento, pagina: int, ponto: pymupdf.Point) -> Link | None:
    for l in links(d, pagina):
        if pymupdf.Point(ponto) in l.rect:
            return l
    return None


def criar_link(d: Documento, pagina: int, rect: pymupdf.Rect, *,
               url: str | None = None, destino: int | None = None) -> None:
    if bool(url) == (destino is not None):
        raise ValueError("Informe um endereço ou uma página de destino.")
    if url:
        url = url.strip()
        if not url.lower().startswith(("http://", "https://", "mailto:")):
            if "@" in url and " " not in url:
                url = "mailto:" + url
            else:
                url = "https://" + url
        link = {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(rect),
                "uri": url}
    else:
        if not (0 <= destino < d.paginas):
            raise ValueError(f"Página de destino fora do documento "
                             f"(1 a {d.paginas}).")
        link = {"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(rect),
                "page": destino, "to": pymupdf.Point(0, 0)}
    with d.operacao("Criar link"):
        p = d.doc[pagina]
        p.insert_link(link)


def excluir_link(d: Documento, pagina: int, rect: pymupdf.Rect) -> None:
    alvo = pymupdf.Rect(rect)
    achado = next((l for l in links(d, pagina)
                   if abs(l.rect.x0 - alvo.x0) < 0.5
                   and abs(l.rect.y0 - alvo.y0) < 0.5
                   and abs(l.rect.x1 - alvo.x1) < 0.5
                   and abs(l.rect.y1 - alvo.y1) < 0.5), None)
    if achado is None:
        raise LookupError("link não encontrado")
    with d.operacao("Excluir link"):
        doc = d.doc
        p = doc[pagina]
        tipo, valor = doc.xref_get_key(p.xref, "Annots")
        if tipo == "xref":
            valor = doc.xref_object(int(valor.split()[0]), compressed=True)
        restantes = [r for r in re.findall(r"(\d+) 0 R", valor)
                     if int(r) != achado.xref]
        doc.xref_set_key(p.xref, "Annots",
                         "[" + " ".join(f"{r} 0 R" for r in restantes) + "]")
