"""Juntar PDFs escolhendo a ordem: nucleo, dialogo e janela."""

from __future__ import annotations

import os
import sys
import time

from ajudantes import (checa, checa_igual, checa_levanta, drenar_eventos,
                       paginas_numeradas, pasta_temporaria, pdf_texto,
                       preparar_qt, pular, resumir, secao)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

import pymupdf

from editpdfree import anotacoes, formularios, juntar, marcadores
from editpdfree.documento import Documento, SenhaNecessaria


def primeiras_linhas(dados: bytes) -> list[str]:
    with pymupdf.open("pdf", dados) as doc:
        return [doc[i].get_text().strip().splitlines()[0]
                for i in range(doc.page_count)]


def arquivo(pasta, nome, linhas, mtime=None):
    c = pasta / nome
    c.write_bytes(pdf_texto([[l] for l in linhas]))
    if mtime is not None:
        os.utime(c, (mtime, mtime))
    return c


def nucleo(pasta) -> None:
    secao("nucleo")
    agora = time.time()
    a = arquivo(pasta, "doc10.pdf", ["A1", "A2", "A3"], agora - 100)
    b = arquivo(pasta, "doc2.pdf", ["B1", "B2"], agora - 300)
    c = arquivo(pasta, "Ágata.pdf", ["C1"], agora - 200)
    fa, fb, fc = (juntar.carregar(x) for x in (a, b, c))
    checa_igual((fa.paginas, fb.paginas, fc.paginas), (3, 2, 1), "paginas contadas")

    checa_igual(primeiras_linhas(juntar.juntar([fb, fa, fc])),
                ["B1", "B2", "A1", "A2", "A3", "C1"], "a ordem da lista manda")
    checa_igual([f.nome for f in juntar.ordenar_por_nome([fa, fb, fc])],
                ["Ágata.pdf", "doc2.pdf", "doc10.pdf"],
                "nome natural: doc2 antes de doc10, acento ignorado")
    checa_igual([f.nome for f in juntar.ordenar_por_data([fa, fb, fc])],
                ["doc2.pdf", "Ágata.pdf", "doc10.pdf"], "data: mais antigo primeiro")

    fa.intervalo = "3, 1"
    fb.intervalo = "2-"
    checa_igual(primeiras_linhas(juntar.juntar([fa, fb])), ["A3", "A1", "B2"],
                "intervalo por arquivo, na ordem pedida")
    fa.intervalo = "9"
    checa_levanta(ValueError, juntar.juntar, "intervalo invalido e' recusado "
                  "antes de juntar", [fa, fb])
    fa.intervalo = fb.intervalo = ""
    checa_levanta(ValueError, juntar.juntar, "lista vazia", [])

    # Marcadores: um por arquivo + os de origem por baixo, remapeados.
    d = Documento(a)
    marcadores.gravar(d, [marcadores.Marcador(1, "Capítulo A", 1)])
    d.salvar()
    fa = juntar.carregar(a)
    dados = juntar.juntar([fb, fa], marcadores=True)
    with pymupdf.open("pdf", dados) as doc:
        checa_igual(doc.get_toc(simple=True),
                    [[1, "doc2", 1], [1, "doc10", 3], [2, "Capítulo A", 4]],
                    "marcador por arquivo e sumario de origem remapeado")
    sem = juntar.juntar([fb, fa])
    with pymupdf.open("pdf", sem) as doc:
        checa_igual(doc.get_toc(simple=True), [[1, "Capítulo A", 4]],
                    "sem a opcao, so' o sumario de origem (remapeado)")

    # Outros formatos, senha, anotacoes e campos
    img = pasta / "foto.png"
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 60), False)
    pix.clear_with(120)
    pix.save(img)
    checa_igual(juntar.carregar(img).paginas, 1, "imagem vira pagina")
    protegido = pasta / "secreto.pdf"
    protegido.write_bytes(pymupdf.open("pdf", paginas_numeradas(2)).tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="x", owner_pw="x"))
    checa_levanta(SenhaNecessaria, juntar.carregar, "PDF com senha pede senha",
                  protegido)
    fs = juntar.carregar(protegido, senha="x")
    checa_igual(len(primeiras_linhas(juntar.juntar([fs, fb]))), 4,
                "PDF com senha entra depois de autenticado")

    com_anot = Documento(dados=pdf_texto([["Anotado"]]))
    anotacoes.forma(com_anot, 0, "retangulo", pymupdf.Point(50, 50),
                    pymupdf.Point(90, 90), anotacoes.Estilo())
    formularios.criar_campo_texto(com_anot, 0, pymupdf.Rect(50, 200, 200, 220),
                                  "nome")
    f1 = juntar.de_documento("anotado.pdf", com_anot.doc)
    f2 = juntar.de_documento("anotado2.pdf", com_anot.doc)
    with pymupdf.open("pdf", juntar.juntar([f1, f2])) as doc:
        tipos = [a.type[1] for a in doc[0].annots()]
        checa_igual(tipos, ["Square"], "anotacoes preservadas")
        nomes = sorted(w.field_name for p in doc for w in p.widgets())
        checa(len(nomes) == 2 and len(set(nomes)) == 2,
              f"campos com o mesmo nome sao renomeados ({nomes})")


def dialogo(pasta) -> None:
    secao("dialogo")
    from editpdfree.interface.dialogo_juntar import DialogoJuntar
    senhas = []
    d = DialogoJuntar(None, str(pasta), abertos=[
        ("aberto.pdf", pymupdf.open("pdf", pdf_texto([["Aberto"]])))],
        pedir_senha=lambda nome, erro: senhas.append(nome) or "x")
    n = d.adicionar_arquivos([str(pasta / "doc10.pdf"), str(pasta / "doc2.pdf"),
                              str(pasta / "secreto.pdf")])
    checa_igual(n, 3, "tres arquivos adicionados")
    checa_igual(senhas, ["secreto.pdf"], "senha pedida so' para o protegido")
    d.adicionar_abertos()
    checa_igual([f.nome for f in d.fontes()],
                ["doc10.pdf", "doc2.pdf", "secreto.pdf", "aberto.pdf"],
                "ordem de entrada")
    checa(not d.lista.item(0).icon().isNull(), "miniatura da primeira pagina")
    d.ordenar_nome()
    checa_igual([f.nome for f in d.fontes()],
                ["aberto.pdf", "doc2.pdf", "doc10.pdf", "secreto.pdf"],
                "ordenar por nome")
    d.inverter()
    checa_igual(d.fontes()[0].nome, "secreto.pdf", "inverter")
    d.lista.setCurrentRow(0)
    d.mover(1)
    checa_igual([f.nome for f in d.fontes()][:2], ["doc10.pdf", "secreto.pdf"],
                "descer")
    d.lista.setCurrentRow(0)
    d.intervalo.setText("2")
    d._mudou_intervalo("2")
    checa_igual(d.fontes()[0].intervalo, "2", "intervalo do selecionado")
    checa("1 de 3 página(s)" in d.lista.item(0).text(), "linha mostra o intervalo")
    d._mudou_intervalo("7")
    checa(d.erro_intervalo.text(), "intervalo invalido e' apontado")
    d._mudou_intervalo("")
    checa_igual(d.erro_intervalo.text(), "", "corrigido")
    checa("8 página(s) no resultado" in d.resumo.text(),
          f"resumo com o total ({d.resumo.text()})")
    d.lista.setCurrentRow(3)
    d.lista.item(3).setSelected(True)
    d.remover()
    checa_igual(len(d.fontes()), 3, "remover")
    ruins = d._carregar(str(pasta / "nao_existe.pdf"), problemas := [])
    checa(ruins is None and problemas, "arquivo inexistente vira aviso")


def janela(pasta) -> None:
    secao("janela")
    from editpdfree.interface import aba as modulo_aba
    from teste_interface import encerrar, nova_janela
    j = nova_janela()
    fa = juntar.carregar(pasta / "doc2.pdf")
    fb = juntar.carregar(pasta / "doc10.pdf")
    modulo_aba.pedir_juntar = lambda *_a: ([fb, fa], True)
    j.juntar()
    d = j._aba().documento
    checa_igual(d.paginas, 5, "resultado com 5 paginas")
    checa_igual(d.nome, "juntado.pdf", "aba 'juntado.pdf'")
    checa(d.modificado and d.caminho is None, "ainda nao salvo")
    checa_igual([m.titulo for m in marcadores.ler(d)],
                ["doc10", "Capítulo A", "doc2"],
                "marcadores por arquivo")
    modulo_aba.pedir_juntar = lambda *_a: None
    antes = j.abas.count()
    j.juntar()
    checa_igual(j.abas.count(), antes, "cancelar nao faz nada")
    encerrar(j)


def main() -> int:
    with pasta_temporaria() as pasta:
        nucleo(pasta)
        dialogo(pasta)
        janela(pasta)
    drenar_eventos()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
