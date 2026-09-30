"""Versao, conversao de coordenadas e idioma dos textos de tela."""

from __future__ import annotations

import pathlib
import re
import sys

from ajudantes import RAIZ, checa, checa_igual, resumir, secao

import pymupdf

from editpdfree import VERSAO, coordenadas


def versao() -> None:
    secao("versao")
    texto = (RAIZ / "versao.txt").read_text("utf-8")
    numeros = tuple(int(n) for n in VERSAO.split("."))
    checa(f"filevers=({numeros[0]}, {numeros[1]}, {numeros[2]}, 0)" in texto,
          "versao.txt: filevers bate com editpdfree.VERSAO")
    checa(f"StringStruct('ProductVersion', '{VERSAO}')" in texto,
          "versao.txt: ProductVersion bate com editpdfree.VERSAO")
    checa(re.fullmatch(r"\d+\.\d+\.\d+", VERSAO), "VERSAO no formato X.Y.Z")


def coordenadas_giradas() -> None:
    secao("coordenadas nas quatro rotacoes")
    doc = pymupdf.open()
    for rotacao in (0, 90, 180, 270):
        p = doc.new_page(width=600, height=800)
        p.set_rotation(rotacao)
        zoom = 1.5
        # Ida e volta
        ponto = pymupdf.Point(123, 456)
        x, y = coordenadas.pdf_para_tela(p, ponto, zoom)
        volta = coordenadas.tela_para_pdf(p, x, y, zoom)
        checa(abs(volta.x - ponto.x) < 1e-6 and abs(volta.y - ponto.y) < 1e-6,
              f"rotacao {rotacao}: tela <-> PDF ida e volta")
        # A tela tem as dimensoes da pagina GIRADA.
        largura_tela = p.rect.width * zoom
        altura_tela = p.rect.height * zoom
        cantos = [coordenadas.tela_para_pdf(p, cx, cy, zoom)
                  for cx, cy in ((0, 0), (largura_tela, altura_tela))]
        dentro = all(-1e-6 <= c.x <= 600 + 1e-6 and -1e-6 <= c.y <= 800 + 1e-6
                     for c in cantos)
        checa(dentro, f"rotacao {rotacao}: cantos da tela caem dentro da "
                      "mediabox")
        # O que se ve renderizado bate com a conversao: um texto no PDF
        # aparece na posicao de tela prevista.
        p.insert_text((50, 60), "X", fontsize=20)
        caixa = p.search_for("X")[0]
        x0, y0, x1, y1 = coordenadas.retangulo_pdf_para_tela(p, caixa, 1.0)
        pix = p.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
        cx, cy = int((x0 + x1) / 2), int((y0 + y1) / 2)
        escuro = any(sum(pix.pixel(min(pix.width - 1, max(0, cx + dx)),
                                   min(pix.height - 1, max(0, cy + dy)))) < 300
                     for dx in range(-3, 4) for dy in range(-3, 4))
        checa(escuro, f"rotacao {rotacao}: o glifo esta' onde a conversao "
                      "diz na imagem renderizada")
        r = coordenadas.retangulo_tela_para_pdf(p, x1, y1, x0, y0, 1.0)
        checa(abs(r.x0 - caixa.x0) < 0.01 and abs(r.y1 - caixa.y1) < 0.01,
              f"rotacao {rotacao}: retangulo de cantos invertidos normaliza")
    doc.close()


_SEM_ACENTO = re.compile(
    r"\b(nao|voce|pagina|paginas|codificacao|operacao|anotacao|selecao|"
    r"formulario|numero|versao|opcao|informacao|"
    r"conteudo|possivel|invalido|invalida|protecao)\b", re.IGNORECASE)


def idioma() -> None:
    """Textos de tela em portugues ACENTUADO. Comentario e docstring podem
    ser ASCII; o que o usuario le, nao."""
    secao("idioma dos textos de tela")
    ruins = []
    for arquivo in (RAIZ / "editpdfree").rglob("*.py"):
        linhas = arquivo.read_text("utf-8").splitlines()
        em_docstring = False
        for n, linha in enumerate(linhas, 1):
            s = linha.strip()
            if s.startswith('"""') or s.startswith('r"""'):
                if not (s.count('"""') >= 2 and len(s) > 3):
                    em_docstring = not em_docstring
                continue
            if em_docstring or s.startswith("#"):
                continue
            codigo = linha.split("#", 1)[0]
            for literal in re.findall(r'"([^"\n]*)"', codigo):
                # O que esta' entre chaves num f-string e' codigo, nao texto.
                literal = re.sub(r"\{[^}]*\}", "", literal)
                if " " not in literal.strip():
                    continue          # chave, identificador, formato
                if _SEM_ACENTO.search(literal):
                    ruins.append(f"{arquivo.name}:{n}: {literal}")
    checa(not ruins, "nenhum texto de tela sem acento"
          + ("\n         " + "\n         ".join(ruins[:10]) if ruins else ""))


def main() -> int:
    versao()
    coordenadas_giradas()
    idioma()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
