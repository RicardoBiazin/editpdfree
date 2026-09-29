"""Conversao entre o espaco da tela e o espaco do PDF -- num lugar so'.

Existem TRES espacos, e confundir dois deles e' o defeito classico de editor de
PDF (aparece so' em pagina girada, que ninguem usa ao testar):

* **tela**: pixel da imagem renderizada, ja' multiplicado pelo zoom;
* **girado**: pontos PDF como o leitor ve a pagina (`page.rect`);
* **PDF**: pontos PDF *sem* a rotacao (`page.mediabox`). E' neste espaco que o
  PyMuPDF espera as anotacoes, a busca devolve os retangulos e o `get_text`
  devolve as caixas.

A renderizacao (`get_pixmap`) desenha o espaco girado. Portanto:
tela -> /zoom -> girado -> derotation_matrix -> PDF, e o caminho inverso.
"""

from __future__ import annotations

import pymupdf


def tela_para_pdf(pagina: pymupdf.Page, x: float, y: float,
                  zoom: float) -> pymupdf.Point:
    return pymupdf.Point(x / zoom, y / zoom) * pagina.derotation_matrix


def pdf_para_tela(pagina: pymupdf.Page, ponto: pymupdf.Point,
                  zoom: float) -> tuple[float, float]:
    p = pymupdf.Point(ponto) * pagina.rotation_matrix
    return p.x * zoom, p.y * zoom


def retangulo_tela_para_pdf(pagina: pymupdf.Page, x0: float, y0: float,
                            x1: float, y1: float, zoom: float) -> pymupdf.Rect:
    """Dois cantos quaisquer da tela -> retangulo normalizado no espaco PDF.

    Girar 90 graus troca quais cantos sao "superior esquerdo"; por isso os
    quatro cantos sao convertidos e o retangulo e' o que os envolve."""
    pontos = [tela_para_pdf(pagina, x, y, zoom)
              for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return pymupdf.Rect(min(p.x for p in pontos), min(p.y for p in pontos),
                        max(p.x for p in pontos), max(p.y for p in pontos))


def retangulo_pdf_para_tela(pagina: pymupdf.Page, rect: pymupdf.Rect,
                            zoom: float) -> tuple[float, float, float, float]:
    r = pymupdf.Rect(rect) * pagina.rotation_matrix
    r.normalize()
    return r.x0 * zoom, r.y0 * zoom, r.x1 * zoom, r.y1 * zoom
