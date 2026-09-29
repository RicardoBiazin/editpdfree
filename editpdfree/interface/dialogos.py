"""Dialogos: juntar, dividir, senha, marca d'agua, numeracao, compressao,
exportacao, formulario, propriedades, editar texto e assinatura."""

from __future__ import annotations

import pathlib

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QPointF, Qt
from PySide6.QtGui import QColor, QImage, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QCheckBox, QColorDialog, QComboBox, QDialog,
                               QDialogButtonBox, QDoubleSpinBox, QFileDialog,
                               QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QMessageBox, QPushButton,
                               QRadioButton, QSpinBox, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from .. import extras, formularios

FILTRO_PDF = "Documentos PDF (*.pdf)"
FILTRO_ENTRADA = ("PDF e imagens (*.pdf *.png *.jpg *.jpeg *.bmp *.gif *.tif "
                  "*.tiff *.webp);;Documentos PDF (*.pdf);;Todos os arquivos (*)")
FILTRO_IMAGEM = "Imagens (*.png *.jpg *.jpeg *.bmp *.gif *.tif *.tiff *.webp)"


def _botoes(dialogo: QDialog, rotulo_ok: str = "OK") -> QDialogButtonBox:
    caixa = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok
                             | QDialogButtonBox.StandardButton.Cancel)
    caixa.button(QDialogButtonBox.StandardButton.Ok).setText(rotulo_ok)
    caixa.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancelar")
    caixa.accepted.connect(dialogo.accept)
    caixa.rejected.connect(dialogo.reject)
    return caixa


def cor_qt(cor) -> QColor:
    return QColor.fromRgbF(*cor)


def cor_pdf(cor: QColor) -> tuple[float, float, float]:
    return (cor.redF(), cor.greenF(), cor.blueF())


class BotaoCor(QPushButton):
    def __init__(self, cor=(0, 0, 0), parent=None):
        super().__init__(parent)
        self.setFixedWidth(46)
        self.setToolTip("Cor")
        self.definir(cor)
        self.clicked.connect(self._escolher)

    def definir(self, cor) -> None:
        self.cor = tuple(cor)
        c = cor_qt(self.cor)
        self.setStyleSheet(f"background-color: {c.name()}; border: 1px solid "
                           "#777; min-height: 18px;")

    def _escolher(self) -> None:
        c = QColorDialog.getColor(cor_qt(self.cor), self, "Escolher cor")
        if c.isValid():
            self.definir(cor_pdf(c))


# -- juntar -------------------------------------------------------------------
class DialogoJuntar(QDialog):
    def __init__(self, parent=None, pasta: str = ""):
        super().__init__(parent)
        self.setWindowTitle("Juntar PDFs")
        self.resize(560, 380)
        self._pasta = pasta
        self.lista = QListWidget()
        self.lista.setDragDropMode(QListWidget.DragDropMode.InternalMove)
        botoes = QVBoxLayout()
        for rotulo, funcao in (("Adicionar…", self._adicionar),
                               ("Remover", self._remover),
                               ("Subir", lambda: self._mover(-1)),
                               ("Descer", lambda: self._mover(1))):
            b = QPushButton(rotulo)
            b.clicked.connect(funcao)
            botoes.addWidget(b)
        botoes.addStretch()
        meio = QHBoxLayout()
        meio.addWidget(self.lista)
        meio.addLayout(botoes)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Arquivos na ordem em que serão juntados "
                                "(arraste para reordenar). Imagens viram "
                                "páginas."))
        layout.addLayout(meio)
        layout.addWidget(_botoes(self, "Juntar…"))

    def _adicionar(self) -> None:
        arquivos, _ = QFileDialog.getOpenFileNames(
            self, "Adicionar arquivos", self._pasta, FILTRO_ENTRADA)
        self.lista.addItems(arquivos)

    def _remover(self) -> None:
        for item in self.lista.selectedItems():
            self.lista.takeItem(self.lista.row(item))

    def _mover(self, passo: int) -> None:
        linha = self.lista.currentRow()
        nova = linha + passo
        if linha < 0 or not (0 <= nova < self.lista.count()):
            return
        item = self.lista.takeItem(linha)
        self.lista.insertItem(nova, item)
        self.lista.setCurrentRow(nova)

    def arquivos(self) -> list[str]:
        return [self.lista.item(i).text() for i in range(self.lista.count())]

    def accept(self) -> None:
        if self.lista.count() < 2:
            QMessageBox.warning(self, "Juntar PDFs",
                                "Adicione pelo menos dois arquivos.")
            return
        super().accept()


# -- dividir ------------------------------------------------------------------
class DialogoDividir(QDialog):
    def __init__(self, total: int, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Dividir documento")
        self.a_cada = QRadioButton("A cada")
        self.a_cada.setChecked(True)
        self.n = QSpinBox()
        self.n.setRange(1, max(1, total))
        self.n.setValue(1)
        self.por_intervalo = QRadioButton("Por intervalos:")
        self.intervalos = QLineEdit()
        self.intervalos.setPlaceholderText(f"ex.: 1-3, 4, 5-{total}")
        linha1 = QHBoxLayout()
        linha1.addWidget(self.a_cada)
        linha1.addWidget(self.n)
        linha1.addWidget(QLabel("página(s) por arquivo"))
        linha1.addStretch()
        linha2 = QHBoxLayout()
        linha2.addWidget(self.por_intervalo)
        linha2.addWidget(self.intervalos)
        layout = QVBoxLayout(self)
        layout.addLayout(linha1)
        layout.addLayout(linha2)
        layout.addWidget(QLabel("Cada intervalo vira um arquivo."))
        layout.addWidget(_botoes(self, "Escolher pasta…"))


# -- senha ----------------------------------------------------------------------
class DialogoSenha(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Proteger com senha")
        self.abrir = QLineEdit()
        self.abrir.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirmar = QLineEdit()
        self.confirmar.setEchoMode(QLineEdit.EchoMode.Password)
        self.dono = QLineEdit()
        self.dono.setEchoMode(QLineEdit.EchoMode.Password)
        self.dono.setPlaceholderText("opcional: a mesma de abrir")
        self.imprimir = QCheckBox("Permitir imprimir")
        self.imprimir.setChecked(True)
        self.copiar = QCheckBox("Permitir copiar texto")
        self.copiar.setChecked(True)
        self.editar = QCheckBox("Permitir alterar o documento")
        self.anotar = QCheckBox("Permitir anotações e formulários")
        self.anotar.setChecked(True)
        form = QFormLayout()
        form.addRow("Senha para abrir:", self.abrir)
        form.addRow("Confirmar:", self.confirmar)
        form.addRow("Senha do proprietário:", self.dono)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        for c in (self.imprimir, self.copiar, self.editar, self.anotar):
            layout.addWidget(c)
        layout.addWidget(QLabel("Criptografia AES-256. A proteção é aplicada "
                                "ao salvar."))
        layout.addWidget(_botoes(self, "Proteger"))

    def permissoes(self) -> int:
        import pymupdf
        p = pymupdf.PDF_PERM_ACCESSIBILITY
        if self.imprimir.isChecked():
            p |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
        if self.copiar.isChecked():
            p |= pymupdf.PDF_PERM_COPY
        if self.editar.isChecked():
            p |= pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_ASSEMBLE
        if self.anotar.isChecked():
            p |= pymupdf.PDF_PERM_ANNOTATE | pymupdf.PDF_PERM_FORM
        return p

    def accept(self) -> None:
        if not self.abrir.text() and not self.dono.text():
            QMessageBox.warning(self, "Senha", "Informe ao menos uma senha.")
            return
        if self.abrir.text() != self.confirmar.text():
            QMessageBox.warning(self, "Senha", "As senhas não conferem.")
            return
        super().accept()


# -- marca d'agua ---------------------------------------------------------------
class DialogoMarcaDagua(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Marca d’água")
        self.texto = QLineEdit("CONFIDENCIAL")
        self.tamanho = QSpinBox()
        self.tamanho.setRange(8, 300)
        self.tamanho.setValue(60)
        self.opacidade = QSpinBox()
        self.opacidade.setRange(5, 100)
        self.opacidade.setValue(30)
        self.opacidade.setSuffix(" %")
        self.cor = BotaoCor((0.6, 0.6, 0.6))
        self.diagonal = QCheckBox("Na diagonal")
        self.diagonal.setChecked(True)
        form = QFormLayout(self)
        form.addRow("Texto:", self.texto)
        form.addRow("Tamanho:", self.tamanho)
        form.addRow("Opacidade:", self.opacidade)
        form.addRow("Cor:", self.cor)
        form.addRow("", self.diagonal)
        form.addRow(_botoes(self, "Aplicar"))


# -- numeracao ------------------------------------------------------------------
class DialogoNumeracao(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Numerar páginas")
        self.formato = QComboBox()
        self.formato.setEditable(True)
        self.formato.addItems(["{n} / {total}", "{n}", "Página {n}",
                               "Página {n} de {total}", "- {n} -"])
        self.posicao = QComboBox()
        for chave, rotulo in extras.POSICOES.items():
            self.posicao.addItem(rotulo, chave)
        self.tamanho = QSpinBox()
        self.tamanho.setRange(5, 72)
        self.tamanho.setValue(10)
        self.inicio = QSpinBox()
        self.inicio.setRange(0, 99999)
        self.inicio.setValue(1)
        form = QFormLayout(self)
        form.addRow("Formato:", self.formato)
        form.addRow("Posição:", self.posicao)
        form.addRow("Tamanho:", self.tamanho)
        form.addRow("Começar em:", self.inicio)
        form.addRow(QLabel("Use {n} para o número e {total} para o total."))
        form.addRow(_botoes(self, "Numerar"))


# -- comprimir ------------------------------------------------------------------
class DialogoComprimir(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Comprimir")
        self.dpi = QSpinBox()
        self.dpi.setRange(36, 600)
        self.dpi.setValue(110)
        self.dpi.setSuffix(" dpi")
        self.qualidade = QSpinBox()
        self.qualidade.setRange(10, 100)
        self.qualidade.setValue(70)
        self.qualidade.setSuffix(" %")
        form = QFormLayout(self)
        form.addRow("Resolução das imagens:", self.dpi)
        form.addRow("Qualidade JPEG:", self.qualidade)
        form.addRow(QLabel("Imagens acima da resolução são reduzidas. O "
                           "tamanho final aparece ao salvar."))
        form.addRow(_botoes(self, "Comprimir"))


# -- exportar -------------------------------------------------------------------
class DialogoExportar(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Exportar páginas como imagens")
        self.formato = QComboBox()
        self.formato.addItems(["png", "jpg"])
        self.dpi = QSpinBox()
        self.dpi.setRange(36, 1200)
        self.dpi.setValue(150)
        self.dpi.setSuffix(" dpi")
        self.so_atual = QCheckBox("Só a página atual")
        form = QFormLayout(self)
        form.addRow("Formato:", self.formato)
        form.addRow("Resolução:", self.dpi)
        form.addRow("", self.so_atual)
        form.addRow(_botoes(self, "Escolher pasta…"))


# -- formulario -----------------------------------------------------------------
class DialogoFormulario(QDialog):
    """Todos os campos do documento numa tabela editavel."""

    def __init__(self, campos: list[formularios.Campo], parent=None):
        super().__init__(parent)
        self.setWindowTitle("Preencher formulário")
        self.resize(640, 420)
        self.campos = campos
        self.tabela = QTableWidget(len(campos), 4)
        self.tabela.setHorizontalHeaderLabels(["Página", "Campo", "Tipo",
                                               "Valor"])
        self.tabela.horizontalHeader().setStretchLastSection(True)
        self.editores: list[QWidget] = []
        for linha, c in enumerate(campos):
            for coluna, texto in enumerate((str(c.pagina + 1), c.nome,
                                            c.tipo_legivel)):
                item = QTableWidgetItem(texto)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.tabela.setItem(linha, coluna, item)
            if c.marcavel:
                editor = QCheckBox()
                editor.setChecked(bool(c.valor))
            elif c.opcoes:
                editor = QComboBox()
                editor.setEditable(True)
                editor.addItems(c.opcoes)
                editor.setCurrentText(str(c.valor))
            else:
                editor = QLineEdit(str(c.valor))
            self.tabela.setCellWidget(linha, 3, editor)
            self.editores.append(editor)
        self.tabela.resizeColumnsToContents()
        layout = QVBoxLayout(self)
        if not campos:
            layout.addWidget(QLabel("Este documento não tem campos de "
                                    "formulário."))
        layout.addWidget(self.tabela)
        layout.addWidget(_botoes(self, "Gravar valores"))

    def valores(self) -> dict[int, str | bool]:
        novos: dict[int, str | bool] = {}
        for c, editor in zip(self.campos, self.editores):
            if isinstance(editor, QCheckBox):
                v: str | bool = editor.isChecked()
            elif isinstance(editor, QComboBox):
                v = editor.currentText()
            else:
                v = editor.text()
            if v != c.valor:
                novos[c.xref] = v
        return novos


# -- propriedades ---------------------------------------------------------------
class DialogoPropriedades(QDialog):
    def __init__(self, valores: dict[str, str], info: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Propriedades do documento")
        self.resize(480, 0)
        self.campos: dict[str, QLineEdit] = {}
        form = QFormLayout(self)
        for chave, rotulo in extras.CAMPOS_METADADOS.items():
            self.campos[chave] = QLineEdit(valores.get(chave, ""))
            form.addRow(rotulo + ":", self.campos[chave])
        form.addRow(QLabel(info))
        form.addRow(_botoes(self, "Gravar"))

    def valores(self) -> dict[str, str]:
        return {k: e.text() for k, e in self.campos.items()}


# -- editar texto ---------------------------------------------------------------
class DialogoEditarTexto(QDialog):
    def __init__(self, texto: str, tamanho: float, cor, fonte: str,
                 parent=None, titulo: str = "Editar texto"):
        super().__init__(parent)
        self.setWindowTitle(titulo)
        self.resize(520, 0)
        self.texto = QLineEdit(texto)
        self.texto.selectAll()
        self.tamanho = QDoubleSpinBox()
        self.tamanho.setRange(3, 200)
        self.tamanho.setDecimals(1)
        self.tamanho.setValue(tamanho)
        self.cor = BotaoCor(cor)
        form = QFormLayout(self)
        form.addRow("Texto:", self.texto)
        form.addRow("Tamanho:", self.tamanho)
        form.addRow("Cor:", self.cor)
        if fonte:
            form.addRow(QLabel(f"Fonte original: {fonte}. O texto novo usa a "
                               "fonte padrão mais parecida."))
        form.addRow(_botoes(self))


# -- assinatura -----------------------------------------------------------------
class _Quadro(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(480, 180)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.tracos: list[list[QPointF]] = []
        self.caneta = QPen(QColor(10, 30, 120), 2.6, Qt.PenStyle.SolidLine,
                           Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)

    def limpar(self) -> None:
        self.tracos.clear()
        self.update()

    def mousePressEvent(self, e) -> None:                  # noqa: N802
        self.tracos.append([e.position()])

    def mouseMoveEvent(self, e) -> None:                   # noqa: N802
        if self.tracos:
            self.tracos[-1].append(e.position())
            self.update()

    def _desenhar(self, painter: QPainter) -> None:
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(self.caneta)
        for traco in self.tracos:
            if len(traco) == 1:
                painter.drawPoint(traco[0])
                continue
            caminho = QPainterPath(traco[0])
            for p in traco[1:]:
                caminho.lineTo(p)
            painter.drawPath(caminho)

    def paintEvent(self, _e) -> None:                      # noqa: N802
        p = QPainter(self)
        p.fillRect(self.rect(), Qt.GlobalColor.white)
        p.setPen(QPen(QColor(200, 200, 200), 1, Qt.PenStyle.DashLine))
        base = int(self.height() * 0.75)
        p.drawLine(20, base, self.width() - 20, base)
        self._desenhar(p)
        p.end()

    def para_png(self) -> bytes | None:
        """PNG com fundo transparente, recortado ao desenho, em 3x."""
        if not any(self.tracos):
            return None
        escala = 3
        imagem = QImage(self.width() * escala, self.height() * escala,
                        QImage.Format.Format_ARGB32)
        imagem.fill(Qt.GlobalColor.transparent)
        p = QPainter(imagem)
        p.scale(escala, escala)
        self._desenhar(p)
        p.end()
        pontos = [pt for t in self.tracos for pt in t]
        m = 6
        x0 = max(0, int(min(pt.x() for pt in pontos) - m)) * escala
        y0 = max(0, int(min(pt.y() for pt in pontos) - m)) * escala
        x1 = min(self.width(), int(max(pt.x() for pt in pontos) + m)) * escala
        y1 = min(self.height(), int(max(pt.y() for pt in pontos) + m)) * escala
        recorte = imagem.copy(x0, y0, max(1, x1 - x0), max(1, y1 - y0))
        dados = QByteArray()
        buf = QBuffer(dados)
        buf.open(QIODevice.OpenModeFlag.WriteOnly)
        recorte.save(buf, "PNG")
        buf.close()
        return bytes(dados)


class DialogoAssinatura(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Criar assinatura")
        self.quadro = _Quadro()
        self.png: bytes | None = None
        limpar = QPushButton("Limpar")
        limpar.clicked.connect(self.quadro.limpar)
        de_arquivo = QPushButton("Usar imagem…")
        de_arquivo.clicked.connect(self._de_arquivo)
        linha = QHBoxLayout()
        linha.addWidget(limpar)
        linha.addWidget(de_arquivo)
        linha.addStretch()
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Desenhe sua assinatura com o mouse:"))
        layout.addWidget(self.quadro)
        layout.addLayout(linha)
        layout.addWidget(_botoes(self, "Usar esta assinatura"))

    def _de_arquivo(self) -> None:
        arquivo, _ = QFileDialog.getOpenFileName(self, "Imagem da assinatura",
                                                 "", FILTRO_IMAGEM)
        if arquivo:
            self.png = pathlib.Path(arquivo).read_bytes()
            super().accept()

    def accept(self) -> None:
        self.png = self.quadro.para_png()
        if self.png is None:
            QMessageBox.warning(self, "Assinatura",
                                "Desenhe a assinatura ou escolha uma imagem.")
            return
        super().accept()


def pedir_senha(parent, nome: str, erro: bool = False) -> str | None:
    from PySide6.QtWidgets import QInputDialog
    texto = (f"“{nome}” é protegido por senha."
             + ("\n\nSenha incorreta. Tente de novo." if erro else "")
             + "\n\nSenha:")
    senha, ok = QInputDialog.getText(parent, "Senha", texto,
                                     QLineEdit.EchoMode.Password)
    return senha if ok else None


