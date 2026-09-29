"""Janela principal: menus, barras de ferramentas, abas e busca."""

from __future__ import annotations

import os
import pathlib

import pymupdf
from PySide6.QtCore import QByteArray, QSize, Qt, QTimer
from PySide6.QtGui import QAction, QActionGroup, QKeySequence
from PySide6.QtWidgets import (QApplication, QComboBox, QDoubleSpinBox,
                               QFileDialog, QLabel, QLineEdit, QMainWindow,
                               QMessageBox, QSpinBox, QTabWidget, QToolBar)

from .. import (NOME, VERSAO, anotacoes, extras, formularios, paginas,
                seguranca, texto)
from ..documento import Documento, SenhaNecessaria
from . import aba as modulo_aba
from . import config, dialogos, icones
from .aba import AbaDocumento
from .ferramentas import INFO, Ferramenta

ZOOMS = [25, 50, 75, 100, 125, 150, 200, 300, 400]


class JanelaPrincipal(QMainWindow):
    def __init__(self, cfg: config.Config | None = None):
        super().__init__()
        self.cfg = cfg if cfg is not None else config.Config.carregar()
        self.setWindowTitle(NOME)
        self.setWindowIcon(icones.icone("app"))
        self.resize(1200, 820)
        self.setAcceptDrops(True)
        self.abas = QTabWidget()
        self.abas.setTabsClosable(True)
        self.abas.setMovable(True)
        self.abas.setDocumentMode(True)
        self.abas.tabCloseRequested.connect(self.fechar_aba)
        self.abas.currentChanged.connect(lambda _i: self._atualizar_estado())
        self.setCentralWidget(self.abas)
        self.ferramenta = Ferramenta.SELECIONAR
        self._criar_acoes()
        self._criar_menus()
        self._criar_barras()
        self.rotulo_pagina = QLabel()
        self.rotulo_zoom = QLabel()
        self.statusBar().addPermanentWidget(self.rotulo_pagina)
        self.statusBar().addPermanentWidget(self.rotulo_zoom)
        if self.cfg.get("geometria"):
            try:
                self.restoreGeometry(QByteArray.fromHex(
                    self.cfg["geometria"].encode("ascii")))
            except (ValueError, TypeError):
                pass
        self._atualizar_estado()

    # -- acoes ---------------------------------------------------------------
    def _acao(self, rotulo: str, funcao, atalho=None, dica: str = "") -> QAction:
        a = QAction(rotulo, self)
        if atalho is not None:
            a.setShortcut(QKeySequence(atalho))
        if dica:
            a.setStatusTip(dica)
            a.setToolTip(dica)
        a.triggered.connect(lambda _c=False: funcao())
        return a

    def _criar_acoes(self) -> None:
        S = QKeySequence.StandardKey
        a = self._acao
        self.a_novo = a("&Novo", self.novo, S.New)
        self.a_abrir = a("&Abrir…", self.abrir_dialogo, S.Open)
        self.a_salvar = a("&Salvar", self.salvar, S.Save)
        self.a_salvar_como = a("Salvar &como…", self.salvar_como, S.SaveAs)
        self.a_fechar = a("&Fechar aba", lambda: self.fechar_aba(
            self.abas.currentIndex()), S.Close)
        self.a_juntar = a("&Juntar PDFs…", self.juntar)
        self.a_exportar = a("Exportar páginas como &imagens…",
                            self.exportar_imagens)
        self.a_extrair_texto = a("Extrair &texto…", self.extrair_texto)
        self.a_propriedades = a("P&ropriedades do documento…",
                                self.propriedades)
        self.a_sair = a("Sai&r", self.close, "Ctrl+Q")

        self.a_desfazer = a("&Desfazer", self.desfazer, S.Undo)
        self.a_refazer = a("&Refazer", self.refazer, S.Redo)
        self.a_localizar = a("&Localizar…", self.focar_busca, S.Find)
        self.a_substituir = a("&Substituir texto…", self.substituir_texto,
                              "Ctrl+H")
        self.a_excluir_anot = a("E&xcluir anotação selecionada",
                                self.excluir_anotacao, S.Delete)

        self.a_ampliar = a("&Ampliar", lambda: self._vis("ampliar"), S.ZoomIn)
        self.a_reduzir = a("&Reduzir", lambda: self._vis("reduzir"), S.ZoomOut)
        self.a_real = a("&Tamanho real", lambda: self._zoom(1.0), "Ctrl+0")
        self.a_largura = a("Ajustar à &largura",
                           lambda: self._vis("ajustar_largura"), "Ctrl+2")
        self.a_pagina = a("Ajustar à &página",
                          lambda: self._vis("ajustar_pagina"), "Ctrl+1")
        self.a_miniaturas = a("&Miniaturas", self._alternar_miniaturas, "F4")
        self.a_miniaturas.setCheckable(True)
        self.a_miniaturas.setChecked(True)
        self.a_anterior = a("Página anterior", lambda: self._ir(-1),
                            "PgUp")
        self.a_seguinte = a("Próxima página", lambda: self._ir(1), "PgDown")

        self.a_girar_esq = a("Girar à &esquerda", lambda: self._aba_fn(
            "girar", -90), "Ctrl+Shift+L")
        self.a_girar_dir = a("Girar à &direita", lambda: self._aba_fn(
            "girar", 90), "Ctrl+Shift+R")
        self.a_excluir_pag = a("E&xcluir página", lambda: self._aba_fn(
            "excluir_paginas"), "Ctrl+Shift+Del")
        self.a_duplicar = a("D&uplicar página", self.duplicar_pagina)
        self.a_branco = a("Inserir página em &branco", self.pagina_branco)
        self.a_inserir = a("&Inserir arquivo…", lambda: self._aba_fn(
            "inserir_arquivo"))
        self.a_extrair = a("Ex&trair páginas…", lambda: self._aba_fn(
            "extrair_paginas"))
        self.a_dividir = a("Di&vidir documento…", self.dividir)
        self.a_subir = a("Mover página para &cima", lambda: self._aba_fn(
            "mover_pagina", -1))
        self.a_descer = a("Mover página para b&aixo", lambda: self._aba_fn(
            "mover_pagina", 1))

        self.a_formulario = a("Preencher &formulário…", self.formulario)
        self.a_achatar = a("&Achatar formulário e anotações", self.achatar)
        self.a_tarjar_texto = a("&Tarjar texto…", self.tarjar_texto)
        self.a_marca = a("&Marca d’água…", self.marca_dagua)
        self.a_numerar = a("&Numerar páginas…", self.numerar)
        self.a_comprimir = a("&Comprimir…", self.comprimir)
        self.a_proteger = a("&Proteger com senha…", self.proteger)
        self.a_desproteger = a("&Remover senha", self.remover_senha)
        self.a_nova_assinatura = a("Criar nova assinatura…",
                                   self.nova_assinatura)

        self.a_sobre = a("&Sobre o EditPDFree", self.sobre)

        self.grupo_ferramentas = QActionGroup(self)
        self.acoes_ferramenta: dict[Ferramenta, QAction] = {}
        for f, (rotulo, dica, _g, atalho) in INFO.items():
            acao = QAction(rotulo, self)
            acao.setCheckable(True)
            acao.setIcon(icones.icone(f.value))
            acao.setToolTip(f"{rotulo} ({atalho})\n{dica}" if atalho
                            else f"{rotulo}\n{dica}")
            acao.setStatusTip(dica)
            if atalho:
                acao.setShortcut(QKeySequence(atalho))
            acao.triggered.connect(lambda _c=False, f=f:
                                   self.definir_ferramenta(f))
            self.grupo_ferramentas.addAction(acao)
            self.acoes_ferramenta[f] = acao
        self.acoes_ferramenta[Ferramenta.SELECIONAR].setChecked(True)

        for acao, nome in ((self.a_abrir, "abrir"), (self.a_salvar, "salvar"),
                           (self.a_desfazer, "desfazer"),
                           (self.a_refazer, "refazer"),
                           (self.a_girar_esq, "girar_esq"),
                           (self.a_girar_dir, "girar_dir"),
                           (self.a_ampliar, "ampliar"),
                           (self.a_reduzir, "reduzir"),
                           (self.a_largura, "largura")):
            acao.setIcon(icones.icone(nome))

        # Acoes que dependem de haver documento aberto.
        self._acoes_documento = [
            self.a_salvar, self.a_salvar_como, self.a_fechar, self.a_exportar,
            self.a_extrair_texto, self.a_propriedades, self.a_localizar,
            self.a_substituir, self.a_excluir_anot, self.a_ampliar,
            self.a_reduzir, self.a_real, self.a_largura, self.a_pagina,
            self.a_anterior, self.a_seguinte,
            self.a_girar_esq, self.a_girar_dir, self.a_excluir_pag,
            self.a_duplicar, self.a_branco, self.a_inserir, self.a_extrair,
            self.a_dividir, self.a_subir, self.a_descer, self.a_formulario,
            self.a_achatar, self.a_tarjar_texto, self.a_marca, self.a_numerar,
            self.a_comprimir, self.a_proteger, self.a_desproteger,
            *self.acoes_ferramenta.values()]

    def _criar_menus(self) -> None:
        barra = self.menuBar()
        m = barra.addMenu("&Arquivo")
        m.addActions([self.a_novo, self.a_abrir])
        self.menu_recentes = m.addMenu("Abrir &recente")
        self.menu_recentes.aboutToShow.connect(self._montar_recentes)
        m.addSeparator()
        m.addActions([self.a_salvar, self.a_salvar_como])
        m.addSeparator()
        m.addActions([self.a_juntar, self.a_exportar, self.a_extrair_texto])
        m.addSeparator()
        m.addActions([self.a_propriedades, self.a_fechar])
        m.addSeparator()
        m.addAction(self.a_sair)

        m = barra.addMenu("&Editar")
        m.addActions([self.a_desfazer, self.a_refazer])
        m.addSeparator()
        m.addActions([self.a_localizar, self.a_substituir])
        m.addSeparator()
        m.addAction(self.a_excluir_anot)

        m = barra.addMenu("E&xibir")
        m.addActions([self.a_ampliar, self.a_reduzir, self.a_real,
                      self.a_largura, self.a_pagina])
        m.addSeparator()
        m.addActions([self.a_anterior, self.a_seguinte])
        m.addSeparator()
        m.addAction(self.a_miniaturas)

        m = barra.addMenu("&Páginas")
        m.addActions([self.a_girar_esq, self.a_girar_dir])
        m.addSeparator()
        m.addActions([self.a_subir, self.a_descer, self.a_duplicar,
                      self.a_branco, self.a_inserir])
        m.addSeparator()
        m.addActions([self.a_extrair, self.a_dividir])
        m.addSeparator()
        m.addAction(self.a_excluir_pag)

        m = barra.addMenu("&Ferramentas")
        grupos = [
            [Ferramenta.SELECIONAR, Ferramenta.MAO],
            [Ferramenta.ADICIONAR_TEXTO, Ferramenta.EDITAR_TEXTO],
            [Ferramenta.CAIXA_TEXTO, Ferramenta.NOTA, Ferramenta.DESTACAR,
             Ferramenta.SUBLINHAR, Ferramenta.TACHAR],
            [Ferramenta.CANETA, Ferramenta.RETANGULO, Ferramenta.ELIPSE,
             Ferramenta.LINHA, Ferramenta.SETA],
            [Ferramenta.IMAGEM, Ferramenta.ASSINATURA],
            [Ferramenta.TARJAR],
            [Ferramenta.CAMPO_TEXTO, Ferramenta.CAIXA_SELECAO],
        ]
        for n, grupo in enumerate(grupos):
            if n:
                m.addSeparator()
            m.addActions([self.acoes_ferramenta[f] for f in grupo])
        m.addSeparator()
        m.addAction(self.a_nova_assinatura)

        m = barra.addMenu("&Documento")
        m.addActions([self.a_formulario, self.a_achatar])
        m.addSeparator()
        m.addActions([self.a_marca, self.a_numerar])
        m.addSeparator()
        m.addActions([self.a_tarjar_texto, self.a_proteger,
                      self.a_desproteger])
        m.addSeparator()
        m.addAction(self.a_comprimir)

        m = barra.addMenu("Aj&uda")
        m.addAction(self.a_sobre)

    def _criar_barras(self) -> None:
        b = QToolBar("Principal")
        b.setObjectName("barra_principal")
        b.setIconSize(QSize(22, 22))
        b.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonIconOnly)
        b.addActions([self.a_abrir, self.a_salvar])
        b.addSeparator()
        b.addActions([self.a_desfazer, self.a_refazer])
        b.addSeparator()
        b.addActions([self.a_girar_esq, self.a_girar_dir])
        b.addSeparator()
        b.addAction(self.a_reduzir)
        self.combo_zoom = QComboBox()
        self.combo_zoom.setEditable(True)
        self.combo_zoom.addItems([f"{z}%" for z in ZOOMS])
        self.combo_zoom.setMinimumContentsLength(5)
        self.combo_zoom.lineEdit().returnPressed.connect(self._zoom_digitado)
        self.combo_zoom.activated.connect(lambda _i: self._zoom_digitado())
        b.addWidget(self.combo_zoom)
        b.addAction(self.a_ampliar)
        b.addAction(self.a_largura)
        b.addSeparator()
        self.campo_pagina = QSpinBox()
        self.campo_pagina.setMinimum(1)
        self.campo_pagina.setKeyboardTracking(False)
        self.campo_pagina.valueChanged.connect(
            lambda v: self._aba() and self._aba().visualizador.ir_para_pagina(v - 1))
        self.rotulo_total = QLabel(" / 0 ")
        b.addWidget(self.campo_pagina)
        b.addWidget(self.rotulo_total)
        b.addSeparator()
        self.busca = QLineEdit()
        self.busca.setPlaceholderText("Localizar (Ctrl+F)")
        self.busca.setClearButtonEnabled(True)
        self.busca.setMaximumWidth(240)
        self.busca.returnPressed.connect(self._buscar_ou_proximo)
        self.busca.textChanged.connect(self._busca_mudou)
        b.addWidget(self.busca)
        self.rotulo_busca = QLabel("")
        b.addWidget(self.rotulo_busca)
        self.addToolBar(b)

        self.addToolBarBreak()
        f = QToolBar("Ferramentas")
        f.setObjectName("barra_ferramentas")
        f.setIconSize(QSize(22, 22))
        f.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonIconOnly)
        for ferramenta in (Ferramenta.SELECIONAR, Ferramenta.MAO,
                           Ferramenta.EDITAR_TEXTO, Ferramenta.ADICIONAR_TEXTO,
                           Ferramenta.CAIXA_TEXTO, Ferramenta.NOTA,
                           Ferramenta.DESTACAR, Ferramenta.SUBLINHAR,
                           Ferramenta.TACHAR, Ferramenta.CANETA,
                           Ferramenta.RETANGULO, Ferramenta.ELIPSE,
                           Ferramenta.SETA, Ferramenta.IMAGEM,
                           Ferramenta.ASSINATURA, Ferramenta.TARJAR):
            f.addAction(self.acoes_ferramenta[ferramenta])
        f.addSeparator()
        cor = self.cfg.get("cor") or [0.85, 0.1, 0.1]
        self.botao_cor = dialogos.BotaoCor(cor)
        f.addWidget(QLabel(" Cor "))
        f.addWidget(self.botao_cor)
        self.espessura = QDoubleSpinBox()
        self.espessura.setRange(0.25, 30)
        self.espessura.setSingleStep(0.5)
        self.espessura.setValue(float(self.cfg.get("espessura", 2)))
        self.espessura.setToolTip("Espessura do traço")
        f.addWidget(QLabel(" Traço "))
        f.addWidget(self.espessura)
        self.tamanho_fonte = QSpinBox()
        self.tamanho_fonte.setRange(4, 200)
        self.tamanho_fonte.setValue(int(self.cfg.get("tamanho_fonte", 12)))
        self.tamanho_fonte.setToolTip("Tamanho da fonte")
        f.addWidget(QLabel(" Fonte "))
        f.addWidget(self.tamanho_fonte)
        self.opacidade = QSpinBox()
        self.opacidade.setRange(5, 100)
        self.opacidade.setSuffix(" %")
        self.opacidade.setValue(int(float(self.cfg.get("opacidade", 1)) * 100))
        self.opacidade.setToolTip("Opacidade")
        f.addWidget(QLabel(" Opacidade "))
        f.addWidget(self.opacidade)
        self.addToolBar(f)
        self.barra_ferramentas = f

    # -- estilo ---------------------------------------------------------------
    def estilo(self) -> anotacoes.Estilo:
        return anotacoes.Estilo(cor=tuple(self.botao_cor.cor),
                                espessura=self.espessura.value(),
                                opacidade=self.opacidade.value() / 100,
                                tamanho_fonte=float(self.tamanho_fonte.value()))

    # -- abas -------------------------------------------------------------------
    def _aba(self) -> AbaDocumento | None:
        w = self.abas.currentWidget()
        return w if isinstance(w, AbaDocumento) else None

    def todas_as_abas(self) -> list[AbaDocumento]:
        return [self.abas.widget(i) for i in range(self.abas.count())]

    def _aba_fn(self, nome: str, *args) -> None:
        a = self._aba()
        if a is not None:
            getattr(a, nome)(*args)

    def _vis(self, nome: str) -> None:
        a = self._aba()
        if a is not None:
            getattr(a.visualizador, nome)()

    def _zoom(self, valor: float) -> None:
        a = self._aba()
        if a is not None:
            a.visualizador.definir_zoom(valor)

    def _ir(self, passo: int) -> None:
        a = self._aba()
        if a is not None:
            a.visualizador.ir_para_pagina(a.visualizador.pagina_atual + passo)

    def _zoom_digitado(self) -> None:
        texto_zoom = self.combo_zoom.currentText().replace("%", "").strip()
        try:
            self._zoom(float(texto_zoom.replace(",", ".")) / 100)
        except ValueError:
            self._atualizar_estado()

    def _alternar_miniaturas(self) -> None:
        for a in self.todas_as_abas():
            a.miniaturas.setVisible(self.a_miniaturas.isChecked())

    def _adicionar_aba(self, documento: Documento) -> AbaDocumento:
        aba = AbaDocumento(documento, self.estilo)
        aba.estadoMudou.connect(self._atualizar_estado)
        aba.mensagem.connect(lambda m: self.statusBar().showMessage(m, 5000))
        aba.miniaturas.setVisible(self.a_miniaturas.isChecked())
        aba.visualizador.definir_ferramenta(self.ferramenta)
        indice = self.abas.addTab(aba, aba.titulo)
        self.abas.setCurrentIndex(indice)
        # O ajuste a' largura precisa do tamanho real do viewport, que so'
        # existe depois de o Qt dispor a aba.
        QTimer.singleShot(0, lambda: aba.visualizador.ajustar_largura(
            maximo=1.5))
        return aba

    def _aba_do_arquivo(self, caminho: str) -> int | None:
        chave = os.path.normcase(os.path.realpath(caminho))
        for i, a in enumerate(self.todas_as_abas()):
            c = a.documento.caminho
            if c and os.path.normcase(os.path.realpath(c)) == chave:
                return i
        return None

    # -- arquivo ------------------------------------------------------------------
    def novo(self) -> AbaDocumento:
        return self._adicionar_aba(Documento())

    def abrir_dialogo(self) -> None:
        arquivos, _ = QFileDialog.getOpenFileNames(
            self, "Abrir PDF", modulo_aba.pasta_padrao(self.cfg),
            dialogos.FILTRO_ENTRADA)
        for arquivo in arquivos:
            self.abrir(arquivo)

    def abrir(self, caminho: str | os.PathLike) -> AbaDocumento | None:
        caminho = str(caminho)
        existente = self._aba_do_arquivo(caminho)
        if existente is not None:
            self.abas.setCurrentIndex(existente)
            return self.abas.widget(existente)
        if not os.path.isfile(caminho):
            modulo_aba.avisar(self, NOME, f"Arquivo não encontrado:\n{caminho}")
            return None
        try:
            if pathlib.Path(caminho).suffix.lower() in paginas.EXTENSOES_IMAGEM:
                with pymupdf.open(caminho) as img:
                    documento = Documento(dados=img.convert_to_pdf())
            else:
                documento = self._abrir_com_senha(caminho)
                if documento is None:
                    return None
        except Exception as erro:                   # noqa: BLE001
            modulo_aba.avisar(self, NOME, f"Não foi possível abrir "
                              f"“{pathlib.Path(caminho).name}”:\n{erro}")
            return None
        if documento.caminho:
            self.cfg.adicionar_recente(str(documento.caminho))
            self.cfg["ultima_pasta"] = str(documento.caminho.parent)
        return self._adicionar_aba(documento)

    def _abrir_com_senha(self, caminho: str) -> Documento | None:
        senha = None
        erro = False
        while True:
            try:
                return Documento(caminho, senha=senha)
            except SenhaNecessaria:
                senha = dialogos.pedir_senha(self, pathlib.Path(caminho).name,
                                             erro)
                if senha is None:
                    return None
                erro = True

    def _montar_recentes(self) -> None:
        self.menu_recentes.clear()
        recentes = [c for c in self.cfg["recentes"] if os.path.isfile(c)]
        if not recentes:
            a = self.menu_recentes.addAction("(nenhum)")
            a.setEnabled(False)
            return
        for c in recentes:
            acao = self.menu_recentes.addAction(c)
            acao.triggered.connect(lambda _c=False, c=c: self.abrir(c))

    def salvar(self, aba: AbaDocumento | None = None) -> bool:
        aba = aba or self._aba()
        if aba is None:
            return False
        d = aba.documento
        if d.caminho is None:
            return self.salvar_como(aba)
        if not d.modificado:
            # Regravar sem mudanca mexe na data do arquivo e faz backup e
            # sincronizador acharem que houve alteracao.
            self.statusBar().showMessage("Nada a salvar.", 3000)
            return True
        return self._gravar(aba, d.caminho)

    def salvar_como(self, aba: AbaDocumento | None = None) -> bool:
        aba = aba or self._aba()
        if aba is None:
            return False
        d = aba.documento
        sugestao = str(d.caminho) if d.caminho else str(
            pathlib.Path(modulo_aba.pasta_padrao(self.cfg)) / d.nome)
        destino = modulo_aba.pedir_destino(self, "Salvar como", sugestao,
                                           dialogos.FILTRO_PDF)
        if not destino:
            return False
        if not destino.lower().endswith(".pdf"):
            destino += ".pdf"
        return self._gravar(aba, pathlib.Path(destino))

    def _gravar(self, aba: AbaDocumento, destino: pathlib.Path) -> bool:
        d = aba.documento
        if d.assinado and not getattr(d, "_aviso_assinatura", False):
            if not modulo_aba.confirmar(
                    self, "Documento assinado",
                    "Este PDF tem assinatura digital. Salvar as alterações "
                    "vai invalidá-la.\n\nSalvar mesmo assim?"):
                return False
            d._aviso_assinatura = True
        try:
            final = d.salvar(destino)
        except Exception as erro:                   # noqa: BLE001
            modulo_aba.avisar(self, NOME, f"Não foi possível salvar:\n{erro}")
            return False
        self.cfg.adicionar_recente(str(final))
        self.cfg["ultima_pasta"] = str(final.parent)
        tamanho = final.stat().st_size / 1024
        self.statusBar().showMessage(
            f"Salvo: {final.name} ({tamanho:,.0f} KB)".replace(",", "."), 6000)
        self._atualizar_estado()
        return True

    def fechar_aba(self, indice: int) -> bool:
        if indice < 0:
            return False
        aba = self.abas.widget(indice)
        if not self._pode_descartar(aba):
            return False
        self.abas.removeTab(indice)
        aba.fechar()
        aba.deleteLater()
        self._atualizar_estado()
        return True

    def _pode_descartar(self, aba: AbaDocumento) -> bool:
        if not aba.documento.modificado:
            return True
        self.abas.setCurrentWidget(aba)
        r = QMessageBox.question(
            self, NOME, f"Salvar as alterações em “{aba.documento.nome}”?",
            QMessageBox.StandardButton.Save | QMessageBox.StandardButton.Discard
            | QMessageBox.StandardButton.Cancel,
            QMessageBox.StandardButton.Save)
        if r == QMessageBox.StandardButton.Save:
            return self.salvar(aba)
        return r == QMessageBox.StandardButton.Discard

    def closeEvent(self, evento) -> None:                 # noqa: N802
        for aba in self.todas_as_abas():
            if not self._pode_descartar(aba):
                evento.ignore()
                return
        self.cfg["geometria"] = bytes(self.saveGeometry().toHex()).decode()
        est = self.estilo()
        self.cfg.update(cor=list(est.cor), espessura=est.espessura,
                        opacidade=est.opacidade,
                        tamanho_fonte=est.tamanho_fonte)
        self.cfg.gravar()
        for aba in self.todas_as_abas():
            aba.fechar()
        evento.accept()

    def dragEnterEvent(self, evento) -> None:             # noqa: N802
        if evento.mimeData().hasUrls():
            evento.acceptProposedAction()

    def dropEvent(self, evento) -> None:                  # noqa: N802
        for url in evento.mimeData().urls():
            if url.isLocalFile():
                self.abrir(url.toLocalFile())

    # -- editar ---------------------------------------------------------------------
    def desfazer(self) -> None:
        a = self._aba()
        if a is not None:
            a.documento.desfazer()

    def refazer(self) -> None:
        a = self._aba()
        if a is not None:
            a.documento.refazer()

    def excluir_anotacao(self) -> None:
        a = self._aba()
        if a is not None and not a.excluir_selecionada():
            self.statusBar().showMessage(
                "Selecione uma anotação com a ferramenta Selecionar.", 4000)

    def definir_ferramenta(self, ferramenta: Ferramenta) -> None:
        self.ferramenta = ferramenta
        self.acoes_ferramenta[ferramenta].setChecked(True)
        for a in self.todas_as_abas():
            a.visualizador.definir_ferramenta(ferramenta)
        self.statusBar().showMessage(INFO[ferramenta][1], 4000)

    def focar_busca(self) -> None:
        self.busca.setFocus()
        self.busca.selectAll()

    def _busca_mudou(self, termo: str) -> None:
        if not termo:
            a = self._aba()
            if a is not None:
                a.limpar_busca()
            self.rotulo_busca.setText("")

    def _buscar_ou_proximo(self) -> None:
        a = self._aba()
        termo = self.busca.text()
        if a is None or not termo:
            return
        if termo != a._busca:
            total = a.buscar(termo)
        else:
            recuar = (QApplication.keyboardModifiers()
                      & Qt.KeyboardModifier.ShiftModifier)
            a.proximo(-1 if recuar else 1)
            total = len(a.resultados)
        self.rotulo_busca.setText(
            f" {a.resultado_atual + 1} de {total} " if total
            else " nenhum resultado ")

    def substituir_texto(self) -> None:
        a = self._aba()
        if a is None:
            return
        procurado = modulo_aba.pedir_texto(self, "Substituir texto",
                                           "Procurar:", self.busca.text())
        if not procurado:
            return
        novo = modulo_aba.pedir_texto(self, "Substituir texto",
                                      f"Substituir “{procurado}” por:")
        if novo is None:
            return
        n = a._executar(texto.substituir_em_tudo, a.documento, procurado, novo)
        if isinstance(n, int):
            self.statusBar().showMessage(f"{n} ocorrência(s) substituída(s).",
                                         6000)

    # -- paginas ----------------------------------------------------------------------
    def duplicar_pagina(self) -> None:
        a = self._aba()
        if a is not None:
            a._executar(paginas.duplicar, a.documento,
                        a.visualizador.pagina_atual)

    def pagina_branco(self) -> None:
        a = self._aba()
        if a is not None:
            a._executar(paginas.inserir_em_branco, a.documento,
                        a.visualizador.pagina_atual + 1)

    def dividir(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoDividir(a.documento.paginas, self)
        if d.exec() != d.DialogCode.Accepted:
            return
        pasta = modulo_aba.pedir_pasta(self, "Pasta de destino",
                                       modulo_aba.pasta_padrao(self.cfg))
        if not pasta:
            return
        if d.a_cada.isChecked():
            saidas = a._executar(paginas.dividir, a.documento, pasta,
                                 a_cada=d.n.value())
        else:
            saidas = a._executar(paginas.dividir, a.documento, pasta,
                                 intervalos=d.intervalos.text())
        if isinstance(saidas, list):
            self.statusBar().showMessage(
                f"{len(saidas)} arquivo(s) criado(s) em {pasta}", 8000)

    def juntar(self) -> None:
        d = dialogos.DialogoJuntar(self, modulo_aba.pasta_padrao(self.cfg))
        if d.exec() != d.DialogCode.Accepted:
            return
        destino = modulo_aba.pedir_destino(
            self, "Salvar PDF juntado",
            str(pathlib.Path(modulo_aba.pasta_padrao(self.cfg)) / "juntado.pdf"),
            dialogos.FILTRO_PDF)
        if not destino:
            return
        try:
            paginas.juntar(d.arquivos(), destino)
        except Exception as erro:                   # noqa: BLE001
            modulo_aba.avisar(self, "Juntar PDFs", str(erro))
            return
        self.abrir(destino)

    # -- documento --------------------------------------------------------------------
    def formulario(self) -> None:
        a = self._aba()
        if a is None:
            return
        campos = formularios.campos(a.documento)
        if not campos:
            modulo_aba.avisar(self, "Formulário",
                              "Este documento não tem campos de formulário. "
                              "Use as ferramentas “Campo de texto” e “Caixa "
                              "de seleção” para criar.")
            return
        d = dialogos.DialogoFormulario(campos, self)
        if d.exec() == d.DialogCode.Accepted and d.valores():
            a._executar(formularios.preencher, a.documento, d.valores())

    def achatar(self) -> None:
        a = self._aba()
        if a is not None and modulo_aba.confirmar(
                self, "Achatar", "Campos e anotações viram parte fixa da "
                "página e deixam de ser editáveis. Continuar?"):
            a._executar(formularios.achatar, a.documento)

    def tarjar_texto(self) -> None:
        a = self._aba()
        if a is None:
            return
        termo = modulo_aba.pedir_texto(
            self, "Tarjar texto", "Texto a remover definitivamente de todas "
            "as páginas:", self.busca.text())
        if termo:
            n = a._executar(seguranca.tarjar_texto, a.documento, termo)
            if isinstance(n, int):
                self.statusBar().showMessage(f"{n} ocorrência(s) tarjada(s).",
                                             6000)

    def marca_dagua(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoMarcaDagua(self)
        if d.exec() == d.DialogCode.Accepted:
            a._executar(extras.marca_dagua, a.documento, d.texto.text(),
                        tamanho=d.tamanho.value(), cor=d.cor.cor,
                        opacidade=d.opacidade.value() / 100,
                        diagonal=d.diagonal.isChecked())

    def numerar(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoNumeracao(self)
        if d.exec() == d.DialogCode.Accepted:
            a._executar(extras.numerar, a.documento,
                        formato=d.formato.currentText(),
                        posicao=d.posicao.currentData(),
                        tamanho=d.tamanho.value(), inicio=d.inicio.value())

    def comprimir(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoComprimir(self)
        if d.exec() == d.DialogCode.Accepted:
            antes = len(a.documento.para_bytes())
            a._executar(extras.comprimir, a.documento, dpi=d.dpi.value(),
                        qualidade=d.qualidade.value())
            depois = len(a.documento.para_bytes())
            self.statusBar().showMessage(
                f"Tamanho estimado: {antes / 1024:,.0f} KB → "
                f"{depois / 1024:,.0f} KB".replace(",", "."), 8000)

    def proteger(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoSenha(self)
        if d.exec() == d.DialogCode.Accepted:
            a._executar(seguranca.proteger, a.documento, d.abrir.text(),
                        d.dono.text() or None, d.permissoes())
            self.statusBar().showMessage(
                "A senha será aplicada ao salvar.", 6000)

    def remover_senha(self) -> None:
        a = self._aba()
        if a is None:
            return
        if not a.documento.protegido and a.documento.criptografia is None:
            self.statusBar().showMessage("Este documento não tem senha.", 4000)
            return
        seguranca.remover_protecao(a.documento)
        self.statusBar().showMessage("A senha será removida ao salvar.", 6000)

    def nova_assinatura(self) -> None:
        png = modulo_aba.pedir_assinatura(self)
        if png:
            config.caminho_assinatura().write_bytes(png)
            self.definir_ferramenta(Ferramenta.ASSINATURA)

    def exportar_imagens(self) -> None:
        a = self._aba()
        if a is None:
            return
        d = dialogos.DialogoExportar(self)
        if d.exec() != d.DialogCode.Accepted:
            return
        pasta = modulo_aba.pedir_pasta(self, "Pasta de destino",
                                       modulo_aba.pasta_padrao(self.cfg))
        if not pasta:
            return
        alvo = [a.visualizador.pagina_atual] if d.so_atual.isChecked() else None
        saidas = a._executar(extras.exportar_imagens, a.documento, pasta,
                             dpi=d.dpi.value(), formato=d.formato.currentText(),
                             paginas=alvo)
        if isinstance(saidas, list):
            self.statusBar().showMessage(
                f"{len(saidas)} imagem(ns) salva(s) em {pasta}", 8000)

    def extrair_texto(self) -> None:
        a = self._aba()
        if a is None:
            return
        base = pathlib.Path(a.documento.nome).stem
        destino = modulo_aba.pedir_destino(
            self, "Extrair texto",
            str(pathlib.Path(modulo_aba.pasta_padrao(self.cfg)) / f"{base}.txt"),
            "Texto (*.txt)")
        if destino:
            pathlib.Path(destino).write_text(texto.extrair_texto(a.documento),
                                             "utf-8")
            self.statusBar().showMessage(f"Texto salvo em {destino}", 6000)

    def propriedades(self) -> None:
        a = self._aba()
        if a is None:
            return
        doc = a.documento
        info = (f"{doc.paginas} página(s) · PDF {doc.doc.metadata.get('format', '')}"
                + (" · protegido por senha" if doc.protegido else "")
                + (" · assinado digitalmente" if doc.assinado else ""))
        d = dialogos.DialogoPropriedades(extras.metadados(doc), info, self)
        if d.exec() == d.DialogCode.Accepted:
            a._executar(extras.definir_metadados, doc, d.valores())

    def sobre(self) -> None:
        QMessageBox.about(
            self, f"Sobre o {NOME}",
            f"<h3>{NOME} {VERSAO}</h3>"
            "<p>Editor de PDF gratuito e de código aberto.</p>"
            "<p>Motor PDF: PyMuPDF / MuPDF "
            f"{pymupdf.mupdf_version if hasattr(pymupdf, 'mupdf_version') else ''}"
            " · Interface: Qt (PySide6)</p>"
            "<p>Licença AGPL-3.0 · © 2026 Ricardo Biazin</p>")

    # -- estado -----------------------------------------------------------------------
    def _atualizar_estado(self) -> None:
        a = self._aba()
        tem = a is not None
        for acao in self._acoes_documento:
            acao.setEnabled(tem)
        if not tem:
            self.setWindowTitle(NOME)
            self.a_desfazer.setEnabled(False)
            self.a_refazer.setEnabled(False)
            self.rotulo_pagina.setText("")
            self.rotulo_zoom.setText("")
            self.rotulo_total.setText(" / 0 ")
            return
        d = a.documento
        self.abas.setTabText(self.abas.indexOf(a), a.titulo)
        self.abas.setTabToolTip(self.abas.indexOf(a),
                                str(d.caminho) if d.caminho else d.nome)
        self.setWindowTitle(f"{a.titulo} — {NOME}")
        self.a_desfazer.setEnabled(d.pode_desfazer())
        self.a_refazer.setEnabled(d.pode_refazer())
        self.a_desfazer.setText("&Desfazer " + d.descricao_desfazer()
                                if d.pode_desfazer() else "&Desfazer")
        self.a_refazer.setText("&Refazer " + d.descricao_refazer()
                               if d.pode_refazer() else "&Refazer")
        v = a.visualizador
        self.rotulo_pagina.setText(f" Página {v.pagina_atual + 1} de {d.paginas} ")
        self.rotulo_zoom.setText(f" {v.zoom * 100:.0f}% ")
        self.campo_pagina.blockSignals(True)
        self.campo_pagina.setMaximum(d.paginas)
        self.campo_pagina.setValue(v.pagina_atual + 1)
        self.campo_pagina.blockSignals(False)
        self.rotulo_total.setText(f" / {d.paginas} ")
        if not self.combo_zoom.lineEdit().hasFocus():
            self.combo_zoom.setEditText(f"{v.zoom * 100:.0f}%")
