"""Janela de comparacao: as duas versoes lado a lado, com as diferencas
destacadas (vermelho = saiu da anterior, verde = entrou na nova) e a lista
de mudancas para navegar."""

from __future__ import annotations

import pathlib

import pymupdf
from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (QDialog, QHBoxLayout, QLabel, QListWidget,
                               QListWidgetItem, QSplitter, QVBoxLayout,
                               QWidget)

from .. import comparar
from ..documento import Documento
from .visualizador import Visualizador


class JanelaComparacao(QDialog):
    def __init__(self, caminho_a: str, caminho_b: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Comparar PDFs")
        self.resize(1300, 820)
        self.setWindowFlag(Qt.WindowType.WindowMaximizeButtonHint, True)
        with pymupdf.open(caminho_a) as a, pymupdf.open(caminho_b) as b:
            self.diferencas = comparar.comparar(a, b)
            marcado_a = comparar.marcar(a, self.diferencas, "a")
            marcado_b = comparar.marcar(b, self.diferencas, "b")
        self.doc_a = Documento(dados=marcado_a.tobytes(),
                               nome=pathlib.Path(caminho_a).name)
        self.doc_b = Documento(dados=marcado_b.tobytes(),
                               nome=pathlib.Path(caminho_b).name)
        marcado_a.close()
        marcado_b.close()

        self.vis_a = Visualizador()
        self.vis_b = Visualizador()
        self.vis_a.definir_documento(self.doc_a)
        self.vis_b.definir_documento(self.doc_b)
        self.lista = QListWidget()
        rotulos = {"inserido": "Inserido", "removido": "Removido",
                   "alterado": "Alterado"}
        for n, dif in enumerate(self.diferencas):
            pag = dif.pagina_b() if dif.pagina_b() is not None else dif.pagina_a()
            item = QListWidgetItem(f"{rotulos[dif.tipo]} (p. {pag + 1}): "
                                   f"{dif.rotulo}")
            item.setData(Qt.ItemDataRole.UserRole, n)
            item.setToolTip(dif.rotulo)
            self.lista.addItem(item)
        self.lista.currentItemChanged.connect(self._ir)

        def coluna(titulo: str, vis: Visualizador) -> QWidget:
            w = QWidget()
            lay = QVBoxLayout(w)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.addWidget(QLabel(titulo))
            lay.addWidget(vis)
            return w

        divisor = QSplitter(Qt.Orientation.Horizontal)
        divisor.addWidget(coluna(f"Anterior: {self.doc_a.nome}  "
                                 "(vermelho = saiu)", self.vis_a))
        divisor.addWidget(coluna(f"Nova: {self.doc_b.nome}  "
                                 "(verde = entrou)", self.vis_b))
        lateral = QWidget()
        lay = QVBoxLayout(lateral)
        lay.setContentsMargins(0, 0, 0, 0)
        total = len(self.diferencas)
        lay.addWidget(QLabel(f"{total} diferença(s)" if total
                             else "Os textos são iguais."))
        lay.addWidget(self.lista)
        divisor.addWidget(lateral)
        divisor.setSizes([520, 520, 260])
        layout = QHBoxLayout(self)
        layout.addWidget(divisor)
        QTimer.singleShot(0, lambda: (self.vis_a.ajustar_largura(1.2),
                                      self.vis_b.ajustar_largura(1.2)))

    def _ir(self, item: QListWidgetItem | None, _anterior=None) -> None:
        if item is None:
            return
        dif = self.diferencas[item.data(Qt.ItemDataRole.UserRole)]
        if dif.em_a:
            self.vis_a.mostrar_retangulo(*dif.em_a[0])
        if dif.em_b:
            self.vis_b.mostrar_retangulo(*dif.em_b[0])

    def closeEvent(self, evento) -> None:                  # noqa: N802
        for vis, doc in ((self.vis_a, self.doc_a), (self.vis_b, self.doc_b)):
            vis._temporizador.stop()
            vis.documento = None
            doc.fechar()
        super().closeEvent(evento)
