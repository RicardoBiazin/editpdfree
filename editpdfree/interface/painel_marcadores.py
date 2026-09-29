"""Painel de marcadores (sumario lateral): navegar e editar."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QHBoxLayout, QToolButton, QTreeWidget,
                               QTreeWidgetItem, QVBoxLayout, QWidget)

from .. import marcadores
from ..documento import Documento


class PainelMarcadores(QWidget):
    paginaEscolhida = Signal(int)
    #: (acao, indice) -- adicionar, renomear, excluir, subir, descer,
    #: recuar, avancar
    acaoPedida = Signal(str, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.documento: Documento | None = None
        self.arvore = QTreeWidget()
        self.arvore.setHeaderHidden(True)
        self.arvore.itemClicked.connect(self._clicou)
        self.arvore.itemDoubleClicked.connect(
            lambda item, _c: self.acaoPedida.emit("renomear", self._indice(item)))
        botoes = QHBoxLayout()
        botoes.setContentsMargins(0, 0, 0, 0)
        for texto, acao, dica in (("+", "adicionar", "Adicionar marcador para a página atual"),
                                  ("✎", "renomear", "Renomear"),
                                  ("↑", "subir", "Subir"),
                                  ("↓", "descer", "Descer"),
                                  ("←", "recuar", "Subir um nível"),
                                  ("→", "avancar", "Descer um nível"),
                                  ("✕", "excluir", "Excluir")):
            b = QToolButton()
            b.setText(texto)
            b.setToolTip(dica)
            b.clicked.connect(lambda _c=False, a=acao: self.acaoPedida.emit(
                a, self.indice_atual()))
            botoes.addWidget(b)
        botoes.addStretch()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.addLayout(botoes)
        layout.addWidget(self.arvore)

    def definir_documento(self, documento: Documento) -> None:
        self.documento = documento
        self.recarregar()

    def recarregar(self, selecionar: int | None = None) -> None:
        self.arvore.clear()
        if self.documento is None:
            return
        pilha: list[tuple[int, QTreeWidgetItem | None]] = [(0, None)]
        itens = []
        for i, m in enumerate(marcadores.ler(self.documento)):
            while pilha and pilha[-1][0] >= m.nivel:
                pilha.pop()
            pai = pilha[-1][1] if pilha else None
            item = QTreeWidgetItem([m.titulo])
            item.setData(0, Qt.ItemDataRole.UserRole, i)
            item.setData(0, Qt.ItemDataRole.UserRole + 1, m.pagina)
            item.setToolTip(0, f"Página {m.pagina + 1}")
            if pai is None:
                self.arvore.addTopLevelItem(item)
            else:
                pai.addChild(item)
            pilha.append((m.nivel, item))
            itens.append(item)
        self.arvore.expandAll()
        if selecionar is not None and 0 <= selecionar < len(itens):
            self.arvore.setCurrentItem(itens[selecionar])

    def _indice(self, item: QTreeWidgetItem | None) -> int:
        return item.data(0, Qt.ItemDataRole.UserRole) if item else -1

    def indice_atual(self) -> int:
        return self._indice(self.arvore.currentItem())

    def _clicou(self, item: QTreeWidgetItem, _coluna: int) -> None:
        self.paginaEscolhida.emit(item.data(0, Qt.ItemDataRole.UserRole + 1))
