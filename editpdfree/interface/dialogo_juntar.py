"""Dialogo "Juntar PDFs": escolher os arquivos e a ORDEM.

Cada linha mostra a miniatura da primeira pagina, o nome, o numero de
paginas e o intervalo escolhido. Ordem: arrastar, Subir/Descer (ou Alt+seta),
ordenar por nome (natural: "doc2" antes de "doc10"), por data, ou inverter.
Arquivos podem ser soltos do Explorer direto na lista.
"""

from __future__ import annotations

import pathlib
from typing import Callable

import pymupdf
from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QIcon, QKeySequence, QShortcut
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QDialog,
                               QFileDialog, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMessageBox,
                               QPushButton, QVBoxLayout)

from .. import juntar
from ..documento import SenhaNecessaria
from .dialogos import FILTRO_ENTRADA, _botoes
from .visualizador import pixmap_da_pagina

MINIATURA = 56


class _Lista(QListWidget):
    """Reordena arrastando (interno) e aceita arquivos soltos do Explorer."""
    arquivosSoltos = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setIconSize(QSize(MINIATURA, MINIATURA))
        self.setDragDropMode(QAbstractItemView.DragDropMode.DragDrop)
        self.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.setSpacing(2)

    def dragEnterEvent(self, e) -> None:                  # noqa: N802
        if e.mimeData().hasUrls() and e.source() is not self:
            e.acceptProposedAction()
        else:
            super().dragEnterEvent(e)

    def dragMoveEvent(self, e) -> None:                   # noqa: N802
        if e.mimeData().hasUrls() and e.source() is not self:
            e.acceptProposedAction()
        else:
            super().dragMoveEvent(e)

    def dropEvent(self, e) -> None:                       # noqa: N802
        if e.mimeData().hasUrls() and e.source() is not self:
            self.arquivosSoltos.emit([u.toLocalFile() for u in e.mimeData().urls()
                                      if u.isLocalFile()])
            e.acceptProposedAction()
            return
        # Arrastar interno: o Qt move a linha. O item guarda so' uma CHAVE
        # inteira (ver DialogoJuntar._fontes): se o Qt serializar o item no
        # arrasto, um objeto Python no UserRole nao sobreviveria.
        super().dropEvent(e)


class DialogoJuntar(QDialog):
    def __init__(self, parent=None, pasta: str = "",
                 abertos: list[tuple[str, pymupdf.Document]] | None = None,
                 pedir_senha: Callable[[str, bool], str | None] | None = None):
        super().__init__(parent)
        self.setWindowTitle("Juntar PDFs")
        self.resize(720, 560)
        self._pasta = pasta
        self._abertos = abertos or []
        self._fontes: dict[int, juntar.Fonte] = {}
        self._proxima = 0
        if pedir_senha is None:
            from .dialogos import pedir_senha as padrao
            pedir_senha = lambda nome, erro: padrao(self, nome, erro)  # noqa: E731
        self._pedir_senha = pedir_senha

        self.lista = _Lista()
        self.lista.arquivosSoltos.connect(self.adicionar_arquivos)
        self.lista.currentItemChanged.connect(self._selecionou)
        self.lista.model().rowsMoved.connect(lambda *_: self._atualizar_resumo())

        botoes = QVBoxLayout()
        for rotulo, funcao in (("Adicionar arquivos…", self._adicionar),
                               ("Adicionar abas abertas", self.adicionar_abertos),
                               ("Remover", self.remover),
                               (None, None),
                               ("Subir", lambda: self.mover(-1)),
                               ("Descer", lambda: self.mover(1)),
                               (None, None),
                               ("Ordenar por nome", self.ordenar_nome),
                               ("Ordenar por data", self.ordenar_data),
                               ("Inverter ordem", self.inverter)):
            if rotulo is None:
                botoes.addSpacing(10)
                continue
            b = QPushButton(rotulo)
            b.clicked.connect(funcao)
            botoes.addWidget(b)
            if rotulo == "Adicionar abas abertas":
                b.setEnabled(bool(self._abertos))
        botoes.addStretch()
        QShortcut(QKeySequence("Alt+Up"), self, lambda: self.mover(-1))
        QShortcut(QKeySequence("Alt+Down"), self, lambda: self.mover(1))
        QShortcut(QKeySequence.StandardKey.Delete, self.lista, self.remover)

        self.intervalo = QLineEdit()
        self.intervalo.setPlaceholderText("todas as páginas — ou ex.: 1-3, 5, 8-")
        self.intervalo.setEnabled(False)
        self.intervalo.textEdited.connect(self._mudou_intervalo)
        self.erro_intervalo = QLabel("")
        self.erro_intervalo.setStyleSheet("color: #d33;")
        linha_intervalo = QHBoxLayout()
        linha_intervalo.addWidget(QLabel("Páginas do arquivo selecionado:"))
        linha_intervalo.addWidget(self.intervalo, 1)

        self.marcadores = QCheckBox("Criar um marcador (sumário) com o nome de "
                                    "cada arquivo")
        self.resumo = QLabel("")

        meio = QHBoxLayout()
        meio.addWidget(self.lista, 1)
        meio.addLayout(botoes)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Arquivos na ordem em que serão juntados. "
                                "Arraste para reordenar ou solte arquivos do "
                                "Explorer aqui. Imagens e documentos do "
                                "Office viram páginas."))
        layout.addLayout(meio)
        layout.addLayout(linha_intervalo)
        layout.addWidget(self.erro_intervalo)
        layout.addWidget(self.marcadores)
        layout.addWidget(self.resumo)
        layout.addWidget(_botoes(self, "Juntar"))
        self._atualizar_resumo()

    # -- itens -------------------------------------------------------------------
    def _item(self, fonte: juntar.Fonte) -> QListWidgetItem:
        item = QListWidgetItem()
        try:
            with juntar._abrir(fonte.dados, fonte.senha) as doc:
                p = doc[0]
                escala = MINIATURA / max(p.rect.width, p.rect.height)
                item.setIcon(QIcon(pixmap_da_pagina(p, escala)))
        except Exception:                           # noqa: BLE001
            pass
        self._proxima += 1
        self._fontes[self._proxima] = fonte
        item.setData(Qt.ItemDataRole.UserRole, self._proxima)
        self._rotular(item)
        return item

    def _fonte(self, item: QListWidgetItem) -> juntar.Fonte:
        return self._fontes[item.data(Qt.ItemDataRole.UserRole)]

    def _rotular(self, item: QListWidgetItem) -> None:
        f = self._fonte(item)
        try:
            n = len(f.indices())
            escolha = (f"{n} de {f.paginas} página(s) ({f.intervalo})"
                       if f.intervalo.strip() else f"{f.paginas} página(s)")
        except ValueError:
            escolha = "intervalo inválido"
        # So' a pasta (o caminho inteiro fica na dica): caminho longo
        # empurrava a lista para uma barra de rolagem horizontal.
        origem = f"pasta {f.caminho.parent.name}" if f.caminho else "documento aberto"
        item.setText(f"{f.nome}\n{escolha} — {origem}")
        item.setToolTip(str(f.caminho) if f.caminho else f.nome)

    def fontes(self) -> list[juntar.Fonte]:
        return [self._fonte(self.lista.item(i))
                for i in range(self.lista.count())]

    def _definir_fontes(self, fontes: list[juntar.Fonte]) -> None:
        atual = self.lista.currentItem()
        atual_fonte = self._fonte(atual) if atual else None
        itens = {id(self._fonte(self.lista.item(i))): self.lista.takeItem(i)
                 for i in reversed(range(self.lista.count()))}
        for f in fontes:
            self.lista.addItem(itens.get(id(f)) or self._item(f))
        if atual_fonte is not None:
            self.lista.setCurrentRow(fontes.index(atual_fonte))
        self._atualizar_resumo()

    # -- adicionar ------------------------------------------------------------------
    def _adicionar(self) -> None:
        arquivos, _ = QFileDialog.getOpenFileNames(
            self, "Adicionar arquivos", self._pasta, FILTRO_ENTRADA)
        self.adicionar_arquivos(arquivos)

    def adicionar_arquivos(self, caminhos: list[str]) -> int:
        problemas = []
        adicionados = 0
        for caminho in caminhos:
            fonte = self._carregar(caminho, problemas)
            if fonte is not None:
                self.lista.addItem(self._item(fonte))
                adicionados += 1
        if adicionados:
            self.lista.setCurrentRow(self.lista.count() - 1)
        self._atualizar_resumo()
        if problemas:
            QMessageBox.warning(self, "Juntar PDFs",
                                "Não foi possível adicionar:\n\n"
                                + "\n".join(problemas))
        return adicionados

    def _carregar(self, caminho: str, problemas: list[str]) -> juntar.Fonte | None:
        nome = pathlib.Path(caminho).name
        senha = None
        erro = False
        while True:
            try:
                return juntar.carregar(caminho, senha)
            except SenhaNecessaria:
                senha = self._pedir_senha(nome, erro)
                if senha is None:
                    problemas.append(f"• {nome}: protegido por senha")
                    return None
                erro = True
            except Exception as e:                  # noqa: BLE001
                problemas.append(f"• {nome}: {e}")
                return None

    def adicionar_abertos(self) -> None:
        for nome, doc in self._abertos:
            self.lista.addItem(self._item(juntar.de_documento(nome, doc)))
        self._atualizar_resumo()

    # -- ordem ------------------------------------------------------------------------
    def remover(self) -> None:
        for item in self.lista.selectedItems():
            self.lista.takeItem(self.lista.row(item))
        self._atualizar_resumo()

    def mover(self, passo: int) -> None:
        linha = self.lista.currentRow()
        nova = linha + passo
        if linha < 0 or not 0 <= nova < self.lista.count():
            return
        item = self.lista.takeItem(linha)
        self.lista.insertItem(nova, item)
        self.lista.setCurrentRow(nova)
        self._atualizar_resumo()

    def ordenar_nome(self) -> None:
        self._definir_fontes(juntar.ordenar_por_nome(self.fontes()))

    def ordenar_data(self) -> None:
        self._definir_fontes(juntar.ordenar_por_data(self.fontes()))

    def inverter(self) -> None:
        self._definir_fontes(list(reversed(self.fontes())))

    # -- intervalo ----------------------------------------------------------------------
    def _selecionou(self, item: QListWidgetItem | None, _anterior=None) -> None:
        self.intervalo.setEnabled(item is not None)
        self.intervalo.setText(self._fonte(item).intervalo if item else "")
        self._validar()

    def _mudou_intervalo(self, texto: str) -> None:
        item = self.lista.currentItem()
        if item is None:
            return
        self._fonte(item).intervalo = texto
        self._rotular(item)
        self._validar()
        self._atualizar_resumo()

    def _validar(self) -> bool:
        for f in self.fontes():
            try:
                f.indices()
            except ValueError as erro:
                self.erro_intervalo.setText(f"{f.nome}: {erro}")
                return False
        self.erro_intervalo.setText("")
        return True

    def _atualizar_resumo(self) -> None:
        fontes = self.fontes()
        try:
            total = sum(len(f.indices()) for f in fontes)
            self.resumo.setText(f"{len(fontes)} arquivo(s), {total} página(s) "
                                "no resultado.")
        except ValueError:
            self.resumo.setText(f"{len(fontes)} arquivo(s).")

    def accept(self) -> None:
        if not self.fontes():
            QMessageBox.warning(self, "Juntar PDFs", "Adicione arquivos.")
            return
        if not self._validar():
            QMessageBox.warning(self, "Juntar PDFs",
                                self.erro_intervalo.text())
            return
        super().accept()
