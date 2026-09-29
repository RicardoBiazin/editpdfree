"""Documento: abrir, desfazer/refazer, gravacao atomica e senha."""

from __future__ import annotations

import os
import sys

from ajudantes import (checa, checa_igual, checa_levanta, paginas_numeradas,
                       pasta_temporaria, primeira_linha, resumir, secao)

import pymupdf

from editpdfree import paginas, seguranca
from editpdfree.documento import NIVEIS_DESFAZER, Documento, SenhaNecessaria


def abrir_e_gravar() -> None:
    secao("abrir e gravar")
    with pasta_temporaria() as pasta:
        arquivo = pasta / "a.pdf"
        arquivo.write_bytes(paginas_numeradas(3))
        d = Documento(arquivo)
        checa_igual(d.paginas, 3, "abre com 3 paginas")
        checa(not d.modificado, "recem-aberto nao esta' modificado")
        # O arquivo NAO fica preso: da' para renomear com o documento aberto
        # (no Windows, um handle aberto impediria).
        os.replace(arquivo, pasta / "b.pdf")
        os.replace(pasta / "b.pdf", arquivo)
        checa(True, "arquivo nao fica preso enquanto o documento esta' aberto")
        paginas.girar(d, [0], 90)
        checa(d.modificado, "girar marca como modificado")
        d.salvar()
        checa(not d.modificado, "salvar limpa o modificado")
        sobras = [p.name for p in pasta.iterdir() if p.name != "a.pdf"]
        checa_igual(sobras, [], "nenhum temporario sobra na pasta")
        with pymupdf.open(arquivo) as conferir:
            checa_igual(conferir[0].rotation, 90, "rotacao gravada no disco")
        # Salvar como para outro caminho
        d.salvar(pasta / "copia.pdf")
        checa_igual(d.caminho.name, "copia.pdf",
                    "salvar como passa a apontar para o arquivo novo")
        d.fechar()

        novo = Documento()
        checa_igual(novo.paginas, 1, "documento novo tem uma pagina em branco")
        checa_levanta(ValueError, novo.salvar,
                      "salvar documento sem caminho pede salvar como")


def desfazer() -> None:
    secao("desfazer e refazer")
    d = Documento(dados=paginas_numeradas(4))
    paginas.excluir(d, [0])
    paginas.girar(d, [0], 90)
    checa_igual((d.paginas, d.doc[0].rotation), (3, 90), "duas operacoes")
    checa_igual(d.descricao_desfazer(), "Girar página", "descricao do desfazer")
    d.desfazer()
    checa_igual((d.paginas, d.doc[0].rotation), (3, 0), "desfaz o girar")
    d.desfazer()
    checa_igual(d.paginas, 4, "desfaz o excluir")
    checa_igual(primeira_linha(d, 0), "Pagina 1", "a pagina 1 voltou")
    checa(not d.desfazer(), "sem mais nada para desfazer")
    d.refazer()
    d.refazer()
    checa_igual((d.paginas, d.doc[0].rotation), (3, 90), "refaz as duas")
    paginas.girar(d, [1], 90)
    d.desfazer()
    paginas.girar(d, [2], 180)
    checa(not d.pode_refazer(), "operacao nova apaga a pilha de refazer")

    # Falha no meio da operacao volta ao estado anterior.
    def estado(doc):
        return [(doc.doc[i].rotation, doc.doc[i].get_text())
                for i in range(doc.paginas)]
    antes = estado(d)
    pilha = len(d._desfazer)
    try:
        with d.operacao("quebrar"):
            d.doc.delete_page(0)
            raise RuntimeError("falha simulada")
    except RuntimeError:
        pass
    checa_igual(estado(d), antes,
                "operacao que falha no meio nao deixa o PDF meio editado")
    checa_igual(len(d._desfazer), pilha,
                "operacao que falhou nao entra na pilha de desfazer")

    # Limite de niveis
    d2 = Documento(dados=paginas_numeradas(1))
    for _ in range(NIVEIS_DESFAZER + 5):
        paginas.girar(d2, [0], 90)
    checa_igual(len(d2._desfazer), NIVEIS_DESFAZER,
                "pilha de desfazer respeita o limite")


def senha() -> None:
    secao("senha")
    with pasta_temporaria() as pasta:
        arquivo = pasta / "s.pdf"
        arquivo.write_bytes(paginas_numeradas(2))
        d = Documento(arquivo)
        seguranca.proteger(d, "abc123")
        checa(d.modificado, "proteger marca modificado (aplica ao salvar)")
        d.salvar()
        checa_levanta(SenhaNecessaria, Documento, "sem senha nao abre", arquivo)
        checa_levanta(SenhaNecessaria, Documento, "senha errada nao abre",
                      arquivo, senha="errada")
        d2 = Documento(arquivo, senha="abc123")
        checa_igual(primeira_linha(d2, 0), "Pagina 1", "abre com a senha certa")
        # Editar e salvar um documento protegido mantem a protecao.
        paginas.girar(d2, [0], 90)
        d2.desfazer()
        paginas.girar(d2, [1], 90)
        d2.salvar()
        checa_levanta(SenhaNecessaria, Documento,
                      "continua protegido depois de editar e salvar", arquivo)
        seguranca.remover_protecao(d2)
        d2.salvar()
        d3 = Documento(arquivo)
        checa_igual(d3.doc[1].rotation, 90,
                    "sem senha depois de remover, e com a edicao")
        checa(not d3.protegido, "documento sem protecao")


def main() -> int:
    abrir_e_gravar()
    desfazer()
    senha()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
