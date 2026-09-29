"""Operacoes de pagina."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, checa_levanta, paginas_numeradas,
                       pasta_temporaria, primeira_linha, resumir, secao)

import pymupdf

from editpdfree import paginas
from editpdfree.documento import Documento


def ordem(d) -> list[str]:
    return [primeira_linha(d, i) for i in range(d.paginas)]


def mover_e_reordenar() -> None:
    secao("mover e reordenar")
    d = Documento(dados=paginas_numeradas(5))
    paginas.mover(d, 0, 2)
    checa_igual(ordem(d), ["Pagina 2", "Pagina 3", "Pagina 1", "Pagina 4",
                           "Pagina 5"], "mover para baixo cai na posicao pedida")
    paginas.mover(d, 2, 0)
    checa_igual(ordem(d)[0], "Pagina 1", "mover para cima")
    paginas.mover(d, 0, 4)
    checa_igual(ordem(d)[-1], "Pagina 1", "mover para a ultima posicao")
    paginas.mover(d, 4, 0)
    paginas.reordenar(d, [4, 3, 2, 1, 0])
    checa_igual(ordem(d), [f"Pagina {i}" for i in (5, 4, 3, 2, 1)],
                "reordenar aplica a permutacao")
    checa_igual(len(d._desfazer), 5, "reordenar e' um so' desfazer")
    checa_levanta(ValueError, paginas.reordenar,
                  "permutacao invalida e' recusada", d, [0, 0, 1, 2, 3])
    checa_levanta(IndexError, paginas.mover, "mover fora do documento", d, 0, 9)


def girar_excluir_duplicar() -> None:
    secao("girar, excluir, duplicar, em branco")
    d = Documento(dados=paginas_numeradas(3))
    paginas.girar(d, [0, 2], -90)
    checa_igual([d.doc[i].rotation for i in range(3)], [270, 0, 270],
                "girar a esquerda da' 270")
    paginas.excluir(d, [1])
    checa_igual(ordem(d), ["Pagina 1", "Pagina 3"], "excluir")
    checa_levanta(ValueError, paginas.excluir,
                  "nao deixa excluir todas as paginas", d, [0, 1])
    paginas.duplicar(d, 1)
    checa_igual(ordem(d), ["Pagina 1", "Pagina 3", "Pagina 3"],
                "duplicar a ultima")
    paginas.duplicar(d, 0)
    checa_igual(ordem(d)[:2], ["Pagina 1", "Pagina 1"], "duplicar a primeira")
    d2 = Documento(dados=paginas_numeradas(2))
    paginas.inserir_em_branco(d2, 1)
    checa_igual(d2.paginas, 3, "pagina em branco inserida")
    checa_igual(d2.doc[1].get_text().strip(), "", "a pagina inserida esta' vazia")
    checa_igual((round(d2.doc[1].rect.width), round(d2.doc[1].rect.height)),
                (595, 842), "em branco herda o tamanho da vizinha (A4)")
    paginas.inserir_em_branco(d2, 99)
    checa_igual(d2.paginas, 4, "posicao alem do fim insere no fim")


def arquivos() -> None:
    secao("inserir, extrair, juntar, dividir")
    with pasta_temporaria() as pasta:
        a = pasta / "a.pdf"
        b = pasta / "b.pdf"
        a.write_bytes(paginas_numeradas(3))
        doc = pymupdf.open()
        p = doc.new_page()
        p.insert_text((72, 100), "Outro arquivo")
        doc.save(b)
        doc.close()
        imagem = pasta / "img.png"
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 30), False)
        pix.clear_with(200)
        pix.save(imagem)

        d = Documento(a)
        paginas.inserir_arquivo(d, b, 1)
        checa_igual(ordem(d)[1], "Outro arquivo", "inserir PDF na posicao")
        n = paginas.inserir_arquivo(d, imagem, d.paginas)
        checa_igual((n, d.paginas), (1, 5), "imagem vira uma pagina no fim")

        saida = paginas.extrair(d, [0, 2], pasta / "ext.pdf")
        with pymupdf.open(saida) as e:
            checa_igual([e[i].get_text().strip() for i in range(e.page_count)],
                        ["Pagina 1", "Pagina 2"], "extrair as paginas pedidas")

        junto = paginas.juntar([a, b, imagem], pasta / "junto.pdf")
        with pymupdf.open(junto) as j:
            checa_igual(j.page_count, 5, "juntar PDF + PDF + imagem")
        checa_levanta(ValueError, paginas.juntar, "juntar sem arquivos", [],
                      pasta / "x.pdf")

        d3 = Documento(dados=paginas_numeradas(5))
        d3.caminho = pasta / "doc.pdf"
        partes = paginas.dividir(d3, pasta / "div", a_cada=2)
        checa_igual([p.name for p in partes],
                    ["doc_p1-2.pdf", "doc_p3-4.pdf", "doc_p5.pdf"],
                    "dividir a cada 2")
        partes = paginas.dividir(d3, pasta / "div2", intervalos="1, 2-4")
        with pymupdf.open(partes[1]) as parte:
            checa_igual(parte.page_count, 3, "dividir por intervalo")


def intervalos() -> None:
    secao("ler intervalos")
    checa_igual(paginas.ler_intervalos("1-3, 5; 7-", 8),
                [[0, 1, 2], [4], [6, 7]], "intervalos com ponto e virgula e "
                "aberto no fim")
    checa_igual(paginas.ler_intervalos("-2", 5), [[0, 1]], "aberto no inicio")
    for ruim in ("0", "3-1", "9", "a-b", "", " , "):
        checa_levanta(ValueError, paginas.ler_intervalos,
                      f"recusa {ruim!r}", ruim, 8)


def main() -> int:
    mover_e_reordenar()
    girar_excluir_duplicar()
    arquivos()
    intervalos()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
