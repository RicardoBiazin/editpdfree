"""OCR: torna pesquisavel (e selecionavel, tarjavel) um PDF escaneado.

Usa o Tesseract que ja' vem compilado DENTRO do MuPDF -- nao precisa instalar
o Tesseract, so' dos arquivos de idioma (`recursos/tessdata`, versao "fast",
Apache-2.0).

Como a camada de texto entra na pagina, sem estragar o original:

1. renderiza a pagina (sem a rotacao) em 300 dpi;
2. `pdfocr_tobytes` devolve uma pagina PDF com a imagem + o texto invisivel
   (render mode 3) nas posicoes certas;
3. a imagem dessa pagina e' trocada por um pixel -- ela so' existe para o
   Tesseract, e mante-la dobraria o tamanho do arquivo;
4. a pagina de OCR e' desenhada ATRAS do conteudo original (`overlay=False`).

O leitor continua vendo o escaneado original; a busca, a selecao e a tarja
passam a enxergar o texto.
"""

from __future__ import annotations

from typing import Callable, Iterable

import pymupdf

from .documento import Documento
from .recursos_caminho import recursos

IDIOMAS = {"por": "Português", "eng": "Inglês", "por+eng": "Português + inglês"}


def pasta_tessdata() -> str:
    return str(recursos() / "tessdata")


def tem_texto(pagina: pymupdf.Page, minimo: int = 20) -> bool:
    return len(pagina.get_text().strip()) >= minimo


def _ocr_de_pagina(pagina: pymupdf.Page, idioma: str,
                   dpi: int) -> pymupdf.Document:
    rotacao = pagina.rotation
    if rotacao:
        pagina.set_rotation(0)
    try:
        # RGB, nao cinza: com pixmap em tons de cinza o `pdfocr_tobytes`
        # devolve a pagina SEM texto nenhum, sem erro (testado no 1.28.2).
        pix = pagina.get_pixmap(dpi=dpi, alpha=False, annots=False)
    finally:
        if rotacao:
            pagina.set_rotation(rotacao)
    camada = pymupdf.open("pdf", pix.pdfocr_tobytes(
        language=idioma, tessdata=pasta_tessdata()))
    pagina_ocr = camada[0]
    ponto = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 1, 1), False)
    ponto.clear_with(255)
    for imagem in pagina_ocr.get_images():
        pagina_ocr.replace_image(imagem[0], pixmap=ponto)
    return camada


def reconhecer(d: Documento, paginas: Iterable[int] | None = None, *,
               idioma: str = "por+eng", dpi: int = 300, forcar: bool = False,
               progresso: Callable[[int, int], bool] | None = None) -> int:
    """Aplica OCR. Paginas que ja' tem texto sao puladas (salvo `forcar`).

    `progresso(feitas, total)` pode devolver False para cancelar; o que ja'
    foi feito fica (e sai inteiro num so' desfazer). Devolve quantas paginas
    receberam camada de texto."""
    alvo = list(paginas) if paginas is not None else list(range(d.paginas))
    pendentes = [i for i in alvo if forcar or not tem_texto(d.doc[i])]
    if not pendentes:
        return 0
    feitas = 0
    with d.operacao("Reconhecer texto (OCR)"):
        for n, i in enumerate(pendentes):
            if progresso is not None and progresso(n, len(pendentes)) is False:
                break
            p = d.doc[i]
            camada = _ocr_de_pagina(p, idioma, dpi)
            rotacao = p.rotation
            try:
                # A camada foi feita da pagina SEM rotacao; com a rotacao zerada,
                # `p.rect` e' exatamente esse espaco.
                p.set_rotation(0)
                p.show_pdf_page(p.rect, camada, 0, overlay=False)
            finally:
                p.set_rotation(rotacao)
                camada.close()
            feitas += 1
        if progresso is not None:
            progresso(len(pendentes), len(pendentes))
    return feitas
