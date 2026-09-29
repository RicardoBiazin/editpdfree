"""Painel de miniaturas: navegar, reordenar arrastando e menu de pagina.

Modo LISTA, e nao icone, de proposito: no `IconMode` do Qt o arrastar interno
so' muda a POSICAO desenhada do item, nao a ordem das linhas -- a lista parece
reordenada e o modelo continua como estava. Em `ListMode` o arrastar move a
linha de verdade, e a nova ordem e' lida dos proprios itens.

As miniaturas tambem sao preguicosas: so' as visiveis sao renderizadas.
"""

from __future__ import annotations

from PySide6.QtCore import QSize, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QIcon, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QListView, QListWidget,
                               QListWidgetItem, QMenu)

from ..documento import Documento
from .visualizador import pixmap_da_pagina

LARGURA = 110


class Miniaturas(QListWidget):
    paginaEscolhida = Signal(int)
    ordemMudou = Signal(list)
    #: (acao, [indices]) -- acao: girar_esq, girar_dir, excluir, duplicar,
    #: branco_depois, extrair, inserir_arquivo
    acaoPedida = Signal(str, list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.documento: Documento | None = None
        self.setViewMode(QListView.ViewMode.ListMode)
        self.setFlow(QListView.Flow.TopToBottom)
        self.setIconSize(QSize(LARGURA, int(LARGURA * 1.42)))
        self.setSpacing(4)
        self.setUniformItemSizes(False)
        self.setSelectionMode(
            QAbstractItemView.SelectionMode.ExtendedSelection)
        self.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        self.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.setMinimumWidth(LARGURA + 70)
        # Fundo cinza: pagina branca sobre lista branca nao tem contorno.
        self.setStyleSheet("QListWidget { background: #d9dadc; color: #222; }")
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.customContextMenuRequested.connect(self._menu)
        self.itemClicked.connect(
            lambda item: self.paginaEscolhida.emit(item.data(Qt.ItemDataRole.UserRole)))
        self._temporizador = QTimer(self)
        self._temporizador.setSingleShot(True)
        self._temporizador.setInterval(60)
        self._temporizador.timeout.connect(self._renderizar_visiveis)
        self.verticalScrollBar().valueChanged.connect(
            lambda _v: self._temporizador.start())

    def definir_documento(self, documento: Documento) -> None:
        self.documento = documento
        self.recarregar()

    def recarregar(self) -> None:
        atual = self.currentRow()
        self.blockSignals(True)
        self.clear()
        if self.documento is not None:
            vazio = QPixmap(self.iconSize())
            vazio.fill(QColor(235, 235, 235))
            for i in range(self.documento.paginas):
                item = QListWidgetItem(QIcon(vazio), str(i + 1))
                item.setData(Qt.ItemDataRole.UserRole, i)
                item.setData(Qt.ItemDataRole.UserRole + 1, False)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                self.addItem(item)
            if 0 <= atual < self.count():
                self.setCurrentRow(atual)
        self.blockSignals(False)
        self._temporizador.start()

    def showEvent(self, evento) -> None:                  # noqa: N802
        super().showEvent(evento)
        self._temporizador.start()

    def resizeEvent(self, evento) -> None:                # noqa: N802
        super().resizeEvent(evento)
        self._temporizador.start()

    def _renderizar_visiveis(self) -> None:
        if self.documento is None:
            return
        area = self.viewport().rect()
        for linha in range(self.count()):
            item = self.item(linha)
            if item.data(Qt.ItemDataRole.UserRole + 1):
                continue
            if not self.visualItemRect(item).intersects(area):
                continue
            i = item.data(Qt.ItemDataRole.UserRole)
            pagina = self.documento.doc[i]
            caixa = self.iconSize()
            escala = min(caixa.width() / pagina.rect.width,
                         caixa.height() / pagina.rect.height)
            item.setIcon(QIcon(pixmap_da_pagina(pagina, escala)))
            item.setData(Qt.ItemDataRole.UserRole + 1, True)

    def marcar_pagina(self, indice: int) -> None:
        if 0 <= indice < self.count():
            self.blockSignals(True)
            self.setCurrentRow(indice)
            self.scrollToItem(self.item(indice))
            self.blockSignals(False)

    def indices_selecionados(self) -> list[int]:
        return sorted(item.data(Qt.ItemDataRole.UserRole)
                      for item in self.selectedItems())

    def dropEvent(self, evento) -> None:                  # noqa: N802
        super().dropEvent(evento)
        ordem = [self.item(i).data(Qt.ItemDataRole.UserRole)
                 for i in range(self.count())]
        if ordem != list(range(len(ordem))):
            # Depois do evento: emitir aqui dentro faria o documento recarregar
            # a lista enquanto o Qt ainda finaliza o arrastar.
            QTimer.singleShot(0, lambda: self.ordemMudou.emit(ordem))

    def _menu(self, posicao) -> None:
        item = self.itemAt(posicao)
        if item is None:
            return
        if not item.isSelected():
            self.clearSelection()
            item.setSelected(True)
        indices = self.indices_selecionados()
        menu = QMenu(self)
        acoes = {
            menu.addAction("Girar à esquerda"): "girar_esq",
            menu.addAction("Girar à direita"): "girar_dir",
        }
        menu.addSeparator()
        acoes[menu.addAction("Duplicar")] = "duplicar"
        acoes[menu.addAction("Inserir página em branco depois")] = "branco_depois"
        acoes[menu.addAction("Inserir arquivo depois…")] = "inserir_arquivo"
        acoes[menu.addAction("Extrair para novo PDF…")] = "extrair"
        menu.addSeparator()
        acoes[menu.addAction("Excluir")] = "excluir"
        escolhida = menu.exec(self.viewport().mapToGlobal(posicao))
        if escolhida in acoes:
            self.acaoPedida.emit(acoes[escolhida], indices)
