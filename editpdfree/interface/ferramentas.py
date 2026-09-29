"""As ferramentas do visualizador e como cada uma usa o mouse."""

from __future__ import annotations

import enum


class Gesto(enum.Enum):
    NENHUM = "nenhum"          # o visualizador trata (selecionar, mao)
    RETANGULO = "retangulo"    # arrastar desenha um retangulo
    LINHA = "linha"            # arrastar desenha uma linha
    TRACO = "traco"            # desenho livre
    CLIQUE = "clique"          # um clique basta


class Ferramenta(enum.Enum):
    SELECIONAR = "selecionar"
    MAO = "mao"
    ADICIONAR_TEXTO = "adicionar_texto"
    EDITAR_TEXTO = "editar_texto"
    CAIXA_TEXTO = "caixa_texto"
    NOTA = "nota"
    DESTACAR = "destacar"
    SUBLINHAR = "sublinhar"
    TACHAR = "tachar"
    CANETA = "caneta"
    RETANGULO = "retangulo"
    ELIPSE = "elipse"
    LINHA = "linha"
    SETA = "seta"
    IMAGEM = "imagem"
    ASSINATURA = "assinatura"
    TARJAR = "tarjar"
    CAMPO_TEXTO = "campo_texto"
    CAIXA_SELECAO = "caixa_selecao"


#: (rotulo no menu, dica, gesto, atalho)
INFO: dict[Ferramenta, tuple[str, str, Gesto, str]] = {
    Ferramenta.SELECIONAR: ("Selecionar", "Selecionar texto e anotações; "
                            "arraste uma anotação para movê-la", Gesto.NENHUM,
                            "V"),
    Ferramenta.MAO: ("Mão", "Arrastar a página", Gesto.NENHUM, "H"),
    Ferramenta.ADICIONAR_TEXTO: ("Adicionar texto", "Clique onde o texto "
                                 "novo deve começar", Gesto.CLIQUE, "T"),
    Ferramenta.EDITAR_TEXTO: ("Editar texto", "Clique numa linha de texto "
                              "do PDF para alterá-la", Gesto.CLIQUE, "E"),
    Ferramenta.CAIXA_TEXTO: ("Caixa de texto", "Arraste para criar uma "
                             "caixa de texto (anotação)", Gesto.RETANGULO, "X"),
    Ferramenta.NOTA: ("Nota", "Clique para fixar uma nota", Gesto.CLIQUE, "N"),
    Ferramenta.DESTACAR: ("Destacar", "Arraste sobre o texto para "
                          "destacá-lo", Gesto.RETANGULO, "D"),
    Ferramenta.SUBLINHAR: ("Sublinhar", "Arraste sobre o texto para "
                           "sublinhá-lo", Gesto.RETANGULO, "U"),
    Ferramenta.TACHAR: ("Tachar", "Arraste sobre o texto para tachá-lo",
                        Gesto.RETANGULO, "K"),
    Ferramenta.CANETA: ("Caneta", "Desenho à mão livre", Gesto.TRACO, "P"),
    Ferramenta.RETANGULO: ("Retângulo", "Arraste para desenhar um "
                           "retângulo", Gesto.RETANGULO, "R"),
    Ferramenta.ELIPSE: ("Elipse", "Arraste para desenhar uma elipse",
                        Gesto.RETANGULO, "O"),
    Ferramenta.LINHA: ("Linha", "Arraste para desenhar uma linha",
                       Gesto.LINHA, "L"),
    Ferramenta.SETA: ("Seta", "Arraste para desenhar uma seta", Gesto.LINHA,
                      "A"),
    Ferramenta.IMAGEM: ("Imagem", "Arraste a área onde a imagem vai ficar",
                        Gesto.RETANGULO, "I"),
    Ferramenta.ASSINATURA: ("Assinatura", "Clique onde a assinatura deve "
                            "ficar", Gesto.CLIQUE, "S"),
    Ferramenta.TARJAR: ("Tarjar área", "Arraste sobre o que deve ser "
                        "removido definitivamente", Gesto.RETANGULO, "B"),
    Ferramenta.CAMPO_TEXTO: ("Campo de texto", "Arraste para criar um campo "
                             "de formulário", Gesto.RETANGULO, ""),
    Ferramenta.CAIXA_SELECAO: ("Caixa de seleção", "Arraste para criar uma "
                               "caixa de seleção de formulário",
                               Gesto.RETANGULO, ""),
}


def gesto(f: Ferramenta) -> Gesto:
    return INFO[f][2]
