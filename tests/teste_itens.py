"""Texto, imagem e assinatura inseridos continuam moveis."""

from __future__ import annotations

import sys

from ajudantes import checa, checa_igual, pdf_texto, resumir, secao, \
    texto_da_pagina

import pymupdf

from editpdfree import anotacoes, itens, texto
from editpdfree.documento import Documento


def _perto(a: float, b: float, tol: float = 0.6) -> bool:
    return abs(a - b) <= tol


def _origem(d: Documento, pagina: int, procurado: str):
    """Origem (linha de base) do primeiro caractere do texto procurado."""
    for b in d.doc[pagina].get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                t = "".join(c["c"] for c in s["chars"])
                if procurado in t:
                    return pymupdf.Point(s["chars"][t.index(procurado)]["origin"])
    return None


def texto_inserido(rotacao: int) -> None:
    secao(f"texto inserido e arrastado (pagina a {rotacao} graus)")
    d = Documento(dados=pdf_texto([["fixo"]], rotacoes=[rotacao]))
    xref = texto.inserir_texto(d, 0, pymupdf.Point(100, 200), "Ricardo Biazin",
                               tamanho=14, cor=(1, 0, 0))
    checa(isinstance(xref, int), "a insercao devolve o item")
    p = d.doc[0]
    lista = itens.listar(p)
    checa_igual([(x, t) for x, t, _r in lista], [(xref, "Texto")],
                "o texto e' um item")
    o = _origem(d, 0, "Ricardo")
    caixa = lista[0][2]
    checa(pymupdf.Rect(caixa.x0 - 1, caixa.y0 - 1, caixa.x1 + 1,
                       caixa.y1 + 1).contains(o),
          f"a caixa {caixa} contem a linha de base {o}")
    checa_igual(anotacoes.objeto_em(p, o), xref, "clicar sobre ele o acha")
    anotacoes.mover_anotacao(d, 0, xref, 50, -30)
    novo = _origem(d, 0, "Ricardo")
    checa(_perto(novo.x, o.x + 50) and _perto(novo.y, o.y - 30),
          f"o texto andou (50, -30): {o} -> {novo}")
    checa("fixo" in texto_da_pagina(d, 0), "o resto da pagina ficou")
    nova_caixa = itens.caixa_do_item(d.doc[0], xref)
    checa(_perto(nova_caixa.x0, caixa.x0 + 50)
          and _perto(nova_caixa.y0, caixa.y0 - 30), "a caixa acompanha")
    # Sobrevive a salvar e reabrir.
    d2 = Documento(dados=d.doc.tobytes(garbage=3, deflate=True))
    lista2 = itens.listar(d2.doc[0])
    checa_igual(len(lista2), 1, "o item sobrevive ao salvar")
    d.desfazer()
    volta = _origem(d, 0, "Ricardo")
    checa(_perto(volta.x, o.x) and _perto(volta.y, o.y), "desfazer volta")


def imagem_e_exclusao() -> None:
    secao("assinatura arrastada e item excluido")
    d = Documento(dados=pdf_texto([["fixo"]]))
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pix.clear_with(0)
    xref = anotacoes.imagem(d, 0, pymupdf.Rect(100, 100, 200, 200),
                            dados=pix.tobytes("png"), descricao="Assinar")
    p = d.doc[0]
    _x, tipo, caixa = itens.listar(p)[0]
    checa_igual(tipo, "Assinatura", "assinatura vira item")
    checa(_perto(caixa.y1 - caixa.y0, 50, 1), f"caixa na proporcao real {caixa}")
    anotacoes.mover_anotacao(d, 0, xref, 120, 80)
    bbox = pymupdf.Rect(d.doc[0].get_image_info()[0]["bbox"])
    checa(_perto(bbox.x0, caixa.x0 + 120, 1) and _perto(bbox.y0, caixa.y0 + 80, 1),
          f"a imagem andou: {bbox}")
    t = texto.inserir_texto(d, 0, pymupdf.Point(100, 400), "Segundo")
    anotacoes.excluir_anotacao(d, 0, xref)
    checa_igual(d.doc[0].get_image_info(), [], "a assinatura saiu")
    checa("Segundo" in texto_da_pagina(d, 0) and "fixo" in texto_da_pagina(d, 0),
          "o resto ficou")
    checa_igual([x for x, _t, _r in itens.listar(d.doc[0])], [t],
                "so' o texto continua item")


def editar_inserido(rotacao: int) -> None:
    secao(f"editar o texto inserido (pagina a {rotacao} graus)")
    d = Documento(dados=pdf_texto([["fixo"]], rotacoes=[rotacao]))
    xref = texto.inserir_texto(d, 0, pymupdf.Point(100, 200), "adadasda",
                               tamanho=14, cor=(1, 0, 0), fonte="tiro")
    checa_igual(itens.dados_texto(d.doc[0], xref),
                {"texto": "adadasda", "tamanho": 14.0, "cor": (1.0, 0.0, 0.0),
                 "fonte": "tiro"}, "o item guarda texto e estilo")
    anotacoes.mover_anotacao(d, 0, xref, 40, 10)
    antes = _origem(d, 0, "adadasda")
    novo = itens.editar_texto(d, 0, xref, "Ricardo Crocetta Biazin")
    checa("adadasda" not in texto_da_pagina(d, 0), "o texto antigo saiu")
    depois = _origem(d, 0, "Ricardo")
    checa(_perto(depois.x, antes.x) and _perto(depois.y, antes.y),
          f"no lugar do arrasto: {antes} -> {depois}")
    dados = itens.dados_texto(d.doc[0], novo)
    checa(dados["texto"] == "Ricardo Crocetta Biazin" and dados["fonte"] == "tiro"
          and dados["tamanho"] == 14.0, "continua editavel, mesmo estilo")
    itens.editar_texto(d, 0, novo, "Ricardo", tamanho=20)
    span = [s for b in d.doc[0].get_text("dict")["blocks"]
            for l in b.get("lines", []) for s in l["spans"]
            if "Ricardo" in s["text"]][0]
    checa(_perto(span["size"], 20, 0.1), "tamanho novo")
    d.desfazer()
    d.desfazer()
    checa("adadasda" in texto_da_pagina(d, 0), "desfazer volta")


def main() -> int:
    for r in (0, 90):
        texto_inserido(r)
        editar_inserido(r)
    imagem_e_exclusao()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
