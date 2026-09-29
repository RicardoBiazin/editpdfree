"""Marca d'agua, numeracao, compressao, exportacao e metadados."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, checa_levanta, paginas_numeradas,
                       pasta_temporaria, pdf_texto, resumir, secao,
                       texto_da_pagina)

import pymupdf

from editpdfree import extras
from editpdfree.documento import Documento


def marca_e_numeracao() -> None:
    secao("marca d'agua e numeracao")
    d = Documento(dados=pdf_texto([["A"], ["B"], ["C"]], rotacoes=[0, 90, 180]))
    extras.marca_dagua(d, "RASCUNHO")
    for i in range(3):
        p = d.doc[i]
        caixas = p.search_for("RASCUNHO")
        checa(caixas, f"pagina {i + 1}: marca d'agua presente")
        if caixas:
            # O centro da marca cai perto do centro da pagina.
            c = caixas[0]
            centro = pymupdf.Point((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2)
            meio = pymupdf.Point(p.mediabox.width / 2, p.mediabox.height / 2)
            checa(abs(centro - meio) < 40,
                  f"pagina {i + 1} (rotacao {p.rotation}): marca centralizada")
    checa_levanta(ValueError, extras.marca_dagua, "marca vazia recusada", d,
                  "  ")

    d2 = Documento(dados=pdf_texto([["A"], ["B"]], rotacoes=[0, 90]))
    extras.numerar(d2, formato="Página {n} de {total}")
    checa("Página 1 de 2" in texto_da_pagina(d2, 0), "numero na pagina 1")
    checa("Página 2 de 2" in texto_da_pagina(d2, 1),
          "numero na pagina 2 (girada)")
    # Na pagina girada, o numero fica no RODAPE do que o leitor ve.
    p = d2.doc[1]
    caixa = p.search_for("Página 2 de 2")[0] * p.rotation_matrix
    caixa.normalize()
    checa(caixa.y0 > p.rect.height * 0.8,
          "pagina girada: numero no rodape visual")
    checa_levanta(ValueError, extras.numerar, "formato invalido", d2,
                  formato="{x}")
    d3 = Documento(dados=paginas_numeradas(3))
    extras.numerar(d3, formato="{n}", inicio=10, posicao="superior-direita")
    checa("12" in texto_da_pagina(d3, 2), "numeracao comecando em 10")


def compressao() -> None:
    secao("compressao")
    doc = pymupdf.open()
    p = doc.new_page()
    # Imagem grande (ruido nao comprime; 1200x1200 numa area pequena = dpi alto)
    import random
    random.seed(1)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1200, 1200), False)
    amostras = bytearray(random.getrandbits(8) for _ in range(1200 * 1200 * 3))
    pix = pymupdf.Pixmap(pymupdf.csRGB, 1200, 1200, bytes(amostras), False)
    p.insert_image(pymupdf.Rect(72, 72, 272, 272), pixmap=pix)
    d = Documento(dados=doc.tobytes(deflate=True))
    antes = len(d.para_bytes())
    extras.comprimir(d, dpi=100, qualidade=60)
    depois = len(d.para_bytes())
    checa(depois < antes * 0.5, f"comprime imagem de dpi alto "
          f"({antes // 1024} KB -> {depois // 1024} KB)")


def exportar_e_metadados() -> None:
    secao("exportar e metadados")
    d = Documento(dados=paginas_numeradas(2))
    d.caminho = None
    with pasta_temporaria() as pasta:
        saidas = extras.exportar_imagens(d, pasta, dpi=50)
        checa_igual(len(saidas), 2, "uma imagem por pagina")
        checa(all(s.is_file() and s.stat().st_size > 100 for s in saidas),
              "imagens gravadas")
        jpg = extras.exportar_imagens(d, pasta / "j", dpi=40, formato="jpg",
                                      paginas=[1])
        checa(jpg[0].name.endswith("_p002.jpg"), "jpg so' da pagina 2")
    extras.definir_metadados(d, {"title": "Relatório", "author": "Eu"})
    m = extras.metadados(d)
    checa_igual((m["title"], m["author"]), ("Relatório", "Eu"), "metadados")
    n = len(d._desfazer)
    extras.definir_metadados(d, {"title": "Relatório"})
    checa_igual(len(d._desfazer), n, "metadados iguais nao criam desfazer")


def main() -> int:
    marca_e_numeracao()
    compressao()
    exportar_e_metadados()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
