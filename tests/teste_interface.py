"""A janela de verdade, com eventos de mouse e teclado de verdade.

Testar o metodo nao e' testar o gesto: os eventos aqui entram pelo viewport
do visualizador e pela janela, como os do usuario -- inclusive em pagina
girada, onde a conversao de coordenadas costuma errar.
"""

from __future__ import annotations

import os
import sys
import time

from ajudantes import (checa, checa_igual, drenar_eventos, paginas_numeradas,
                       pasta_temporaria, pdf_texto, preparar_qt, pular,
                       resumir, secao, texto_da_pagina)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

import pymupdf
from PySide6.QtCore import QEvent, QPoint, QPointF, Qt
from PySide6.QtGui import QMouseEvent
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication

from editpdfree import coordenadas, idioma
from editpdfree.interface import aba as modulo_aba
from editpdfree.interface import config
from editpdfree.interface.ferramentas import Ferramenta
from editpdfree.interface.janela_principal import JanelaPrincipal
from editpdfree.interface.visualizador import MAX_EM_CACHE

app = QApplication.instance()
# Nenhum dialogo modal pode abrir durante a suite: travaria para sempre.
modulo_aba.avisar = lambda *a, **k: print("         (aviso) " + str(a[2:]))
modulo_aba.confirmar = lambda *a, **k: True


def nova_janela() -> JanelaPrincipal:
    j = JanelaPrincipal(config.Config(config.Config.PADRAO))
    j.resize(1100, 800)
    j.show()
    j.activateWindow()
    drenar_eventos()
    return j


def encerrar(j: JanelaPrincipal) -> None:
    """Fecha sem o dialogo de 'salvar alteracoes?'."""
    for a in j.todas_as_abas():
        a.documento.modificado = False
    j.close()
    drenar_eventos()


def _evento(tipo, vis, cena: QPointF, botoes) -> None:
    pos = QPointF(vis.mapFromScene(cena))
    glob = QPointF(vis.viewport().mapToGlobal(pos.toPoint()))
    botao = (Qt.MouseButton.LeftButton if tipo != QEvent.Type.MouseMove
             else Qt.MouseButton.NoButton)
    e = QMouseEvent(tipo, pos, glob, botao, botoes,
                    Qt.KeyboardModifier.NoModifier)
    QApplication.sendEvent(vis.viewport(), e)


def arrastar(vis, a: QPointF, b: QPointF, passos: int = 6) -> None:
    esquerdo = Qt.MouseButton.LeftButton
    _evento(QEvent.Type.MouseButtonPress, vis, a, esquerdo)
    for i in range(1, passos + 1):
        t = i / passos
        _evento(QEvent.Type.MouseMove, vis,
                QPointF(a.x() + (b.x() - a.x()) * t,
                        a.y() + (b.y() - a.y()) * t), esquerdo)
    _evento(QEvent.Type.MouseButtonRelease, vis, b, Qt.MouseButton.NoButton)
    drenar_eventos()


def clicar(vis, p: QPointF) -> None:
    arrastar(vis, p, p, passos=0)


def cena_de_pdf(vis, pagina: int, x: float, y: float) -> QPointF:
    return vis.pdf_para_cena(pagina, pymupdf.Point(x, y))


def tipos(doc, i=0) -> list[str]:
    p = doc.doc[i]
    return [a.type[1] for a in p.annots()]


def abrir_e_abas(pasta) -> None:
    secao("abrir, abas e salvar")
    arquivo = pasta / "Doc.pdf"
    arquivo.write_bytes(pdf_texto([["Linha para editar", "Outra linha"],
                                   ["Pagina dois tem ACME"]]))
    j = nova_janela()
    aba = j.abrir(arquivo)
    checa(aba is not None, "abre o arquivo")
    checa_igual(j.abas.count(), 1, "uma aba")
    j.abrir(str(arquivo).upper() if os.name == "nt" else arquivo)
    checa_igual(j.abas.count(), 1,
                "mesmo arquivo com outra caixa nao abre segunda aba")
    checa("Doc.pdf" in j.windowTitle(), "titulo com o nome do arquivo")
    antes = arquivo.stat().st_mtime_ns
    time.sleep(0.05)
    checa(j.salvar(), "salvar sem alteracao devolve True")
    checa_igual(arquivo.stat().st_mtime_ns, antes,
                "salvar sem alteracao nao regrava o arquivo")
    j.novo()
    checa_igual(j.abas.count(), 2, "novo documento em outra aba")
    j.fechar_aba(1)
    checa_igual(j.abas.count(), 1, "fechar aba")
    checa(j.abrir(pasta / "nao_existe.pdf") is None,
          "arquivo inexistente nao abre (e nao trava)")
    encerrar(j)


def renderizacao_preguicosa() -> None:
    secao("renderizacao preguicosa")
    j = nova_janela()
    with pasta_temporaria() as pasta:
        arquivo = pasta / "grande.pdf"
        arquivo.write_bytes(paginas_numeradas(300))
        inicio = time.perf_counter()
        aba = j.abrir(arquivo)
        drenar_eventos()
        aba.visualizador._renderizar_visiveis()
        gasto = time.perf_counter() - inicio
        v = aba.visualizador
        checa(v.paginas_renderizadas() <= 6,
              f"abrir 300 paginas renderiza so' as visiveis "
              f"({v.paginas_renderizadas()})")
        checa(gasto < 5, f"abre rapido ({gasto:.2f}s)")
        for destino in (100, 200, 299):
            v.ir_para_pagina(destino)
            v._renderizar_visiveis()
        checa(v.paginas_renderizadas() <= MAX_EM_CACHE,
              f"cache limitado depois de rolar ({v.paginas_renderizadas()})")
        checa_igual(v.pagina_atual, 299, "foi ate' a ultima pagina")
        checa_igual(j.rotulo_total.text().strip(), "/ 300", "total na barra")
        encerrar(j)


def gestos(pasta) -> None:
    secao("gestos das ferramentas")
    arquivo = pasta / "gestos.pdf"
    arquivo.write_bytes(pdf_texto([["Linha para editar", "Outra linha"]]))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    v = aba.visualizador
    d = aba.documento

    j.definir_ferramenta(Ferramenta.RETANGULO)
    arrastar(v, cena_de_pdf(v, 0, 100, 300), cena_de_pdf(v, 0, 250, 400))
    checa_igual(tipos(d), ["Square"], "arrastar com Retangulo cria retangulo")
    p = d.doc[0]      # referencia viva: a anotacao so' guarda uma fraca
    r = p.first_annot.rect
    checa(abs(r.x0 - 100) < 4 and abs(r.y1 - 400) < 4,
          f"retangulo onde o mouse arrastou ({r})")

    j.definir_ferramenta(Ferramenta.DESTACAR)
    arrastar(v, cena_de_pdf(v, 0, 70, 90), cena_de_pdf(v, 0, 200, 102))
    checa("Highlight" in tipos(d), "arrastar sobre texto destaca")

    j.definir_ferramenta(Ferramenta.CANETA)
    arrastar(v, cena_de_pdf(v, 0, 300, 500), cena_de_pdf(v, 0, 400, 560))
    checa("Ink" in tipos(d), "caneta desenha")

    j.definir_ferramenta(Ferramenta.SETA)
    arrastar(v, cena_de_pdf(v, 0, 100, 600), cena_de_pdf(v, 0, 300, 650))
    checa("Line" in tipos(d), "seta")

    # Caixa de texto e edicao de texto usam dialogos: trocados aqui.
    modulo_aba.pedir_texto = lambda *a, **k: "Comentário ação"
    j.definir_ferramenta(Ferramenta.CAIXA_TEXTO)
    arrastar(v, cena_de_pdf(v, 0, 300, 200), cena_de_pdf(v, 0, 500, 240))
    checa("FreeText" in tipos(d), "caixa de texto")

    modulo_aba.pedir_edicao = lambda _p, t: ("Linha EDITADA", t.tamanho, t.cor)
    j.definir_ferramenta(Ferramenta.EDITAR_TEXTO)
    clicar(v, cena_de_pdf(v, 0, 90, 96))
    checa("Linha EDITADA" in texto_da_pagina(d, 0), "editar texto pelo clique")
    checa("para editar" not in texto_da_pagina(d, 0), "texto antigo saiu")

    # Assinatura: o primeiro clique pede o desenho; o segundo reaproveita.
    img = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 20), False)
    img.clear_with(0)
    pedidos = []
    modulo_aba.pedir_assinatura = lambda _p: pedidos.append(1) or \
        img.tobytes("png")
    j.definir_ferramenta(Ferramenta.ASSINATURA)
    clicar(v, cena_de_pdf(v, 0, 300, 700))
    clicar(v, cena_de_pdf(v, 0, 300, 760))
    p = d.doc[0]
    imagens = p.get_image_info()
    checa_igual(len(imagens), 2, "duas assinaturas colocadas")
    checa_igual(len(pedidos), 1, "a assinatura e' pedida uma vez e guardada")
    checa(config.caminho_assinatura().is_file(), "assinatura salva no perfil")
    caixa = pymupdf.Rect(imagens[0]["bbox"])
    checa(abs((caixa.x0 + caixa.x1) / 2 - 300) < 2
          and abs((caixa.y0 + caixa.y1) / 2 - 700) < 2,
          "assinatura centrada no clique")

    # Selecionar, arrastar e excluir com a tecla.
    j.definir_ferramenta(Ferramenta.SELECIONAR)
    quadrado = [a for a in d.doc[0].annots() if a.type[1] == "Square"][0]
    xref = quadrado.xref
    clicar(v, cena_de_pdf(v, 0, 101, 350))
    checa_igual(v.selecionada, (0, xref), "clicar na borda seleciona")
    arrastar(v, cena_de_pdf(v, 0, 101, 350), cena_de_pdf(v, 0, 141, 380))
    p = d.doc[0]
    movido = p.load_annot(xref).rect
    checa(abs(movido.x0 - 140) < 4 and abs(movido.y0 - 330) < 4,
          f"arrastar move a anotacao ({movido})")
    n = len(list(d.doc[0].annots()))
    v.setFocus()
    QTest.keyClick(v, Qt.Key.Key_Delete)
    drenar_eventos()
    checa_igual(len(list(d.doc[0].annots())), n - 1,
                "a TECLA Delete exclui a anotacao selecionada")
    QTest.keyClick(v, Qt.Key.Key_Z, Qt.KeyboardModifier.ControlModifier)
    drenar_eventos()
    checa_igual(len(list(d.doc[0].annots())), n, "a TECLA Ctrl+Z desfaz")
    QTest.keyClick(v, Qt.Key.Key_Y, Qt.KeyboardModifier.ControlModifier)
    drenar_eventos()
    checa_igual(len(list(d.doc[0].annots())), n - 1, "a TECLA Ctrl+Y refaz")
    checa("•" in j.abas.tabText(0), "aba marcada como modificada")
    checa(j.salvar(), "salvar")
    checa("•" not in j.abas.tabText(0), "marca de modificado sai ao salvar")
    with pymupdf.open(arquivo) as c:
        checa("Linha EDITADA" in c[0].get_text(), "edicao gravada no disco")
    encerrar(j)


def pagina_girada(pasta) -> None:
    secao("gestos em pagina girada")
    arquivo = pasta / "girada.pdf"
    arquivo.write_bytes(pdf_texto([["Texto"]], rotacoes=[90]))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    v = aba.visualizador
    d = aba.documento
    j.definir_ferramenta(Ferramenta.RETANGULO)
    # Arrasta na TELA (espaco girado), e confere onde a anotacao aparece na
    # tela depois.
    item = v._paginas[0]
    a = QPointF(item.x() + 100 * v.zoom, item.y() + 50 * v.zoom)
    b = QPointF(item.x() + 300 * v.zoom, item.y() + 150 * v.zoom)
    arrastar(v, a, b)
    checa_igual(tipos(d), ["Square"], "retangulo em pagina girada")
    p = d.doc[0]
    x0, y0, x1, y1 = coordenadas.retangulo_pdf_para_tela(
        p, p.first_annot.rect, v.zoom)
    esperado = (100 * v.zoom, 50 * v.zoom, 300 * v.zoom, 150 * v.zoom)
    folga = 4 * v.zoom
    checa(all(abs(o - e) < folga for o, e in zip((x0, y0, x1, y1), esperado)),
          "a anotacao aparece na tela exatamente onde o mouse arrastou")
    encerrar(j)


def busca_e_miniaturas(pasta) -> None:
    secao("busca e miniaturas")
    arquivo = pasta / "busca.pdf"
    arquivo.write_bytes(pdf_texto([["ACME um"], ["dois"], ["ACME tres"]]))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    j.busca.setText("ACME")
    j.busca.returnPressed.emit()
    drenar_eventos()
    checa_igual(len(aba.resultados), 2, "duas ocorrencias")
    checa_igual(j.rotulo_busca.text().strip(), "1 de 2", "rotulo da busca")
    j.busca.returnPressed.emit()
    checa_igual(j.rotulo_busca.text().strip(), "2 de 2", "Enter vai ao proximo")
    j.busca.clear()
    checa_igual(aba.resultados, [], "limpar a busca")

    aba.miniaturas.ordemMudou.emit([2, 0, 1])
    drenar_eventos()
    checa_igual(texto_da_pagina(aba.documento, 0).strip(), "ACME tres",
                "reordenar pelas miniaturas")
    checa_igual(aba.miniaturas.count(), 3, "miniaturas recarregadas")
    aba.miniaturas.setCurrentRow(1)
    aba.miniaturas.item(1).setSelected(True)
    aba._acao_miniatura("girar_dir", [1])
    checa_igual(aba.documento.doc[1].rotation, 90, "girar pelo menu da miniatura")
    aba._acao_miniatura("excluir", [1])
    checa_igual(aba.documento.paginas, 2, "excluir pelo menu da miniatura")
    encerrar(j)


def traducao() -> None:
    secao("traducao do Qt")
    n = idioma.instalar(app)
    checa(n >= 1, f"catalogo pt_BR do Qt carregado ({n})")


def main() -> int:
    with pasta_temporaria() as pasta:
        abrir_e_abas(pasta)
        renderizacao_preguicosa()
        gestos(pasta)
        pagina_girada(pasta)
        busca_e_miniaturas(pasta)
    traducao()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
