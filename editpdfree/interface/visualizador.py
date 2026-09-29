"""Visualizador das paginas: rolagem continua, zoom e os gestos das ferramentas.

**So' as paginas visiveis sao renderizadas.** Ao abrir, cada pagina vira um
retangulo branco do tamanho certo -- nada de pixmap. Um temporizador curto,
disparado por rolagem, zoom ou redimensionamento, renderiza as paginas que
estao na tela (e uma de cada lado) e descarta as que ficaram longe. Um PDF de
mil paginas abre na hora e ocupa a memoria de meia duzia delas.

O visualizador NAO altera o documento: ele traduz o mouse em sinais com
coordenadas ja' no espaco PDF (via `coordenadas.py`), e quem recebe decide.
"""

from __future__ import annotations

import bisect

import pymupdf
from PySide6.QtCore import QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import (QBrush, QColor, QImage, QKeySequence, QPainter,
                           QPainterPath, QPen, QPixmap)
from PySide6.QtWidgets import (QGraphicsItem, QGraphicsPathItem,
                               QGraphicsPixmapItem, QGraphicsRectItem,
                               QGraphicsScene, QGraphicsView, QMenu)

from .. import coordenadas
from ..documento import Documento
from .ferramentas import Ferramenta, Gesto, gesto

ESPACO = 14          # entre paginas, em pixels de cena
MARGEM = 20
ZOOM_MIN, ZOOM_MAX = 0.1, 8.0
MAX_EM_CACHE = 14    # paginas renderizadas mantidas


def pixmap_da_pagina(pagina: pymupdf.Page, escala: float) -> QPixmap:
    pix = pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala),
                            alpha=False, annots=True)
    # `amostras` numa variavel: o QImage NAO copia o buffer, so' aponta para
    # ele. Passando `pix.samples` direto, o bytes temporario pode ser coletado
    # antes do copy() -- e a imagem vira lixo aleatorio ou falha de acesso.
    amostras = pix.samples
    imagem = QImage(amostras, pix.width, pix.height, pix.stride,
                    QImage.Format.Format_RGB888)
    return QPixmap.fromImage(imagem.copy())


class _Pagina(QGraphicsRectItem):
    def __init__(self, indice: int, largura: float, altura: float):
        super().__init__(0, 0, largura, altura)
        self.indice = indice
        self.setBrush(QBrush(Qt.GlobalColor.white))
        self.setPen(QPen(QColor(160, 160, 160), 0))
        self.imagem = QGraphicsPixmapItem(self)
        self.imagem.setTransformationMode(
            Qt.TransformationMode.SmoothTransformation)
        self.renderizada_em: float | None = None


class Visualizador(QGraphicsView):
    paginaAtualMudou = Signal(int)
    zoomMudou = Signal(float)
    #: (ferramenta, pagina, pymupdf.Rect no espaco PDF)
    retanguloFeito = Signal(object, int, object)
    #: (ferramenta, pagina, pymupdf.Point)
    cliqueFeito = Signal(object, int, object)
    #: (ferramenta, pagina, inicio, fim)
    linhaFeita = Signal(object, int, object, object)
    #: (pagina, [[pymupdf.Point, ...]])
    tracoFeito = Signal(int, object)
    #: (pagina, xref, dx, dy) em pontos PDF
    anotacaoArrastada = Signal(int, int, float, float)
    #: (pagina, xref)
    anotacaoExcluir = Signal(int, int)
    #: (pagina, pymupdf.Rect, QPoint global) -- selecao de texto com o mouse
    selecaoFeita = Signal(int, object, object)
    #: (pagina, pymupdf.Point) -- clique num campo de formulario
    campoClicado = Signal(int, object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self.setBackgroundBrush(QColor(82, 86, 89))
        self.setRenderHints(QPainter.RenderHint.Antialiasing
                            | QPainter.RenderHint.SmoothPixmapTransform)
        self.setAlignment(Qt.AlignmentFlag.AlignHCenter
                          | Qt.AlignmentFlag.AlignTop)
        self.setViewportUpdateMode(
            QGraphicsView.ViewportUpdateMode.MinimalViewportUpdate)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.documento: Documento | None = None
        self.zoom = 1.0
        self.ferramenta = Ferramenta.SELECIONAR
        self.cor_temporaria = QColor(220, 30, 30)
        self._paginas: list[_Pagina] = []
        self._topos: list[float] = []
        self._pagina_atual = 0
        self._marcas: list[QGraphicsRectItem] = []
        self._destaque_atual: QGraphicsRectItem | None = None
        # estado do gesto em andamento
        self._arrasto: dict | None = None
        self._selecionada: tuple[int, int] | None = None   # (pagina, xref)
        self._contorno: QGraphicsRectItem | None = None

        self._temporizador = QTimer(self)
        self._temporizador.setSingleShot(True)
        self._temporizador.setInterval(25)
        self._temporizador.timeout.connect(self._renderizar_visiveis)
        self.verticalScrollBar().valueChanged.connect(self._rolou)
        self.horizontalScrollBar().valueChanged.connect(
            lambda _v: self._temporizador.start())

    # -- documento ---------------------------------------------------------
    def definir_documento(self, documento: Documento) -> None:
        self.documento = documento
        self.recarregar(manter_posicao=False)

    def recarregar(self, manter_posicao: bool = True) -> None:
        """Refaz o leiaute. Chamado a cada alteracao do documento.

        Recria so' os retangulos -- barato mesmo com centenas de paginas -- e
        deixa o temporizador renderizar o que aparece."""
        pagina = self._pagina_atual
        fracao = self._fracao_dentro_da_pagina() if manter_posicao else 0.0
        cena = self.scene()
        self._contorno = None
        self._destaque_atual = None
        self._marcas.clear()
        cena.clear()
        self._paginas.clear()
        self._topos.clear()
        if self.documento is None:
            return
        largura_max = 0.0
        y = MARGEM
        for i in range(self.documento.paginas):
            r = self.documento.doc[i].rect
            item = _Pagina(i, r.width * self.zoom, r.height * self.zoom)
            item.setPos(0, y)
            cena.addItem(item)
            self._paginas.append(item)
            self._topos.append(y)
            largura_max = max(largura_max, r.width * self.zoom)
            y += r.height * self.zoom + ESPACO
        for item in self._paginas:
            item.setX((largura_max - item.rect().width()) / 2)
        cena.setSceneRect(QRectF(-MARGEM, 0, largura_max + 2 * MARGEM,
                                 y + MARGEM - ESPACO))
        if self._selecionada and self._selecionada[0] < len(self._paginas):
            self._desenhar_contorno()
        else:
            self._selecionada = None
        if manter_posicao:
            self.ir_para_pagina(min(pagina, len(self._paginas) - 1), fracao)
        else:
            self.verticalScrollBar().setValue(0)
            self._pagina_atual = 0
        self._temporizador.start()

    def _fracao_dentro_da_pagina(self) -> float:
        if not self._paginas:
            return 0.0
        item = self._paginas[min(self._pagina_atual, len(self._paginas) - 1)]
        topo_visivel = self.mapToScene(0, 0).y()
        altura = item.rect().height() or 1
        return max(0.0, min(1.0, (topo_visivel - item.y()) / altura))

    # -- renderizacao ------------------------------------------------------
    def _rolou(self, _valor: int) -> None:
        self._atualizar_pagina_atual()
        self._temporizador.start()

    def resizeEvent(self, evento) -> None:                # noqa: N802
        super().resizeEvent(evento)
        self._temporizador.start()

    def _indices_visiveis(self) -> range:
        if not self._paginas:
            return range(0)
        area = self.mapToScene(self.viewport().rect()).boundingRect()
        primeiro = max(0, bisect.bisect_right(self._topos, area.top()) - 1)
        ultimo = max(primeiro, bisect.bisect_right(self._topos, area.bottom()) - 1)
        return range(max(0, primeiro - 1), min(len(self._paginas), ultimo + 2))

    def _renderizar_visiveis(self) -> None:
        if self.documento is None:
            return
        visiveis = self._indices_visiveis()
        escala = self.zoom * self.devicePixelRatioF()
        for i in visiveis:
            item = self._paginas[i]
            if item.renderizada_em == escala:
                continue
            pix = pixmap_da_pagina(self.documento.doc[i], escala)
            pix.setDevicePixelRatio(self.devicePixelRatioF())
            item.imagem.setPixmap(pix)
            item.renderizada_em = escala
        # Descarta o que ficou longe, para a memoria nao crescer com a rolagem.
        renderizadas = [p for p in self._paginas if p.renderizada_em]
        if len(renderizadas) > MAX_EM_CACHE:
            centro = (visiveis.start + visiveis.stop) / 2
            renderizadas.sort(key=lambda p: -abs(p.indice - centro))
            for p in renderizadas[:len(renderizadas) - MAX_EM_CACHE]:
                if p.indice not in visiveis:
                    p.imagem.setPixmap(QPixmap())
                    p.renderizada_em = None

    def paginas_renderizadas(self) -> int:
        return sum(1 for p in self._paginas if p.renderizada_em)

    def invalidar(self) -> None:
        for p in self._paginas:
            p.renderizada_em = None
        self._temporizador.start()

    # -- navegacao ---------------------------------------------------------
    @property
    def pagina_atual(self) -> int:
        return self._pagina_atual

    def _atualizar_pagina_atual(self) -> None:
        if not self._paginas:
            return
        meio = self.mapToScene(0, self.viewport().height() // 3).y()
        i = max(0, bisect.bisect_right(self._topos, meio) - 1)
        i = min(i, len(self._paginas) - 1)
        if i != self._pagina_atual:
            self._pagina_atual = i
            self.paginaAtualMudou.emit(i)

    def ir_para_pagina(self, indice: int, fracao: float = 0.0) -> None:
        if not self._paginas:
            return
        indice = max(0, min(indice, len(self._paginas) - 1))
        item = self._paginas[indice]
        y = item.y() + item.rect().height() * fracao - (MARGEM if not fracao else 0)
        self.verticalScrollBar().setValue(int(y))
        if self._pagina_atual != indice:
            self._pagina_atual = indice
            self.paginaAtualMudou.emit(indice)
        self._temporizador.start()

    def mostrar_retangulo(self, pagina: int, rect: pymupdf.Rect) -> None:
        """Rola ate' que `rect` (espaco PDF) esteja visivel."""
        cena = self._rect_para_cena(pagina, rect)
        self.ensureVisible(cena, 40, 80)
        self._temporizador.start()

    # -- zoom --------------------------------------------------------------
    def definir_zoom(self, zoom: float) -> None:
        zoom = max(ZOOM_MIN, min(ZOOM_MAX, zoom))
        if abs(zoom - self.zoom) < 1e-4:
            return
        self.zoom = zoom
        self.recarregar(manter_posicao=True)
        self.zoomMudou.emit(zoom)

    def ampliar(self) -> None:
        self.definir_zoom(self.zoom * 1.25)

    def reduzir(self) -> None:
        self.definir_zoom(self.zoom / 1.25)

    def ajustar_largura(self, maximo: float = ZOOM_MAX) -> None:
        if self.documento is None:
            return
        largura = self.documento.doc[self._pagina_atual].rect.width
        disponivel = self.viewport().width() - 2 * MARGEM - 4
        self.definir_zoom(min(maximo, disponivel / largura))

    def ajustar_pagina(self) -> None:
        if self.documento is None:
            return
        r = self.documento.doc[self._pagina_atual].rect
        zl = (self.viewport().width() - 2 * MARGEM - 4) / r.width
        za = (self.viewport().height() - 2 * MARGEM) / r.height
        self.definir_zoom(min(zl, za))
        self.ir_para_pagina(self._pagina_atual)

    def wheelEvent(self, evento) -> None:                 # noqa: N802
        if evento.modifiers() & Qt.KeyboardModifier.ControlModifier:
            if evento.angleDelta().y() > 0:
                self.ampliar()
            elif evento.angleDelta().y() < 0:
                self.reduzir()
            evento.accept()
            return
        super().wheelEvent(evento)

    # -- conversoes --------------------------------------------------------
    def pagina_em(self, ponto_cena: QPointF) -> int | None:
        if not self._paginas:
            return None
        i = bisect.bisect_right(self._topos, ponto_cena.y()) - 1
        if 0 <= i < len(self._paginas):
            item = self._paginas[i]
            if item.sceneBoundingRect().contains(ponto_cena):
                return i
        return None

    def _local(self, pagina: int, ponto_cena: QPointF) -> tuple[float, float]:
        item = self._paginas[pagina]
        return ponto_cena.x() - item.x(), ponto_cena.y() - item.y()

    def cena_para_pdf(self, pagina: int, ponto_cena: QPointF) -> pymupdf.Point:
        x, y = self._local(pagina, ponto_cena)
        return coordenadas.tela_para_pdf(self.documento.doc[pagina], x, y,
                                         self.zoom)

    def pdf_para_cena(self, pagina: int, ponto: pymupdf.Point) -> QPointF:
        x, y = coordenadas.pdf_para_tela(self.documento.doc[pagina], ponto,
                                         self.zoom)
        item = self._paginas[pagina]
        return QPointF(item.x() + x, item.y() + y)

    def _rect_para_cena(self, pagina: int, rect: pymupdf.Rect) -> QRectF:
        x0, y0, x1, y1 = coordenadas.retangulo_pdf_para_tela(
            self.documento.doc[pagina], rect, self.zoom)
        item = self._paginas[pagina]
        return QRectF(item.x() + x0, item.y() + y0, x1 - x0, y1 - y0)

    # -- marcas da busca ---------------------------------------------------
    def marcar_resultados(self, resultados: list[tuple[int, pymupdf.Rect]],
                          atual: int | None = None) -> None:
        for m in self._marcas:
            if m.scene() is not None:
                self.scene().removeItem(m)
        self._marcas.clear()
        for n, (pagina, rect) in enumerate(resultados):
            if pagina >= len(self._paginas):
                continue
            r = self._rect_para_cena(pagina, rect)
            item = QGraphicsRectItem(r)
            if n == atual:
                item.setBrush(QColor(255, 140, 0, 110))
                item.setPen(QPen(QColor(230, 90, 0), 1.5))
            else:
                item.setBrush(QColor(255, 230, 0, 90))
                item.setPen(QPen(Qt.PenStyle.NoPen))
            item.setZValue(5)
            self.scene().addItem(item)
            self._marcas.append(item)

    # -- selecao de anotacao -------------------------------------------------
    @property
    def selecionada(self) -> tuple[int, int] | None:
        return self._selecionada

    def selecionar_anotacao(self, pagina: int | None,
                            xref: int | None = None) -> None:
        self._selecionada = (pagina, xref) if pagina is not None else None
        self._desenhar_contorno()

    def _desenhar_contorno(self) -> None:
        if self._contorno is not None and self._contorno.scene() is not None:
            self.scene().removeItem(self._contorno)
        self._contorno = None
        if not self._selecionada or self.documento is None:
            return
        pagina, xref = self._selecionada
        p = self.documento.doc[pagina]     # referencia viva: ver anotacoes._achar
        a = p.load_annot(xref)
        if a is None:
            self._selecionada = None
            return
        item = QGraphicsRectItem(self._rect_para_cena(pagina, a.rect)
                                 .adjusted(-3, -3, 3, 3))
        item.setPen(QPen(QColor(0, 120, 215), 1.5, Qt.PenStyle.DashLine))
        item.setZValue(10)
        self.scene().addItem(item)
        self._contorno = item

    # -- ferramenta --------------------------------------------------------
    def definir_ferramenta(self, ferramenta: Ferramenta) -> None:
        self.ferramenta = ferramenta
        self._cancelar_gesto()
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag
                         if ferramenta is Ferramenta.MAO
                         else QGraphicsView.DragMode.NoDrag)
        cursor = {Ferramenta.SELECIONAR: Qt.CursorShape.ArrowCursor,
                  Ferramenta.MAO: Qt.CursorShape.OpenHandCursor,
                  Ferramenta.EDITAR_TEXTO: Qt.CursorShape.IBeamCursor,
                  Ferramenta.ADICIONAR_TEXTO: Qt.CursorShape.IBeamCursor,
                  }.get(ferramenta, Qt.CursorShape.CrossCursor)
        self.viewport().setCursor(cursor)

    def _cancelar_gesto(self) -> None:
        if self._arrasto and self._arrasto.get("item") is not None:
            item = self._arrasto["item"]
            if item.scene() is not None:
                self.scene().removeItem(item)
        self._arrasto = None

    def _caneta_temporaria(self) -> QPen:
        pen = QPen(self.cor_temporaria, max(1.0, 1.5 * self.zoom))
        pen.setCosmetic(False)
        return pen

    def mousePressEvent(self, evento) -> None:            # noqa: N802
        if self.ferramenta is Ferramenta.MAO or self.documento is None:
            super().mousePressEvent(evento)
            return
        cena = self.mapToScene(evento.position().toPoint())
        pagina = self.pagina_em(cena)
        if evento.button() == Qt.MouseButton.RightButton:
            self._menu_contexto(evento, cena, pagina)
            return
        if evento.button() != Qt.MouseButton.LeftButton or pagina is None:
            super().mousePressEvent(evento)
            return
        self.setFocus()
        g = gesto(self.ferramenta)
        ponto_pdf = self.cena_para_pdf(pagina, cena)
        if self.ferramenta is Ferramenta.SELECIONAR:
            self._pressionar_selecao(pagina, cena, ponto_pdf)
            return
        if g is Gesto.CLIQUE:
            self.cliqueFeito.emit(self.ferramenta, pagina, ponto_pdf)
            return
        if g is Gesto.TRACO:
            caminho = QPainterPath(cena)
            item = QGraphicsPathItem(caminho)
            item.setPen(self._caneta_temporaria())
            item.setZValue(20)
            self.scene().addItem(item)
            self._arrasto = {"tipo": "traco", "pagina": pagina, "item": item,
                             "caminho": caminho, "pontos": [ponto_pdf]}
            return
        item = (QGraphicsRectItem(QRectF(cena, cena)) if g is Gesto.RETANGULO
                else QGraphicsPathItem())
        item.setPen(self._caneta_temporaria())
        if self.ferramenta is Ferramenta.TARJAR:
            item.setBrush(QColor(0, 0, 0, 90))
        elif self.ferramenta in (Ferramenta.DESTACAR, Ferramenta.SUBLINHAR,
                                 Ferramenta.TACHAR):
            item.setBrush(QColor(255, 230, 0, 70))
        item.setZValue(20)
        self.scene().addItem(item)
        self._arrasto = {"tipo": g.value, "pagina": pagina, "item": item,
                         "inicio": cena}

    def _pressionar_selecao(self, pagina: int, cena: QPointF,
                            ponto_pdf: pymupdf.Point) -> None:
        from .. import anotacoes, formularios
        p = self.documento.doc[pagina]
        a = anotacoes.anotacao_em(p, ponto_pdf, folga=3 / self.zoom)
        if a is not None:
            self.selecionar_anotacao(pagina, a.xref)
            self._arrasto = {"tipo": "mover", "pagina": pagina,
                             "xref": a.xref, "inicio": cena, "item": None}
            return
        if formularios.campo_em(self.documento, pagina, ponto_pdf):
            self.selecionar_anotacao(None)
            self.campoClicado.emit(pagina, ponto_pdf)
            return
        self.selecionar_anotacao(None)
        item = QGraphicsRectItem(QRectF(cena, cena))
        item.setPen(QPen(QColor(0, 120, 215), 1))
        item.setBrush(QColor(0, 120, 215, 40))
        item.setZValue(20)
        self.scene().addItem(item)
        self._arrasto = {"tipo": "selecao", "pagina": pagina, "item": item,
                         "inicio": cena}

    def _limitar(self, pagina: int, cena: QPointF) -> QPointF:
        r = self._paginas[pagina].sceneBoundingRect()
        return QPointF(min(max(cena.x(), r.left()), r.right()),
                       min(max(cena.y(), r.top()), r.bottom()))

    def mouseMoveEvent(self, evento) -> None:             # noqa: N802
        if not self._arrasto:
            super().mouseMoveEvent(evento)
            return
        a = self._arrasto
        cena = self._limitar(a["pagina"],
                             self.mapToScene(evento.position().toPoint()))
        tipo = a["tipo"]
        if tipo in ("retangulo", "selecao"):
            a["item"].setRect(QRectF(a["inicio"], cena).normalized())
        elif tipo == "linha":
            caminho = QPainterPath(a["inicio"])
            caminho.lineTo(cena)
            a["item"].setPath(caminho)
        elif tipo == "traco":
            a["caminho"].lineTo(cena)
            a["item"].setPath(a["caminho"])
            a["pontos"].append(self.cena_para_pdf(a["pagina"], cena))
        elif tipo == "mover" and self._contorno is not None:
            if a["item"] is None:
                a["base"] = self._contorno.pos()
                a["item"] = False     # marca: ja' comecou a arrastar
            delta = cena - a["inicio"]
            self._contorno.setPos(a["base"] + delta)

    def mouseReleaseEvent(self, evento) -> None:          # noqa: N802
        if not self._arrasto:
            super().mouseReleaseEvent(evento)
            return
        a = self._arrasto
        self._arrasto = None
        pagina = a["pagina"]
        cena = self._limitar(pagina,
                             self.mapToScene(evento.position().toPoint()))
        item = a.get("item")
        if item and item.scene() is not None:
            self.scene().removeItem(item)
        tipo = a["tipo"]
        if tipo == "mover":
            inicio = self.cena_para_pdf(pagina, a["inicio"])
            fim = self.cena_para_pdf(pagina, cena)
            if (cena - a["inicio"]).manhattanLength() >= 3:
                self.anotacaoArrastada.emit(pagina, a["xref"], fim.x - inicio.x,
                                            fim.y - inicio.y)
            else:
                self._desenhar_contorno()
            return
        if tipo == "traco":
            self.tracoFeito.emit(pagina, [a["pontos"]])
            return
        p0, p1 = a["inicio"], cena
        pequeno = (p1 - p0).manhattanLength() < 4
        if tipo == "linha":
            if not pequeno:
                self.linhaFeita.emit(self.ferramenta, pagina,
                                     self.cena_para_pdf(pagina, p0),
                                     self.cena_para_pdf(pagina, p1))
            return
        rect = self._rect_pdf(pagina, p0, p1)
        if tipo == "selecao":
            if not pequeno:
                self.selecaoFeita.emit(pagina, rect,
                                       evento.globalPosition().toPoint())
            return
        if pequeno and self.ferramenta not in (Ferramenta.CAIXA_TEXTO,
                                               Ferramenta.IMAGEM,
                                               Ferramenta.CAMPO_TEXTO,
                                               Ferramenta.CAIXA_SELECAO):
            return
        self.retanguloFeito.emit(self.ferramenta, pagina, rect)

    def _rect_pdf(self, pagina: int, p0: QPointF,
                  p1: QPointF) -> pymupdf.Rect:
        item = self._paginas[pagina]
        return coordenadas.retangulo_tela_para_pdf(
            self.documento.doc[pagina], p0.x() - item.x(), p0.y() - item.y(),
            p1.x() - item.x(), p1.y() - item.y(), self.zoom)

    def _menu_contexto(self, evento, cena: QPointF, pagina: int | None) -> None:
        if pagina is None:
            return
        from .. import anotacoes
        ponto = self.cena_para_pdf(pagina, cena)
        p = self.documento.doc[pagina]     # referencia viva: ver anotacoes._achar
        a = anotacoes.anotacao_em(p, ponto, folga=3 / self.zoom)
        if a is None:
            return
        self.selecionar_anotacao(pagina, a.xref)
        menu = QMenu(self)
        excluir = menu.addAction("Excluir anotação")
        if menu.exec(evento.globalPosition().toPoint()) is excluir:
            self.anotacaoExcluir.emit(pagina, a.xref)

    def keyPressEvent(self, evento) -> None:              # noqa: N802
        if evento.key() == Qt.Key.Key_Escape:
            self._cancelar_gesto()
            self.selecionar_anotacao(None)
            return
        if (evento.matches(QKeySequence.StandardKey.Delete)
                and self._selecionada):
            pagina, xref = self._selecionada
            self.anotacaoExcluir.emit(pagina, xref)
            return
        super().keyPressEvent(evento)
