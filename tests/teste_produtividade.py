"""Lote, comparar, recortar, redimensionar, cabecalho/rodape, carimbos,
marcadores e links."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, checa_levanta, paginas_numeradas,
                       pasta_temporaria, pdf_texto, resumir, secao,
                       texto_da_pagina)

import pymupdf

from editpdfree import (anotacoes, comparar, extras, lote, marcadores,
                        paginas)
from editpdfree.documento import Documento


def teste_lote() -> None:
    secao("lote")
    with pasta_temporaria() as pasta:
        origem = pasta / "entrada"
        origem.mkdir()
        for n in range(3):
            (origem / f"doc{n}.pdf").write_bytes(paginas_numeradas(2))
        (origem / "quebrado.pdf").write_bytes(b"isto nao e' pdf")
        arquivos = lote.pdfs_da_pasta(origem)
        checa_igual(len(arquivos), 4, "acha os PDFs da pasta")
        chamadas = []
        res = lote.processar(
            arquivos, pasta / "saida",
            [lote.op_marca_dagua("RASCUNHO"), lote.op_numerar(formato="{n}"),
             lote.op_proteger("s3nha")],
            progresso=lambda i, t, nome: chamadas.append((i, t)) or True)
        checa_igual([r.ok for r in res], [True, True, True, False],
                    "3 ok e o quebrado falha sem parar o lote")
        checa(res[3].erro, "o erro do arquivo quebrado e' informado")
        checa_igual(chamadas[-1], (4, 4), "progresso chega ao fim")
        saida = Documento(res[0].saida, senha="s3nha")
        texto = texto_da_pagina(saida, 1)
        checa("RASCUNHO" in texto and "2" in texto,
              "marca d'agua e numeracao aplicadas")
        checa_igual(texto_da_pagina(Documento(arquivos[0]), 0).strip(),
                    "Pagina 1", "o original nao foi alterado")
        checa_levanta(ValueError, lote.processar,
                      "recusa gravar na pasta de origem", arquivos, origem,
                      [lote.op_comprimir()])
        checa_levanta(ValueError, lote.processar, "exige operacao", arquivos,
                      pasta / "x", [])


def teste_comparar() -> None:
    secao("comparar")
    a = pymupdf.open("pdf", pdf_texto([
        ["O locatário pagará o valor de mil reais",
         "até o dia cinco de cada mês"],
        ["Cláusula de rescisão sem multa"]]))
    b = pymupdf.open("pdf", pdf_texto([
        ["Parágrafo novo no começo",
         "O locatário pagará o valor de dois mil reais",
         "até o dia cinco de cada mês"],
        ["Cláusula de rescisão sem multa"]]))
    difs = comparar.comparar(a, b)
    tipos = [(x.tipo, x.texto_a, x.texto_b) for x in difs]
    # "mil" -> "dois mil" e' a INSERCAO de "dois": o "mil" continua la'.
    checa_igual(tipos, [("inserido", "", "Parágrafo novo no começo"),
                        ("inserido", "", "dois")],
                "so' o que mudou; o resto (deslocado) nao e' diferenca")
    c = pymupdf.open("pdf", pdf_texto([["O valor de mil reais"]]))
    e = pymupdf.open("pdf", pdf_texto([["O valor de cem reais"]]))
    checa_igual([(x.tipo, x.texto_a, x.texto_b)
                 for x in comparar.comparar(c, e)],
                [("alterado", "mil", "cem")], "alteracao")
    checa_igual(difs[0].pagina_b(), 0, "pagina da insercao")
    checa_igual(len(difs[0].em_b), 1, "uma caixa por linha")
    marcado = comparar.marcar(b, difs, "b")
    checa_igual(len(list(marcado[0].annots())), 2, "destaques na copia")
    checa_igual(len(list(b[0].annots())), 0, "o original nao e' marcado")
    checa_igual(comparar.comparar(a, a), [], "documento igual a si mesmo")


def teste_paginas() -> None:
    secao("recortar e redimensionar")
    d = Documento(dados=paginas_numeradas(2))
    paginas.recortar(d, [0], margens_mm=(10, 10, 10, 10))
    r = d.doc[0].rect
    checa(abs(r.width - (595 - 20 * paginas.MM)) < 0.5,
          f"margens de 10 mm recortadas ({r.width:.1f})")
    checa_igual(round(d.doc[1].rect.width), 595, "so' a pagina pedida")
    paginas.recortar(d, [1], rect=pymupdf.Rect(50, 50, 300, 400))
    checa_igual((round(d.doc[1].rect.width), round(d.doc[1].rect.height)),
                (250, 350), "recorte por retangulo")
    checa_levanta(ValueError, paginas.recortar, "recorte pequeno demais", d,
                  [0], rect=pymupdf.Rect(0, 0, 5, 5))
    d.desfazer()
    d.desfazer()
    checa_igual(round(d.doc[0].rect.width), 595, "desfazer o recorte")
    # Margem do ponto de vista do leitor numa pagina girada
    g = Documento(dados=paginas_numeradas(1))
    paginas.girar(g, [0], 90)
    paginas.recortar(g, [0], margens_mm=(30, 0, 0, 0))   # so' o topo visual
    checa(abs(g.doc[0].rect.height - (595 - 30 * paginas.MM)) < 0.5,
          "pagina girada: 'superior' e' o topo que o leitor ve")

    carta = Documento(dados=pdf_texto([["Texto A4"]]))
    anotacoes.forma(carta, 0, "retangulo", pymupdf.Point(100, 100),
                    pymupdf.Point(200, 200), anotacoes.Estilo())
    marcadores.gravar(carta, [marcadores.Marcador(1, "Início", 0)])
    paginas.redimensionar(carta, "Carta")
    checa_igual((round(carta.doc[0].rect.width), round(carta.doc[0].rect.height)),
                (612, 792), "A4 -> Carta")
    checa("Texto A4" in texto_da_pagina(carta, 0), "conteudo preservado")
    checa_igual(len(list(carta.doc[0].annots())), 0,
                "anotacoes achatadas (viram conteudo)")
    checa_igual([m.titulo for m in marcadores.ler(carta)], ["Início"],
                "marcadores sobrevivem ao redimensionar")
    paisagem = Documento(dados=pdf_texto([["x"]], largura=842, altura=595))
    paginas.redimensionar(paisagem, "A5")
    checa(paisagem.doc[0].rect.width > paisagem.doc[0].rect.height,
          "paisagem continua paisagem")
    checa_levanta(ValueError, paginas.redimensionar, "formato desconhecido",
                  paisagem, "B7")


def teste_cabecalho_carimbo() -> None:
    secao("cabecalho, rodape e carimbos")
    d = Documento(dados=paginas_numeradas(3))
    d.caminho = None
    extras.cabecalho_rodape(d, {"superior-esquerda": "Empresa Ação",
                                "inferior-direita": "Pág. {n} de {total}",
                                "superior-direita": "{arquivo}"},
                            pular_primeira=True)
    checa("Empresa Ação" not in texto_da_pagina(d, 0), "pula a primeira")
    t = texto_da_pagina(d, 2)
    checa("Empresa Ação" in t and "Pág. 3 de 3" in t, "textos e campos")
    checa("Sem título" in t, "{arquivo} vira o nome do documento")
    p = d.doc[2]
    caixa = p.search_for("Pág. 3 de 3")[0]
    checa(caixa.x1 <= p.rect.width - 23 and caixa.x1 > p.rect.width - 40,
          "alinhado a direita com a margem (medida com acento)")
    checa_levanta(ValueError, extras.cabecalho_rodape, "sem texto", d, {})
    checa_levanta(ValueError, extras.cabecalho_rodape, "posicao invalida", d,
                  {"meio": "x"})

    anotacoes.carimbo(d, 0, pymupdf.Point(300, 400), "CÓPIA",
                      subtitulo="29/09/2026")
    p = d.doc[0]
    a = p.first_annot
    checa(a is not None and a.type[1] == "Stamp", "carimbo e' anotacao Stamp")
    checa("CÓPIA" in a.info["content"], "texto do carimbo nas informacoes")
    centro = (a.rect.tl + a.rect.br) / 2
    checa(abs(centro.x - 300) < 1 and abs(centro.y - 400) < 1,
          "carimbo centrado no clique")
    checa(a.rect.width > a.rect.height, "carimbo deitado em pagina normal")
    paginas.girar(d, [1], 90)
    anotacoes.carimbo(d, 1, pymupdf.Point(300, 400), "PAGO")
    p1 = d.doc[1]
    b = p1.first_annot
    checa(b.rect.height > b.rect.width,
          "em pagina girada a caixa gira para o carimbo ficar de pe'")


def teste_marcadores_links() -> None:
    secao("marcadores")
    d = Documento(dados=paginas_numeradas(5))
    checa_igual(marcadores.ler(d), [], "sem marcadores")
    marcadores.adicionar(d, "Capítulo 1", 0)
    marcadores.adicionar(d, "Capítulo 2", 3)
    i = marcadores.adicionar(d, "Seção 1.1", 1)
    checa_igual([(m.titulo, m.pagina) for m in marcadores.ler(d)],
                [("Capítulo 1", 0), ("Seção 1.1", 1), ("Capítulo 2", 3)],
                "inseridos na ordem das paginas")
    marcadores.mudar_nivel(d, i, 1)
    checa_igual([m.nivel for m in marcadores.ler(d)], [1, 2, 1], "recuar nivel")
    marcadores.mudar_nivel(d, 0, 1)
    checa_igual(marcadores.ler(d)[0].nivel, 1,
                "o primeiro nao pode ficar no nivel 2 (normalizado)")
    marcadores.renomear(d, 2, "Capítulo 2 — Final")
    marcadores.mover(d, 2, -1)
    checa_igual(marcadores.ler(d)[1].titulo, "Capítulo 2 — Final", "mover")
    marcadores.excluir(d, 0)
    checa_igual([(m.nivel, m.titulo) for m in marcadores.ler(d)],
                [(1, "Capítulo 2 — Final"), (2, "Seção 1.1")],
                "excluir o primeiro capitulo")
    marcadores.excluir(d, 0)
    checa_igual([(m.nivel, m.titulo) for m in marcadores.ler(d)],
                [(1, "Seção 1.1")], "excluir o pai sobe o filho de nivel")
    marcadores.adicionar(d, "Capítulo 2 — Final", 3)
    with pasta_temporaria() as pasta:
        d.salvar(pasta / "m.pdf")
        checa_igual(len(marcadores.ler(Documento(pasta / "m.pdf"))), 2,
                    "marcadores persistem")

    secao("links")
    marcadores.criar_link(d, 0, pymupdf.Rect(72, 80, 200, 110), destino=4)
    marcadores.criar_link(d, 0, pymupdf.Rect(72, 200, 200, 230),
                          url="exemplo.com.br")
    ls = marcadores.links(d, 0)
    checa_igual([(l.destino_pagina, l.url) for l in ls],
                [(4, None), (None, "https://exemplo.com.br")],
                "link interno e externo (https acrescentado)")
    achado = marcadores.link_em(d, 0, pymupdf.Point(100, 215))
    checa(achado is not None and achado.url, "link pelo ponto")
    marcadores.excluir_link(d, 0, ls[0].rect)
    checa_igual(len(marcadores.links(d, 0)), 1, "excluir link")
    checa_levanta(ValueError, marcadores.criar_link, "destino fora", d, 0,
                  pymupdf.Rect(0, 0, 10, 10), destino=99)
    checa_levanta(ValueError, marcadores.criar_link, "sem destino", d, 0,
                  pymupdf.Rect(0, 0, 10, 10))
    # Um objeto Page vivo faz o get_links() do MuPDF devolver a lista velha;
    # a leitura pelos objetos do PDF nao cai nisso.
    viva = d.doc[2]
    marcadores.criar_link(d, 2, pymupdf.Rect(10, 10, 50, 50), destino=0)
    checa_igual(len(marcadores.links(d, 2)), 1,
                "link novo aparece mesmo com outro Page da pagina vivo")
    del viva
    marcadores.criar_link(d, 1, pymupdf.Rect(0, 0, 10, 10), url="a@b.com")
    checa_igual(marcadores.links(d, 1)[0].url, "mailto:a@b.com", "e-mail")


def main() -> int:
    teste_lote()
    teste_comparar()
    teste_paginas()
    teste_cabecalho_carimbo()
    teste_marcadores_links()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
