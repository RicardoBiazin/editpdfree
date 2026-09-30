"""Dialogos dos recursos da 0.2: OCR, assinatura digital, cabecalho/rodape,
recortar, redimensionar, link, lote e comparar."""

from __future__ import annotations

import pathlib

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog,
                               QDialogButtonBox, QDoubleSpinBox, QFileDialog,
                               QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QMessageBox, QPushButton,
                               QRadioButton, QSpinBox, QTableWidget,
                               QTableWidgetItem, QVBoxLayout)

from .. import extras
from .dialogos import FILTRO_PDF, BotaoCor, _botoes


# -- OCR ------------------------------------------------------------------------
class DialogoOCR(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        from .. import ocr
        self.setWindowTitle("Reconhecer texto (OCR)")
        self.idioma = QComboBox()
        for chave, rotulo in ocr.IDIOMAS.items():
            self.idioma.addItem(rotulo, chave)
        self.idioma.setCurrentIndex(self.idioma.findData("por+eng"))
        self.todas = QRadioButton("Todas as páginas")
        self.todas.setChecked(True)
        self.atual = QRadioButton("Só a página atual")
        self.forcar = QCheckBox("Refazer também as páginas que já têm texto")
        form = QFormLayout(self)
        form.addRow("Idioma:", self.idioma)
        form.addRow(self.todas)
        form.addRow(self.atual)
        form.addRow(self.forcar)
        aviso = QLabel("O texto reconhecido fica invisível por trás da "
                       "imagem: a página continua igual, mas passa a permitir "
                       "busca, seleção, cópia e tarja.")
        aviso.setWordWrap(True)
        form.addRow(aviso)
        form.addRow(_botoes(self, "Reconhecer"))


# -- assinatura digital -----------------------------------------------------------
class DialogoAssinarCertificado(QDialog):
    def __init__(self, parent=None, ultimo_pfx: str = "",
                 visivel: bool = True):
        super().__init__(parent)
        self.setWindowTitle("Assinar com certificado digital")
        self.resize(560, 0)
        self.arquivo = QLineEdit(ultimo_pfx)
        self.arquivo.setPlaceholderText("Certificado A1 (.pfx ou .p12)")
        procurar = QPushButton("Procurar…")
        procurar.clicked.connect(self._procurar)
        linha = QHBoxLayout()
        linha.addWidget(self.arquivo)
        linha.addWidget(procurar)
        self.senha = QLineEdit()
        self.senha.setEchoMode(QLineEdit.EchoMode.Password)
        self.senha.editingFinished.connect(self._mostrar_info)
        self.info = QLabel("")
        self.info.setWordWrap(True)
        self.motivo = QLineEdit()
        self.motivo.setPlaceholderText("opcional, ex.: Concordo com o documento")
        self.local = QLineEdit()
        self.local.setPlaceholderText("opcional, ex.: Florianópolis/SC")
        form = QFormLayout(self)
        form.addRow("Certificado:", linha)
        form.addRow("Senha:", self.senha)
        form.addRow("", self.info)
        form.addRow("Motivo:", self.motivo)
        form.addRow("Local:", self.local)
        aviso = QLabel(
            ("Assinatura visível na área desenhada." if visivel
             else "Assinatura invisível (não aparece na página).")
            + " O documento assinado é salvo como um arquivo novo; qualquer "
              "alteração posterior invalida a assinatura.")
        aviso.setWordWrap(True)
        form.addRow(aviso)
        form.addRow(_botoes(self, "Assinar e salvar…"))
        self.pfx: bytes | None = None
        if ultimo_pfx:
            self.senha.setFocus()

    def _procurar(self) -> None:
        arquivo, _ = QFileDialog.getOpenFileName(
            self, "Certificado digital", self.arquivo.text(),
            "Certificados (*.pfx *.p12);;Todos os arquivos (*)")
        if arquivo:
            self.arquivo.setText(arquivo)
            self._mostrar_info()

    def _mostrar_info(self) -> bool:
        from .. import assinatura_digital as ad
        caminho = self.arquivo.text().strip()
        if not caminho or not self.senha.text():
            self.info.setText("")
            return False
        try:
            self.pfx = pathlib.Path(caminho).read_bytes()
            info = ad.info_certificado(self.pfx, self.senha.text())
        except OSError:
            self.info.setText("Não foi possível ler o arquivo do certificado.")
            return False
        except ValueError as erro:
            self.info.setText(str(erro))
            return False
        texto = (f"<b>{info.titular}</b><br>Emitido por: {info.emissor}<br>"
                 f"Válido até: {info.validade:%d/%m/%Y}")
        if info.vencido:
            texto += "<br><span style='color:#c00'>Certificado VENCIDO.</span>"
        self.info.setText(texto)
        return not info.vencido

    def accept(self) -> None:
        if not self._mostrar_info():
            if not self.info.text():
                self.info.setText("Informe o certificado e a senha.")
            return
        super().accept()


class DialogoVerificarAssinaturas(QDialog):
    def __init__(self, assinaturas, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Assinaturas digitais")
        self.resize(780, 300)
        tabela = QTableWidget(len(assinaturas), 5)
        tabela.setHorizontalHeaderLabels(["Signatário", "Data", "Situação",
                                          "Motivo", "Local"])
        for linha, s in enumerate(assinaturas):
            marca = ("✔ " if s.integra and s.confiavel else
                     "⚠ " if s.integra else "✖ ")
            valores = (s.titular, f"{s.data:%d/%m/%Y %H:%M}" if s.data else "",
                       marca + s.resumo, s.motivo, s.local)
            for coluna, valor in enumerate(valores):
                item = QTableWidgetItem(valor)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                item.setToolTip(valor)
                tabela.setItem(linha, coluna, item)
        tabela.resizeColumnsToContents()
        tabela.horizontalHeader().setStretchLastSection(True)
        layout = QVBoxLayout(self)
        if not assinaturas:
            layout.addWidget(QLabel("Este documento não tem assinaturas "
                                    "digitais."))
        layout.addWidget(tabela)
        nota = QLabel("“Íntegra” = nada mudou desde a assinatura. "
                      "“Confiável” = o certificado pertence à ICP-Brasil. A "
                      "revogação não é consultada; para a validação completa "
                      "use o validador do ITI (validar.iti.gov.br).")
        nota.setWordWrap(True)
        layout.addWidget(nota)
        fechar = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        fechar.button(QDialogButtonBox.StandardButton.Close).setText("Fechar")
        fechar.rejected.connect(self.reject)
        layout.addWidget(fechar)


# -- cabecalho e rodape -------------------------------------------------------------
class DialogoCabecalhoRodape(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Cabeçalho e rodapé")
        self.resize(560, 0)
        self.campos: dict[str, QLineEdit] = {}
        form = QFormLayout(self)
        for chave, rotulo in extras.POSICOES.items():
            self.campos[chave] = QLineEdit()
            form.addRow(rotulo + ":", self.campos[chave])
        self.campos["inferior-direita"].setText("Página {n} de {total}")
        self.tamanho = QSpinBox()
        self.tamanho.setRange(5, 36)
        self.tamanho.setValue(9)
        self.cor = BotaoCor((0.25, 0.25, 0.25))
        self.pular = QCheckBox("Não aplicar na primeira página (capa)")
        form.addRow("Tamanho:", self.tamanho)
        form.addRow("Cor:", self.cor)
        form.addRow("", self.pular)
        form.addRow(QLabel("Campos: {n} número da página, {total} total, "
                           "{arquivo} nome do arquivo, {data} data de hoje."))
        form.addRow(_botoes(self, "Aplicar"))

    def textos(self) -> dict[str, str]:
        return {k: e.text() for k, e in self.campos.items()}


# -- recortar e redimensionar -------------------------------------------------------
class DialogoRecortar(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Recortar páginas")
        self.margens = []
        form = QFormLayout(self)
        for rotulo in ("Superior", "Direita", "Inferior", "Esquerda"):
            caixa = QDoubleSpinBox()
            caixa.setRange(0, 300)
            caixa.setDecimals(1)
            caixa.setSuffix(" mm")
            caixa.setValue(10)
            self.margens.append(caixa)
            form.addRow(rotulo + ":", caixa)
        self.todas = QCheckBox("Aplicar a todas as páginas")
        self.todas.setChecked(True)
        form.addRow("", self.todas)
        dica = QLabel("Dica: a ferramenta “Recortar” permite desenhar a área "
                      "direto na página. O recorte esconde o que fica fora, "
                      "mas não apaga — para apagar, use a tarja.")
        dica.setWordWrap(True)
        form.addRow(dica)
        form.addRow(_botoes(self, "Recortar"))

    def valores(self) -> tuple[float, float, float, float]:
        return tuple(c.value() for c in self.margens)


class DialogoRedimensionar(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        from .. import paginas
        self.setWindowTitle("Redimensionar páginas")
        self.formato = QComboBox()
        self.formato.addItems(list(paginas.FORMATOS))
        self.margem = QDoubleSpinBox()
        self.margem.setRange(0, 50)
        self.margem.setSuffix(" mm")
        self.todas = QCheckBox("Aplicar a todas as páginas")
        self.todas.setChecked(True)
        form = QFormLayout(self)
        form.addRow("Novo tamanho:", self.formato)
        form.addRow("Margem:", self.margem)
        form.addRow("", self.todas)
        nota = QLabel("O conteúdo é ajustado sem distorcer, mantendo retrato "
                      "ou paisagem. Anotações e campos viram parte fixa das "
                      "páginas redimensionadas.")
        nota.setWordWrap(True)
        form.addRow(nota)
        form.addRow(_botoes(self, "Redimensionar"))


# -- link -----------------------------------------------------------------------------
class DialogoLink(QDialog):
    def __init__(self, total: int, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Criar link")
        self.para_url = QRadioButton("Para um site ou e-mail:")
        self.para_url.setChecked(True)
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://… ou nome@exemplo.com")
        self.para_pagina = QRadioButton("Para a página:")
        self.pagina = QSpinBox()
        self.pagina.setRange(1, max(1, total))
        form = QFormLayout(self)
        form.addRow(self.para_url, self.url)
        form.addRow(self.para_pagina, self.pagina)
        form.addRow(_botoes(self, "Criar"))

    def accept(self) -> None:
        if self.para_url.isChecked() and not self.url.text().strip():
            QMessageBox.warning(self, "Link", "Informe o endereço.")
            return
        super().accept()


# -- lote -------------------------------------------------------------------------------
class DialogoLote(QDialog):
    def __init__(self, parent=None, pasta: str = ""):
        super().__init__(parent)
        self.setWindowTitle("Processar em lote")
        self.resize(640, 580)
        self._pasta = pasta
        self.lista = QListWidget()
        adicionar = QPushButton("Adicionar arquivos…")
        adicionar.clicked.connect(self._adicionar)
        da_pasta = QPushButton("Adicionar pasta…")
        da_pasta.clicked.connect(self._adicionar_pasta)
        limpar = QPushButton("Limpar")
        limpar.clicked.connect(self.lista.clear)
        botoes = QHBoxLayout()
        for b in (adicionar, da_pasta, limpar):
            botoes.addWidget(b)
        botoes.addStretch()

        self.ocr = QCheckBox("Reconhecer texto (OCR) das páginas escaneadas")
        self.girar = QCheckBox("Girar todas as páginas:")
        self.girar_graus = QComboBox()
        self.girar_graus.addItems(["90° à direita", "90° à esquerda", "180°"])
        self.marca = QCheckBox("Marca d’água:")
        self.marca_texto = QLineEdit("CONFIDENCIAL")
        self.numerar = QCheckBox("Numerar páginas:")
        self.numerar_formato = QLineEdit("{n} / {total}")
        self.rodape = QCheckBox("Rodapé:")
        self.rodape_texto = QLineEdit("{arquivo} — {data}")
        self.comprimir = QCheckBox("Comprimir imagens")
        self.pdfa = QCheckBox("Converter para PDF/A (arquivamento)")
        self.senha = QCheckBox("Proteger com senha:")
        self.senha_texto = QLineEdit()
        self.senha_texto.setEchoMode(QLineEdit.EchoMode.Password)
        ops = QFormLayout()
        ops.addRow(self.ocr)
        ops.addRow(self.girar, self.girar_graus)
        ops.addRow(self.marca, self.marca_texto)
        ops.addRow(self.numerar, self.numerar_formato)
        ops.addRow(self.rodape, self.rodape_texto)
        ops.addRow(self.comprimir)
        ops.addRow(self.pdfa)
        ops.addRow(self.senha, self.senha_texto)

        self.saida = QLineEdit()
        escolher = QPushButton("Escolher…")
        escolher.clicked.connect(self._escolher_saida)
        linha_saida = QHBoxLayout()
        linha_saida.addWidget(self.saida)
        linha_saida.addWidget(escolher)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Arquivos:"))
        layout.addWidget(self.lista)
        layout.addLayout(botoes)
        layout.addWidget(QLabel("Operações (aplicadas na ordem abaixo):"))
        layout.addLayout(ops)
        layout.addWidget(QLabel("Pasta de saída (os originais não são "
                                "alterados; arquivos danificados saem "
                                "reparados):"))
        layout.addLayout(linha_saida)
        layout.addWidget(_botoes(self, "Processar"))

    def _adicionar(self) -> None:
        arquivos, _ = QFileDialog.getOpenFileNames(self, "Adicionar PDFs",
                                                   self._pasta, FILTRO_PDF)
        self.lista.addItems(arquivos)

    def _adicionar_pasta(self) -> None:
        from .. import lote
        pasta = QFileDialog.getExistingDirectory(self, "Pasta com PDFs",
                                                 self._pasta)
        if pasta:
            self.lista.addItems([str(p) for p in lote.pdfs_da_pasta(pasta)])
            if not self.saida.text():
                self.saida.setText(str(pathlib.Path(pasta) / "processados"))

    def _escolher_saida(self) -> None:
        pasta = QFileDialog.getExistingDirectory(self, "Pasta de saída",
                                                 self._pasta)
        if pasta:
            self.saida.setText(pasta)

    def arquivos(self) -> list[str]:
        return [self.lista.item(i).text() for i in range(self.lista.count())]

    def operacoes(self) -> list:
        from .. import lote
        ops = []
        if self.ocr.isChecked():
            ops.append(lote.op_ocr())
        if self.girar.isChecked():
            graus = {0: 90, 1: -90, 2: 180}[self.girar_graus.currentIndex()]
            ops.append(lote.op_girar(graus))
        if self.marca.isChecked():
            ops.append(lote.op_marca_dagua(self.marca_texto.text()))
        if self.numerar.isChecked():
            ops.append(lote.op_numerar(formato=self.numerar_formato.text()))
        if self.rodape.isChecked():
            ops.append(lote.op_cabecalho_rodape(
                {"inferior-esquerda": self.rodape_texto.text()}))
        if self.comprimir.isChecked():
            ops.append(lote.op_comprimir())
        if self.pdfa.isChecked():
            ops.append(lote.op_pdfa())
        if self.senha.isChecked():
            ops.append(lote.op_proteger(self.senha_texto.text()))
        return ops

    def accept(self) -> None:
        if not self.arquivos():
            QMessageBox.warning(self, "Lote", "Adicione arquivos.")
            return
        if not self.operacoes():
            QMessageBox.warning(self, "Lote", "Escolha ao menos uma operação.")
            return
        if self.senha.isChecked() and not self.senha_texto.text():
            QMessageBox.warning(self, "Lote", "Informe a senha.")
            return
        if not self.saida.text().strip():
            QMessageBox.warning(self, "Lote", "Escolha a pasta de saída.")
            return
        super().accept()


# -- comparar ---------------------------------------------------------------------------
class DialogoEscolherComparacao(QDialog):
    def __init__(self, parent=None, atual: str = ""):
        super().__init__(parent)
        self.setWindowTitle("Comparar PDFs")
        self.resize(560, 0)
        self.a = QLineEdit(atual)
        self.b = QLineEdit()
        form = QFormLayout(self)
        for rotulo, campo in (("Versão anterior:", self.a),
                              ("Versão nova:", self.b)):
            botao = QPushButton("Procurar…")
            botao.clicked.connect(lambda _c=False, c=campo: self._procurar(c))
            linha = QHBoxLayout()
            linha.addWidget(campo)
            linha.addWidget(botao)
            form.addRow(rotulo, linha)
        form.addRow(_botoes(self, "Comparar"))

    def _procurar(self, campo: QLineEdit) -> None:
        arquivo, _ = QFileDialog.getOpenFileName(self, "Escolher PDF",
                                                 campo.text(), FILTRO_PDF)
        if arquivo:
            campo.setText(arquivo)

    def accept(self) -> None:
        for campo in (self.a, self.b):
            if not pathlib.Path(campo.text().strip()).is_file():
                QMessageBox.warning(self, "Comparar",
                                    "Escolha os dois arquivos.")
                return
        super().accept()



# -- 0.3 ----------------------------------------------------------------------------
class DialogoMarcaImagem(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        from .dialogos import FILTRO_IMAGEM
        self._filtro = FILTRO_IMAGEM
        self.setWindowTitle("Marca d’água de imagem")
        self.resize(520, 0)
        self.arquivo = QLineEdit()
        procurar = QPushButton("Procurar…")
        procurar.clicked.connect(self._procurar)
        linha = QHBoxLayout()
        linha.addWidget(self.arquivo)
        linha.addWidget(procurar)
        self.opacidade = QSpinBox()
        self.opacidade.setRange(1, 100)
        self.opacidade.setValue(25)
        self.opacidade.setSuffix(" %")
        self.escala = QSpinBox()
        self.escala.setRange(5, 100)
        self.escala.setValue(50)
        self.escala.setSuffix(" % da página")
        self.lado_a_lado = QCheckBox("Repetir lado a lado")
        self.atras = QCheckBox("Atrás do conteúdo")
        form = QFormLayout(self)
        form.addRow("Imagem:", linha)
        form.addRow("Opacidade:", self.opacidade)
        form.addRow("Tamanho:", self.escala)
        form.addRow("", self.lado_a_lado)
        form.addRow("", self.atras)
        form.addRow(_botoes(self, "Aplicar"))

    def _procurar(self) -> None:
        arquivo, _ = QFileDialog.getOpenFileName(self, "Imagem", "",
                                                 self._filtro)
        if arquivo:
            self.arquivo.setText(arquivo)

    def accept(self) -> None:
        if not pathlib.Path(self.arquivo.text().strip()).is_file():
            QMessageBox.warning(self, "Marca d’água", "Escolha a imagem.")
            return
        super().accept()


class DialogoCamposDetectados(QDialog):
    """Lista as sugestoes com caixa de marcar: o usuario escolhe quais criar
    e pode renomear."""

    def __init__(self, sugestoes, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Campos detectados")
        self.resize(620, 420)
        self.sugestoes = sugestoes
        self.tabela = QTableWidget(len(sugestoes), 4)
        self.tabela.setHorizontalHeaderLabels(["Criar", "Página", "Tipo",
                                               "Nome"])
        self.marcas: list[QCheckBox] = []
        for linha, s in enumerate(sugestoes):
            marca = QCheckBox()
            marca.setChecked(True)
            self.marcas.append(marca)
            self.tabela.setCellWidget(linha, 0, marca)
            for coluna, texto in ((1, str(s.pagina + 1)),
                                  (2, "Caixa de seleção" if s.tipo == "caixa"
                                   else "Texto")):
                item = QTableWidgetItem(texto)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                item.setToolTip(s.motivo)
                self.tabela.setItem(linha, coluna, item)
            self.tabela.setItem(linha, 3, QTableWidgetItem(s.nome))
        self.tabela.horizontalHeader().setStretchLastSection(True)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"{len(sugestoes)} campo(s) encontrado(s). "
                                "Desmarque os que não quiser e ajuste os "
                                "nomes."))
        layout.addWidget(self.tabela)
        layout.addWidget(_botoes(self, "Criar campos"))

    def escolhidas(self):
        saida = []
        for linha, (s, marca) in enumerate(zip(self.sugestoes, self.marcas)):
            if marca.isChecked():
                nome = self.tabela.item(linha, 3).text().strip() or s.nome
                s.nome = nome
                saida.append(s)
        return saida
