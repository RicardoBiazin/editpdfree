"""Comprimir: tres niveis, estimativa sem mexer no documento, dialogo."""

from __future__ import annotations

import random
import sys

from ajudantes import (checa, checa_igual, checa_levanta, drenar_eventos,
                       pdf_texto, preparar_qt, pular, resumir, secao)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

import pymupdf

from editpdfree import extras
from editpdfree.documento import Documento


def pdf_com_fotos(paginas: int = 2) -> bytes:
    """Imagens de ruido (nao comprimem sozinhas) em alta resolucao."""
    random.seed(7)
    doc = pymupdf.open()
    for _ in range(paginas):
        p = doc.new_page()
        amostras = bytes(random.getrandbits(8) for _ in range(900 * 900 * 3))
        pix = pymupdf.Pixmap(pymupdf.csRGB, 900, 900, amostras, False)
        p.insert_image(pymupdf.Rect(72, 72, 372, 372), pixmap=pix)
        p.insert_text((72, 420), "Legenda da foto", fontsize=12)
    return doc.tobytes(deflate=True)


def main() -> int:
    secao("niveis")
    checa_igual(list(extras.NIVEIS_COMPRESSAO), ["leve", "media", "forte"],
                "tres niveis na ordem")
    dpis = [n["dpi"] for n in extras.NIVEIS_COMPRESSAO.values()]
    checa(dpis == sorted(dpis, reverse=True), "cada nivel reduz mais que o anterior")

    d = Documento(dados=pdf_com_fotos())
    def estado(doc):
        return (len(doc.para_bytes()), doc.doc[0].get_image_info()[0]["width"],
                len(doc._desfazer), doc.modificado)
    antes = estado(d)
    tamanhos = extras.estimar_compressao(d)
    checa_igual(estado(d), antes, "estimar nao altera o documento")
    checa_igual(set(tamanhos), {"atual", "leve", "media", "forte"},
                "estimativa para os tres niveis + atual")
    checa(tamanhos["atual"] > tamanhos["leve"] > tamanhos["media"]
          > tamanhos["forte"],
          "leve > recomendada > maxima: "
          + ", ".join(f"{k} {v // 1024} KB" for k, v in tamanhos.items()))
    checa(tamanhos["forte"] < tamanhos["atual"] * 0.3,
          "maxima reduz mais de 70% num PDF de fotos")

    secao("aplicar")
    for nivel in ("leve", "media", "forte"):
        dd = Documento(dados=pdf_com_fotos())
        extras.comprimir(dd, nivel)
        real = len(dd.para_bytes())
        checa(abs(real - tamanhos[nivel]) <= tamanhos[nivel] * 0.02,
              f"{nivel}: o tamanho real bate com a estimativa "
              f"({real // 1024} x {tamanhos[nivel] // 1024} KB)")
        checa("Legenda da foto" in dd.doc[0].get_text(), f"{nivel}: texto intacto")
        checa_igual(len(dd.doc[0].get_images()), 1, f"{nivel}: imagem continua")
    dd.desfazer()
    checa(len(dd.para_bytes()) > tamanhos["forte"] * 2, "Ctrl+Z desfaz")
    personal = Documento(dados=pdf_com_fotos())
    extras.comprimir(personal, dpi=50, qualidade=30)
    checa(len(personal.para_bytes()) < tamanhos["forte"], "personalizada (50 dpi)")
    checa_levanta(ValueError, extras.comprimir, "nivel desconhecido",
                  personal, "ultra")
    texto = Documento(dados=pdf_texto([["só texto"]]))
    t = extras.estimar_compressao(texto)
    checa(t["media"] <= t["atual"], "PDF so' de texto nao cresce")

    secao("dialogo")
    from editpdfree.interface.dialogos import DialogoComprimir, formatar_tamanho
    chamadas = []

    def estimar():
        chamadas.append(1)
        return tamanhos
    dlg = DialogoComprimir(None, estimar, tamanhos["atual"])
    drenar_eventos()
    checa_igual(len(chamadas), 1, "documento pequeno: estima sozinho ao abrir")
    checa_igual(dlg.nivel(), "media", "recomendada ja' marcada")
    checa("≈" in dlg.estimativas["forte"].text() and "−" in
          dlg.estimativas["forte"].text(),
          f"mostra o tamanho e a reducao ({dlg.estimativas['forte'].text()})")
    dlg.opcoes["forte"].setChecked(True)
    checa_igual(dlg.nivel(), "forte", "escolher a maxima")
    dlg.personalizada.setChecked(True)
    checa(dlg.nivel() is None and dlg.dpi.isEnabled(),
          "personalizada libera dpi e qualidade")
    grande = DialogoComprimir(None, estimar, 80 * 1024 * 1024)
    drenar_eventos()
    checa_igual(len(chamadas), 1, "documento grande: espera o botao")
    checa(not grande.calcular.isHidden(), "botao 'Calcular tamanhos' visivel")
    grande.estimar()
    checa_igual(len(chamadas), 2, "calcula ao clicar")
    checa_igual(formatar_tamanho(1536 * 1024), "1,5 MB", "formato de tamanho")
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
