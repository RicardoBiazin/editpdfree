"""Barra de atalhos personalizavel: qualquer item dos menus vira botao.

Cada acao tem um identificador ESTAVEL -- o nome do atributo na janela
("a_juntar") ou "ferramenta:<nome>" -- e a lista escolhida vai para o
config.json. Guardar o texto do menu nao serviria: ele muda com a versao (e
o "Desfazer" muda a cada operacao: "Desfazer Girar pagina").
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (QCheckBox, QDialog, QHBoxLayout, QLabel,
                               QLineEdit, QListWidget, QListWidgetItem,
                               QPushButton, QVBoxLayout)

from .dialogos import _botoes

#: Atalhos de fabrica: tarefas frequentes que so' existem nos menus.
PADRAO = ["a_juntar", "a_comparar", "a_ocr", "a_lote", "a_assinar_cert"]


def catalogo(janela) -> list[tuple[str, str, QAction]]:
    """(id, "Menu › Item", acao) de tudo que aparece nos menus, na ordem
    dos menus. Submenus entram com o caminho completo; "Abrir recente" fica
    de fora (os itens dele mudam o tempo todo)."""
    por_objeto: dict[int, str] = {}
    for nome, valor in vars(janela).items():
        if isinstance(valor, QAction) and nome.startswith("a_"):
            por_objeto[id(valor)] = nome
    for ferramenta, acao in janela.acoes_ferramenta.items():
        por_objeto[id(acao)] = f"ferramenta:{ferramenta.value}"

    itens: list[tuple[str, str, QAction]] = []
    vistos: set[str] = set()

    def percorrer(menu, caminho: str) -> None:
        for acao in menu.actions():
            if acao.isSeparator():
                continue
            submenu = acao.menu()
            rotulo = acao.text().replace("&", "")
            if submenu is not None:
                if submenu is getattr(janela, "menu_recentes", None):
                    continue
                percorrer(submenu, f"{caminho} › {rotulo}")
                continue
            ident = por_objeto.get(id(acao))
            if ident and ident not in vistos:
                vistos.add(ident)
                itens.append((ident, f"{caminho} › {rotulo}", acao))

    for acao_menu in janela.menuBar().actions():
        if acao_menu.menu() is not None:
            percorrer(acao_menu.menu(), acao_menu.text().replace("&", ""))
    return itens


class DialogoAtalhos(QDialog):
    def __init__(self, itens: list[tuple[str, str, QAction]],
                 escolhidos: list[str], com_texto: bool, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Personalizar barra de atalhos")
        self.resize(760, 480)
        self._itens = {ident: (caminho, acao) for ident, caminho, acao in itens}
        self._ordem = [ident for ident, _c, _a in itens]

        self.filtro = QLineEdit()
        self.filtro.setPlaceholderText("Filtrar…")
        self.filtro.setClearButtonEnabled(True)
        self.filtro.textChanged.connect(self._filtrar)
        self.disponiveis = QListWidget()
        self.disponiveis.itemDoubleClicked.connect(lambda _i: self.adicionar())
        self.na_barra = QListWidget()
        self.na_barra.itemDoubleClicked.connect(lambda _i: self.remover())

        botoes = QVBoxLayout()
        for texto, funcao in (("Adicionar →", self.adicionar),
                              ("← Remover", self.remover),
                              ("Subir", lambda: self.mover(-1)),
                              ("Descer", lambda: self.mover(1)),
                              ("Restaurar padrão", self.restaurar)):
            b = QPushButton(texto)
            b.clicked.connect(funcao)
            botoes.addWidget(b)
        botoes.addStretch()

        esquerda = QVBoxLayout()
        esquerda.addWidget(QLabel("Itens dos menus:"))
        esquerda.addWidget(self.filtro)
        esquerda.addWidget(self.disponiveis)
        direita = QVBoxLayout()
        direita.addWidget(QLabel("Na barra de atalhos (nesta ordem):"))
        direita.addWidget(self.na_barra)
        meio = QHBoxLayout()
        meio.addLayout(esquerda, 3)
        meio.addLayout(botoes)
        meio.addLayout(direita, 2)

        self.com_texto = QCheckBox("Mostrar o nome ao lado do ícone")
        self.com_texto.setChecked(com_texto)
        layout = QVBoxLayout(self)
        layout.addLayout(meio)
        layout.addWidget(self.com_texto)
        layout.addWidget(QLabel("Dica: clique com o botão direito em qualquer "
                                "barra para voltar aqui."))
        layout.addWidget(_botoes(self, "Aplicar"))
        self._definir(escolhidos)

    # -- estado ---------------------------------------------------------------
    def _item(self, ident: str) -> QListWidgetItem:
        caminho, acao = self._itens[ident]
        item = QListWidgetItem(acao.icon(), caminho)
        item.setData(Qt.ItemDataRole.UserRole, ident)
        return item

    def _definir(self, escolhidos: list[str]) -> None:
        self.na_barra.clear()
        for ident in escolhidos:
            if ident in self._itens:
                self.na_barra.addItem(self._item(ident))
        self._recarregar_disponiveis()

    def _recarregar_disponiveis(self) -> None:
        usados = set(self.escolhidos())
        self.disponiveis.clear()
        for ident in self._ordem:
            if ident not in usados:
                self.disponiveis.addItem(self._item(ident))
        self._filtrar(self.filtro.text())

    def _filtrar(self, texto: str) -> None:
        termo = texto.strip().lower()
        for i in range(self.disponiveis.count()):
            item = self.disponiveis.item(i)
            item.setHidden(bool(termo) and termo not in item.text().lower())

    def escolhidos(self) -> list[str]:
        return [self.na_barra.item(i).data(Qt.ItemDataRole.UserRole)
                for i in range(self.na_barra.count())]

    # -- acoes ----------------------------------------------------------------
    def adicionar(self) -> None:
        item = self.disponiveis.currentItem()
        if item is None or item.isHidden():
            return
        ident = item.data(Qt.ItemDataRole.UserRole)
        self.na_barra.addItem(self._item(ident))
        self.na_barra.setCurrentRow(self.na_barra.count() - 1)
        self._recarregar_disponiveis()

    def remover(self) -> None:
        linha = self.na_barra.currentRow()
        if linha < 0:
            return
        self.na_barra.takeItem(linha)
        self._recarregar_disponiveis()

    def mover(self, passo: int) -> None:
        linha = self.na_barra.currentRow()
        nova = linha + passo
        if linha < 0 or not 0 <= nova < self.na_barra.count():
            return
        item = self.na_barra.takeItem(linha)
        self.na_barra.insertItem(nova, item)
        self.na_barra.setCurrentRow(nova)

    def restaurar(self) -> None:
        self._definir(PADRAO)
