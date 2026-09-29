"""Comparar duas versoes de um PDF, palavra a palavra.

A comparacao e' do documento INTEIRO como uma sequencia de palavras, e nao
pagina contra pagina: inserir um paragrafo na pagina 2 empurra o resto, e
comparar pagina a pagina marcaria tudo dali em diante como diferente.
"""

from __future__ import annotations

import dataclasses
import difflib

import pymupdf


@dataclasses.dataclass
class Palavra:
    texto: str
    pagina: int
    rect: pymupdf.Rect


@dataclasses.dataclass
class Diferenca:
    tipo: str                    # "inserido", "removido" ou "alterado"
    texto_a: str
    texto_b: str
    em_a: list[tuple[int, pymupdf.Rect]]
    em_b: list[tuple[int, pymupdf.Rect]]

    @property
    def rotulo(self) -> str:
        if self.tipo == "inserido":
            return f"+ {self.texto_b}"
        if self.tipo == "removido":
            return f"− {self.texto_a}"
        return f"{self.texto_a} → {self.texto_b}"

    def pagina_a(self) -> int | None:
        return self.em_a[0][0] if self.em_a else None

    def pagina_b(self) -> int | None:
        return self.em_b[0][0] if self.em_b else None


def palavras(doc: pymupdf.Document) -> list[Palavra]:
    lista = []
    for i in range(doc.page_count):
        for x0, y0, x1, y1, texto, *_ in doc[i].get_text("words", sort=True):
            lista.append(Palavra(texto, i, pymupdf.Rect(x0, y0, x1, y1)))
    return lista


def _normal(texto: str) -> str:
    # Pontuacao colada e caixa nao contam como mudanca de conteudo? Contam:
    # num contrato, "Não" -> "não" pode importar. So' se ignora espaco.
    return texto.strip()


def _juntar_linhas(itens: list[Palavra]) -> list[tuple[int, pymupdf.Rect]]:
    """Uma caixa por linha em vez de uma por palavra (destaque continuo)."""
    caixas: list[tuple[int, pymupdf.Rect]] = []
    for p in itens:
        if caixas:
            pag, r = caixas[-1]
            mesma_linha = (pag == p.pagina
                           and abs(r.y0 - p.rect.y0) < r.height * 0.5
                           and p.rect.x0 >= r.x0)
            if mesma_linha:
                caixas[-1] = (pag, r | p.rect)
                continue
        caixas.append((p.pagina, pymupdf.Rect(p.rect)))
    return caixas


def comparar(doc_a: pymupdf.Document,
             doc_b: pymupdf.Document) -> list[Diferenca]:
    pa, pb = palavras(doc_a), palavras(doc_b)
    ta = [_normal(p.texto) for p in pa]
    tb = [_normal(p.texto) for p in pb]
    # autojunk=False: com o padrao, palavras frequentes ("de", "a") sao
    # ignoradas como "lixo" em documentos longos e o alinhamento sai errado.
    casador = difflib.SequenceMatcher(a=ta, b=tb, autojunk=False)
    diferencas = []
    for op, a0, a1, b0, b1 in casador.get_opcodes():
        if op == "equal":
            continue
        tipo = {"insert": "inserido", "delete": "removido",
                "replace": "alterado"}[op]
        diferencas.append(Diferenca(
            tipo=tipo, texto_a=" ".join(ta[a0:a1]), texto_b=" ".join(tb[b0:b1]),
            em_a=_juntar_linhas(pa[a0:a1]), em_b=_juntar_linhas(pb[b0:b1])))
    return diferencas


COR_REMOVIDO = (0.95, 0.35, 0.35)
COR_INSERIDO = (0.3, 0.8, 0.4)


def marcar(doc: pymupdf.Document, diferencas: list[Diferenca],
           lado: str) -> pymupdf.Document:
    """Copia do documento com as diferencas destacadas (lado "a" ou "b")."""
    copia = pymupdf.open("pdf", doc.tobytes())
    cor = COR_REMOVIDO if lado == "a" else COR_INSERIDO
    for dif in diferencas:
        for pagina, rect in (dif.em_a if lado == "a" else dif.em_b):
            p = copia[pagina]
            a = p.add_highlight_annot(rect)
            a.set_colors(stroke=cor)
            a.set_info(content=dif.rotulo)
            a.update()
    return copia
