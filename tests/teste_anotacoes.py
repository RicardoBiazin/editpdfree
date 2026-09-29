"""Anotacoes: criar, persistir, mover e excluir -- tambem em pagina girada."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, checa_levanta, pasta_temporaria,
                       pdf_texto, resumir, secao)

import pymupdf

from editpdfree import anotacoes
from editpdfree.anotacoes import Estilo
from editpdfree.documento import Documento


def tipos(d, i=0) -> list[str]:
    p = d.doc[i]
    return [a.type[1] for a in p.annots()]


def criar_e_persistir() -> None:
    secao("criar e persistir")
    with pasta_temporaria() as pasta:
        arquivo = pasta / "a.pdf"
        arquivo.write_bytes(pdf_texto([["Primeira linha de texto",
                                        "Segunda linha de texto"]]))
        d = Documento(arquivo)
        e = Estilo(cor=(0, 0, 1), espessura=3, opacidade=0.5)
        anotacoes.texto_livre(d, 0, pymupdf.Rect(72, 300, 300, 330),
                              "Olá, ação!", e)
        anotacoes.nota(d, 0, pymupdf.Point(400, 100), "uma nota", e)
        ok = anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 85, 200, 104),
                                    "destacar", e)
        checa(ok, "destacar encontra texto")
        checa(anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 110, 200, 128),
                                     "sublinhar", e), "sublinhar")
        checa(anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 110, 200, 128),
                                     "tachar", e), "tachar")
        n = len(d._desfazer)
        checa(not anotacoes.marcar_texto(d, 0, pymupdf.Rect(300, 600, 400, 700),
                                         "destacar", e),
              "destacar area vazia devolve False")
        checa_igual(len(d._desfazer), n, "... e nao cria desfazer vazio")
        anotacoes.caneta(d, 0, [[pymupdf.Point(100, 400), pymupdf.Point(150, 420),
                                 pymupdf.Point(200, 400)]], e)
        for forma in ("retangulo", "elipse", "linha", "seta"):
            anotacoes.forma(d, 0, forma, pymupdf.Point(100, 500),
                            pymupdf.Point(200, 560), e)
        esperado = ["FreeText", "Text", "Highlight", "Underline", "StrikeOut",
                    "Ink", "Square", "Circle", "Line", "Line"]
        checa_igual(tipos(d), esperado, "todas as anotacoes criadas")
        d.salvar()
        with pymupdf.open(arquivo) as c:
            p = c[0]
            checa_igual([a.type[1] for a in p.annots()], esperado,
                        "anotacoes persistem no arquivo")
            destaque = [a for a in p.annots() if a.type[1] == "Highlight"][0]
            checa_igual(tuple(round(x, 2) for x in destaque.colors["stroke"]),
                        (0.0, 0.0, 1.0), "cor do destaque")
            checa(abs(destaque.opacity - 0.5) < 0.01, "opacidade do destaque")
            seta = [a for a in p.annots() if a.type[1] == "Line"][1]
            checa_igual(seta.line_ends[1], pymupdf.PDF_ANNOT_LE_CLOSED_ARROW,
                        "a seta tem ponta")
            livre = p.annots().__next__()
            checa("Olá, ação!" in livre.info["content"],
                  "texto livre com acento preservado")


def mover_excluir() -> None:
    secao("mover e excluir")
    d = Documento(dados=pdf_texto([["Texto"]]))
    e = Estilo()
    anotacoes.forma(d, 0, "retangulo", pymupdf.Point(100, 100),
                    pymupdf.Point(200, 150), e)
    anotacoes.caneta(d, 0, [[pymupdf.Point(300, 300), pymupdf.Point(350, 320)]],
                     e)
    anotacoes.forma(d, 0, "linha", pymupdf.Point(100, 400),
                    pymupdf.Point(200, 400), e)
    p = d.doc[0]
    ret, tinta, linha = list(p.annots())
    r0 = pymupdf.Rect(ret.rect)
    anotacoes.mover_anotacao(d, 0, ret.xref, 50, 20)
    p = d.doc[0]
    r1 = p.load_annot(ret.xref).rect
    checa(abs(r1.x0 - r0.x0 - 50) < 0.5 and abs(r1.y0 - r0.y0 - 20) < 0.5,
          "retangulo deslocado (50, 20)")
    # O DESENHO tambem foi: a borda vermelha aparece no lugar novo e nao no
    # antigo (mexer so' no /Rect sem a aparencia acompanhar seria o defeito).
    pix = p.get_pixmap(alpha=False)
    vermelho = lambda x, y: pix.pixel(int(x), int(y))[0] > 150 and         pix.pixel(int(x), int(y))[1] < 100
    checa(vermelho(r1.x0 + 1, (r1.y0 + r1.y1) / 2),
          "a borda e' desenhada na posicao nova")
    checa(not vermelho(r0.x0 + 1, (r0.y0 + r0.y1) / 2 - 20),
          "e nao ficou nada na posicao antiga")
    v0 = tinta.vertices[0][0]
    anotacoes.mover_anotacao(d, 0, tinta.xref, 10, 10)
    p = d.doc[0]
    v1 = p.load_annot(tinta.xref).vertices[0][0]
    checa(abs(v1[0] - v0[0] - 10) < 0.5 and abs(v1[1] - v0[1] - 10) < 0.5,
          "desenho a mao livre: os vertices se movem, nao so' a caixa")
    anotacoes.mover_anotacao(d, 0, linha.xref, 0, 30)
    p = d.doc[0]
    l1 = p.load_annot(linha.xref)
    checa(abs(l1.vertices[0][1] - 430) < 0.5, "linha: os pontos se movem")
    checa(abs(l1.rect.y0 - 430) < 10, "linha: a caixa acompanha os pontos")
    anotacao = anotacoes.anotacao_em(p, pymupdf.Point(170, 140))
    checa(anotacao is not None and anotacao.xref == ret.xref,
          "anotacao_em acha o retangulo pelo ponto")
    checa(anotacoes.anotacao_em(p, pymupdf.Point(500, 700)) is None,
          "anotacao_em em area vazia")
    anotacoes.excluir_anotacao(d, 0, ret.xref)
    checa_igual(len(list(d.doc[0].annots())), 2, "excluir anotacao")
    d.desfazer()
    checa_igual(len(list(d.doc[0].annots())), 3, "desfazer a exclusao")
    checa_levanta(LookupError, anotacoes.excluir_anotacao,
                  "excluir xref inexistente", d, 0, 99999)
    anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 85, 200, 104), "destacar", e)
    destaque = [a for a in d.doc[0].annots() if a.type[1] == "Highlight"][0]
    checa_levanta(ValueError, anotacoes.mover_anotacao,
                  "marcacao de texto nao se move", d, 0, destaque.xref, 5, 5)


def pagina_girada() -> None:
    secao("pagina girada")
    d = Documento(dados=pdf_texto([["Texto em pagina girada"]],
                                  rotacoes=[90]))
    e = Estilo()
    checa(anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 85, 300, 104),
                                 "destacar", e),
          "destacar em pagina girada (coordenadas PDF)")
    img = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 40), False)
    img.clear_with(0)
    anotacoes.imagem(d, 0, pymupdf.Rect(100, 300, 200, 400),
                     dados=img.tobytes("png"))
    p = d.doc[0]
    info = p.get_image_info()
    checa_igual(len(info), 1, "imagem inserida em pagina girada")
    # A imagem e' 20x40 (retrato). Numa pagina girada 90 graus, para o LEITOR
    # continuar vendo-a em retrato, no espaco PDF ela ocupa uma caixa deitada.
    caixa = pymupdf.Rect(info[0]["bbox"])
    checa(caixa.width > caixa.height,
          "imagem contra a rotacao: retrato para o leitor")


def main() -> int:
    criar_e_persistir()
    mover_excluir()
    pagina_girada()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
