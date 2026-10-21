"""Editar texto existente."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, checa_levanta, pdf_texto, resumir,
                       secao, texto_da_pagina)

import pymupdf

from editpdfree import texto
from editpdfree.documento import Documento

LINHAS = ["Nome: Fulano de Tal", "Cidade: Florianópolis",
          "Valor total: R$ 100,00"]


def editar_linha() -> None:
    secao("editar uma linha")
    d = Documento(dados=pdf_texto([LINHAS]))
    t = texto.trecho_em(d, 0, pymupdf.Point(90, 96))
    checa(t is not None, "acha a linha sob o ponto")
    checa_igual(t.texto, "Nome: Fulano de Tal", "texto da linha inteira")
    checa(abs(t.tamanho - 12) < 0.1, "tamanho da fonte original")
    checa(t.horizontal, "linha horizontal")
    checa_igual(texto.fonte_base14(t), "helv", "Helvetica -> helv")
    texto.substituir_trecho(d, t, "Nome: Beltrano Ação")
    conteudo = texto_da_pagina(d, 0)
    checa("Nome: Beltrano Ação" in conteudo, "texto novo esta' no PDF")
    checa("Fulano" not in conteudo, "texto antigo saiu de verdade")
    checa("Cidade: Florianópolis" in conteudo,
          "a linha de baixo nao foi arrancada")
    checa("Valor total" in conteudo, "a terceira linha continua")
    novo = texto.trecho_em(d, 0, pymupdf.Point(90, 96))
    checa(novo is not None and abs(novo.origem.y - 100) < 0.5,
          "texto novo na mesma linha de base")
    checa(texto.trecho_em(d, 0, pymupdf.Point(500, 700)) is None,
          "ponto sem texto devolve None")
    d.desfazer()
    checa("Fulano" in texto_da_pagina(d, 0), "desfazer devolve o texto antigo")
    # Apagar a linha (texto vazio)
    t = texto.trecho_em(d, 0, pymupdf.Point(90, 120))
    texto.substituir_trecho(d, t, "")
    checa("Cidade" not in texto_da_pagina(d, 0), "texto vazio apaga a linha")
    # Tamanho e cor novos
    t = texto.trecho_em(d, 0, pymupdf.Point(90, 144))
    texto.substituir_trecho(d, t, "Valor total: R$ 250,00", tamanho=16,
                            cor=(1, 0, 0))
    t2 = texto.trecho_em(d, 0, pymupdf.Point(90, 142))
    checa(t2 is not None and abs(t2.tamanho - 16) < 0.1, "tamanho novo")
    checa(t2 is not None and t2.cor == (1.0, 0.0, 0.0), "cor nova")


def fontes() -> None:
    secao("fonte parecida")
    base = dict(pagina=0, rect=pymupdf.Rect(0, 0, 1, 1),
                origem=pymupdf.Point(0, 0), texto="x", tamanho=10,
                cor=(0, 0, 0), horizontal=True)
    casos = [("Times-Bold", 4 | 16, "tibo"), ("Arial-ItalicMT", 2, "heit"),
             ("CourierNew", 8, "coro"), ("Calibri", 0, "helv"),
             ("Georgia-BoldItalic", 4 | 16 | 2, "tibi")]
    for fonte, flags, esperado in casos:
        t = texto.Trecho(fonte=fonte, flags=flags, **base)
        checa_igual(texto.fonte_base14(t), esperado, f"{fonte} -> {esperado}")


def substituir_tudo() -> None:
    secao("substituir em todo o documento")
    d = Documento(dados=pdf_texto([["Contrato com ACME", "ACME paga"],
                                   ["Assinado por ACME"]]))
    n = texto.substituir_em_tudo(d, "ACME", "Globex")
    checa_igual(n, 3, "tres ocorrencias")
    tudo = texto.extrair_texto(d)
    checa("ACME" not in tudo, "nenhuma ocorrencia antiga")
    checa_igual(tudo.count("Globex"), 3, "tres ocorrencias novas")
    checa_igual(len(d._desfazer), 1, "um so' desfazer para tudo")
    checa_igual(texto.substituir_em_tudo(d, "inexistente", "x"), 0,
                "nada a substituir")


def vertical() -> None:
    secao("texto nao horizontal")
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text((200, 300), "Vertical", fontsize=12, rotate=90)
    d = Documento(dados=doc.tobytes())
    caixa = d.doc[0].search_for("Vertical")[0]
    t = texto.trecho_em(d, 0, pymupdf.Point((caixa.x0 + caixa.x1) / 2,
                                            (caixa.y0 + caixa.y1) / 2))
    checa(t is not None and not t.horizontal, "detecta texto vertical")
    if t is not None:
        checa_levanta(ValueError, texto.substituir_trecho,
                      "recusa editar texto vertical", d, t, "x")


def _linhas(d: Documento) -> list[str]:
    return [l for l in texto_da_pagina(d, 0).split(chr(10)) if l.strip()]


def selecao() -> None:
    secao("editar so' a parte selecionada")
    checa_igual(texto.diferenca("Valor: 100,00", "Valor: 290,00"),
                (7, 9, "29"), "diferenca: so' o miolo")
    checa_igual(texto.diferenca("abc", "abc"), (3, 3, ""), "sem mudanca")
    d = Documento(dados=pdf_texto([["Linha de cima", "Valor: R$ 100,00 por mês",
                                    "Linha de baixo"]]))
    t = texto.trecho_em(d, 0, pymupdf.Point(90, 120))
    i = t.texto.index("100,00")
    k = t.caracteres
    sel = texto.trecho_em(d, 0, pymupdf.Point((k[i].x0 + k[i].x1) / 2 - 0.5, 120),
                          pymupdf.Point((k[i + 5].x0 + k[i + 5].x1) / 2 + 0.5,
                                        120))
    checa_igual(sel.selecionado, "100,00", "arrasto seleciona so' o valor")
    checa(sel.parcial, "selecao parcial")
    r = texto.substituir_trecho(d, sel, "1.250,00")
    checa(r.alterou and r.faltando == "", "editado sem letra faltando")
    linhas = _linhas(d)
    checa("Valor: R$ 1.250,00 por mês" in linhas,
          f"linha inteira e continua: {linhas}")
    checa("Linha de cima" in linhas and "Linha de baixo" in linhas,
          "vizinhas intactas")
    depois = texto.trecho_em(d, 0, pymupdf.Point(90, 120))
    checa(abs(depois.origem.x - t.origem.x) < 0.01, "o comeco nao andou")
    n = len(d._desfazer)
    t = texto.trecho_em(d, 0, pymupdf.Point(90, 120))
    checa(not texto.substituir_trecho(d, t, t.texto).alterou,
          "sem mudanca: nada feito")
    checa_igual(len(d._desfazer), n, "sem mudanca nao entra no desfazer")


def fonte_embutida() -> None:
    secao("fonte embutida preservada")
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_font(fontname="F0", fontbuffer=pymupdf.Font("tiro").buffer)
    p.insert_text((72, 100), "Contrato: Summit 27, tema a definir.",
                  fontname="F0", fontsize=10.6)
    p.insert_text((72, 114), "Segunda linha intacta", fontname="F0",
                  fontsize=10.6)
    d = Documento(dados=doc.tobytes())
    t = texto.trecho_em(d, 0, pymupdf.Point(100, 97))
    original = t.fonte
    i = t.texto.index("27")
    t = texto.com_selecao(t, i, i + 2)
    r = texto.substituir_trecho(d, t, "2027 — edição única")
    checa_igual(r.faltando, "", "a Times completa tem tudo")
    linhas = _linhas(d)
    checa("Contrato: Summit 2027 — edição única, tema a definir." in linhas,
          f"texto novo na linha: {linhas}")
    checa("Segunda linha intacta" in linhas, "linha de baixo intacta")
    depois = texto.trecho_em(d, 0, pymupdf.Point(100, 97))
    checa_igual({e.fonte for e in depois.estilos}, {original},
                "toda a linha na fonte original")
    checa(all(abs(e.tamanho - 10.6) < 0.01 for e in depois.estilos),
          "tamanho exato preservado")
    t = texto.trecho_em(d, 0, pymupdf.Point(100, 111))
    r = texto.substituir_trecho(d, t, t.texto + " ★")
    checa_igual(r.faltando, "★", "letra sem glifo e' avisada")


def main() -> int:
    editar_linha()
    selecao()
    fonte_embutida()
    fontes()
    substituir_tudo()
    vertical()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
