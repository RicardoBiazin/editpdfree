"""Tarja de verdade e formularios."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, pasta_temporaria, pdf_texto,
                       resumir, secao, texto_da_pagina)

import pymupdf

from editpdfree import formularios, seguranca
from editpdfree.documento import Documento


def tarja() -> None:
    secao("tarja")
    d = Documento(dados=pdf_texto([["CPF: 123.456.789-00", "Nome publico"],
                                   ["Outro CPF 123.456.789-00"]]))
    caixa = d.doc[0].search_for("123.456.789-00")[0]
    n = seguranca.tarjar(d, [(0, caixa)])
    checa_igual(n, 1, "uma area tarjada")
    conteudo = texto_da_pagina(d, 0)
    checa("123.456.789-00" not in conteudo,
          "o texto tarjado SAIU do conteudo (nao e' so' um retangulo)")
    checa("Nome publico" in conteudo, "o resto da pagina continua")
    checa_igual(len(list(d.doc[0].annots())), 0,
                "nao sobra anotacao de redacao pendente")
    # O pixel no lugar e' preto.
    pix = d.doc[0].get_pixmap(alpha=False)
    cx, cy = int((caixa.x0 + caixa.x1) / 2), int((caixa.y0 + caixa.y1) / 2)
    checa_igual(pix.pixel(cx, cy), (0, 0, 0), "a area fica preta")
    n = seguranca.tarjar_texto(d, "123.456.789-00")
    checa_igual(n, 1, "tarjar por texto acha a outra ocorrencia")
    checa("123.456.789-00" not in texto_da_pagina(d, 1),
          "e remove da pagina 2")
    checa_igual(seguranca.tarjar_texto(d, "nao existe"), 0, "nada a tarjar")

    # Imagem sob a tarja perde os pixels.
    doc = pymupdf.open()
    p = doc.new_page()
    img = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), False)
    img.clear_with(255)
    for x in range(100):
        for y in range(100):
            img.set_pixel(x, y, (255, 0, 0))
    p.insert_image(pymupdf.Rect(100, 100, 300, 300), pixmap=img)
    d2 = Documento(dados=doc.tobytes())
    seguranca.tarjar(d2, [(0, pymupdf.Rect(150, 150, 250, 250))])
    with pasta_temporaria() as pasta:
        d2.salvar(pasta / "t.pdf")
        with pymupdf.open(pasta / "t.pdf") as c:
            xref = c[0].get_images()[0][0]
            extraida = pymupdf.Pixmap(c, xref)
            meio = extraida.pixel(extraida.width // 2, extraida.height // 2)
            checa(meio != (255, 0, 0),
                  "os pixels da imagem sob a tarja foram apagados no arquivo")


def formulario() -> None:
    secao("formularios")
    with pasta_temporaria() as pasta:
        arquivo = pasta / "f.pdf"
        arquivo.write_bytes(pdf_texto([["Formulario"]]))
        d = Documento(arquivo)
        formularios.criar_campo_texto(d, 0, pymupdf.Rect(72, 200, 300, 220),
                                      "nome")
        formularios.criar_caixa_selecao(d, 0, pymupdf.Rect(72, 240, 86, 254),
                                        "aceito")
        campos = formularios.campos(d)
        checa_igual([(c.nome, c.tipo_legivel) for c in campos],
                    [("nome", "Texto"), ("aceito", "Caixa de seleção")],
                    "campos criados")
        por_nome = {c.nome: c for c in campos}
        checa_igual(por_nome["aceito"].valor, False, "caixa comeca desmarcada")
        n = formularios.preencher(d, {por_nome["nome"].xref: "José da Silva",
                                      por_nome["aceito"].xref: True})
        checa_igual(n, 2, "dois campos preenchidos")
        c = formularios.campo_em(d, 0, pymupdf.Point(100, 210))
        checa(c is not None and c.nome == "nome", "campo_em pelo ponto")
        d.salvar()
        d2 = Documento(arquivo)
        valores = {c.nome: c.valor for c in formularios.campos(d2)}
        checa_igual(valores, {"nome": "José da Silva", "aceito": True},
                    "valores persistem no arquivo")
        formularios.preencher(d2, {c.xref: False for c in formularios.campos(d2)
                                   if c.nome == "aceito"})
        checa_igual({c.nome: c.valor for c in formularios.campos(d2)}["aceito"],
                    False, "desmarcar")
        formularios.achatar(d2)
        checa_igual(formularios.campos(d2), [], "achatar remove os campos")
        checa("José da Silva" in texto_da_pagina(d2, 0),
              "o valor vira texto fixo da pagina")


def main() -> int:
    tarja()
    formulario()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
