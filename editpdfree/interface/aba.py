"""Uma aba = um documento: miniaturas + visualizador + as acoes sobre ele.

Os pedidos ao usuario (texto, arquivo, confirmacao) passam pelas funcoes
`pedir_*` deste modulo, e nao direto pelos dialogos do Qt. Os testes trocam
essas funcoes; sem isso, um `QInputDialog` modal em modo offscreen travaria a
suite para sempre, sem ninguem para clicar.
"""

from __future__ import annotations

import os
import pathlib

import pymupdf
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QFileDialog, QInputDialog, QMenu, QMessageBox,
                               QSplitter, QVBoxLayout, QWidget)

from .. import anotacoes, formularios, paginas, seguranca, texto
from ..documento import Documento
from . import config, dialogos
from .ferramentas import Ferramenta
from .miniaturas import Miniaturas
from .visualizador import Visualizador


# -- pedidos ao usuario (trocados nos testes) ---------------------------------
def pedir_texto(parent, titulo: str, rotulo: str, inicial: str = "",
                varias_linhas: bool = False) -> str | None:
    if varias_linhas:
        valor, ok = QInputDialog.getMultiLineText(parent, titulo, rotulo,
                                                  inicial)
    else:
        valor, ok = QInputDialog.getText(parent, titulo, rotulo, text=inicial)
    return valor if ok else None


def pedir_arquivo(parent, titulo: str, filtro: str, pasta: str = "") -> str | None:
    arquivo, _ = QFileDialog.getOpenFileName(parent, titulo, pasta, filtro)
    return arquivo or None


def pedir_destino(parent, titulo: str, sugestao: str, filtro: str) -> str | None:
    arquivo, _ = QFileDialog.getSaveFileName(parent, titulo, sugestao, filtro)
    return arquivo or None


def pedir_pasta(parent, titulo: str, pasta: str = "") -> str | None:
    return QFileDialog.getExistingDirectory(parent, titulo, pasta) or None


def pedir_edicao(parent, trecho: texto.Trecho):
    """Devolve (texto, tamanho, cor) ou None."""
    d = dialogos.DialogoEditarTexto(trecho.texto, trecho.tamanho, trecho.cor,
                                    trecho.fonte, parent)
    if d.exec() != d.DialogCode.Accepted:
        return None
    return d.texto.text(), d.tamanho.value(), d.cor.cor


def pedir_assinatura(parent) -> bytes | None:
    d = dialogos.DialogoAssinatura(parent)
    if d.exec() != d.DialogCode.Accepted:
        return None
    return d.png


def avisar(parent, titulo: str, mensagem: str) -> None:
    QMessageBox.warning(parent, titulo, mensagem)


def confirmar(parent, titulo: str, mensagem: str) -> bool:
    r = QMessageBox.question(parent, titulo, mensagem,
                             QMessageBox.StandardButton.Yes
                             | QMessageBox.StandardButton.No,
                             QMessageBox.StandardButton.No)
    return r == QMessageBox.StandardButton.Yes


#: Devolvido por `_executar` quando a operacao falhou (None e' um retorno
#: normal das operacoes do nucleo, entao nao serve de sinal).
FALHOU = object()


class AbaDocumento(QWidget):
    estadoMudou = Signal()
    mensagem = Signal(str)

    def __init__(self, documento: Documento, estilo_fn, parent=None):
        super().__init__(parent)
        self.documento = documento
        self._estilo = estilo_fn           # callable -> anotacoes.Estilo
        self.visualizador = Visualizador()
        self.miniaturas = Miniaturas()
        divisor = QSplitter(Qt.Orientation.Horizontal)
        divisor.addWidget(self.miniaturas)
        divisor.addWidget(self.visualizador)
        divisor.setStretchFactor(1, 1)
        divisor.setSizes([190, 900])
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(divisor)
        self.divisor = divisor
        self.resultados: list[tuple[int, pymupdf.Rect]] = []
        self.resultado_atual = -1
        self._busca = ""

        documento.ouvintes.append(self._documento_mudou)
        self.visualizador.definir_documento(documento)
        self.miniaturas.definir_documento(documento)

        v = self.visualizador
        v.paginaAtualMudou.connect(self.miniaturas.marcar_pagina)
        v.paginaAtualMudou.connect(lambda _i: self.estadoMudou.emit())
        v.zoomMudou.connect(lambda _z: self.estadoMudou.emit())
        v.retanguloFeito.connect(self._retangulo)
        v.cliqueFeito.connect(self._clique)
        v.linhaFeita.connect(self._linha)
        v.tracoFeito.connect(self._traco)
        v.anotacaoArrastada.connect(self._mover_anotacao)
        v.anotacaoExcluir.connect(self._excluir_anotacao)
        v.selecaoFeita.connect(self._selecao)
        v.campoClicado.connect(self._campo)
        m = self.miniaturas
        m.paginaEscolhida.connect(v.ir_para_pagina)
        m.ordemMudou.connect(self._reordenar)
        m.acaoPedida.connect(self._acao_miniatura)

    # -- estado ------------------------------------------------------------
    @property
    def titulo(self) -> str:
        return ("• " if self.documento.modificado else "") + self.documento.nome

    def _documento_mudou(self) -> None:
        self.visualizador.recarregar(manter_posicao=True)
        self.miniaturas.recarregar()
        if self._busca:
            self._buscar_de_novo()
        self.estadoMudou.emit()

    def _executar(self, funcao, *args, **kwargs):
        """Roda uma operacao do nucleo e mostra o erro em vez de derrubar."""
        try:
            return funcao(*args, **kwargs)
        except (ValueError, IndexError, LookupError, RuntimeError,
                OSError) as erro:
            avisar(self, "EditPDFree", str(erro) or erro.__class__.__name__)
        except Exception as erro:                   # noqa: BLE001
            avisar(self, "EditPDFree",
                   f"Não foi possível concluir a operação:\n{erro}")
        return FALHOU

    def paginas_alvo(self) -> list[int]:
        sel = self.miniaturas.indices_selecionados()
        return sel or [self.visualizador.pagina_atual]

    # -- gestos do visualizador ------------------------------------------------
    def _retangulo(self, ferramenta: Ferramenta, pagina: int,
                   rect: pymupdf.Rect) -> None:
        estilo = self._estilo()
        d = self.documento
        if ferramenta in (Ferramenta.DESTACAR, Ferramenta.SUBLINHAR,
                          Ferramenta.TACHAR):
            ok = self._executar(anotacoes.marcar_texto, d, pagina, rect,
                                ferramenta.value, estilo)
            if ok is False:
                self.mensagem.emit("Nenhum texto na área selecionada.")
        elif ferramenta in (Ferramenta.RETANGULO, Ferramenta.ELIPSE):
            self._executar(anotacoes.forma, d, pagina, ferramenta.value,
                           pymupdf.Point(rect.x0, rect.y0),
                           pymupdf.Point(rect.x1, rect.y1), estilo)
        elif ferramenta is Ferramenta.CAIXA_TEXTO:
            valor = pedir_texto(self, "Caixa de texto", "Texto:",
                                varias_linhas=True)
            if valor:
                if rect.width < 5 or rect.height < 5:
                    rect = pymupdf.Rect(rect.x0, rect.y0, rect.x0 + 1,
                                        rect.y0 + 1)
                self._executar(anotacoes.texto_livre, d, pagina, rect, valor,
                               estilo)
        elif ferramenta is Ferramenta.IMAGEM:
            arquivo = pedir_arquivo(self, "Inserir imagem",
                                    dialogos.FILTRO_IMAGEM)
            if arquivo:
                if rect.width < 5 or rect.height < 5:
                    rect = pymupdf.Rect(rect.x0, rect.y0, rect.x0 + 200,
                                        rect.y0 + 200)
                self._executar(anotacoes.imagem, d, pagina, rect,
                               arquivo=arquivo)
        elif ferramenta is Ferramenta.TARJAR:
            self._executar(seguranca.tarjar, d, [(pagina, rect)])
        elif ferramenta in (Ferramenta.CAMPO_TEXTO, Ferramenta.CAIXA_SELECAO):
            caixa = ferramenta is Ferramenta.CAIXA_SELECAO
            if rect.width < 5 or rect.height < 5:
                lado = 14 if caixa else 20
                rect = pymupdf.Rect(rect.x0, rect.y0,
                                    rect.x0 + (lado if caixa else 160),
                                    rect.y0 + lado)
            existentes = {c.nome for c in formularios.campos(d)}
            n = len(existentes) + 1
            while f"campo{n}" in existentes:
                n += 1
            nome = pedir_texto(self, "Novo campo", "Nome do campo:",
                               f"campo{n}")
            if nome:
                funcao = (formularios.criar_caixa_selecao if caixa
                          else formularios.criar_campo_texto)
                self._executar(funcao, d, pagina, rect, nome)

    def _clique(self, ferramenta: Ferramenta, pagina: int,
                ponto: pymupdf.Point) -> None:
        estilo = self._estilo()
        d = self.documento
        if ferramenta is Ferramenta.NOTA:
            valor = pedir_texto(self, "Nota", "Texto da nota:",
                                varias_linhas=True)
            if valor:
                self._executar(anotacoes.nota, d, pagina, ponto, valor, estilo)
        elif ferramenta is Ferramenta.ADICIONAR_TEXTO:
            valor = pedir_texto(self, "Adicionar texto", "Texto:")
            if valor:
                self._executar(texto.inserir_texto, d, pagina, ponto, valor,
                               tamanho=estilo.tamanho_fonte, cor=estilo.cor)
        elif ferramenta is Ferramenta.EDITAR_TEXTO:
            trecho = texto.trecho_em(d, pagina, ponto)
            if trecho is None:
                self.mensagem.emit("Nenhum texto neste ponto.")
                return
            resposta = pedir_edicao(self, trecho)
            if resposta is None:
                return
            novo, tamanho, cor = resposta
            if (novo, tamanho, tuple(cor)) == (trecho.texto, trecho.tamanho,
                                               tuple(trecho.cor)):
                return
            self._executar(texto.substituir_trecho, d, trecho, novo,
                           tamanho=tamanho, cor=cor)
        elif ferramenta is Ferramenta.ASSINATURA:
            self.colocar_assinatura(pagina, ponto)

    def colocar_assinatura(self, pagina: int, ponto: pymupdf.Point,
                           nova: bool = False) -> None:
        arquivo = config.caminho_assinatura()
        if nova or not arquivo.is_file():
            png = pedir_assinatura(self)
            if not png:
                return
            arquivo.write_bytes(png)
        dados = arquivo.read_bytes()
        pix = pymupdf.Pixmap(dados)
        largura = 150.0
        altura = largura * pix.height / max(1, pix.width)
        p = self.documento.doc[pagina]
        # O clique marca o CENTRO da assinatura, no espaco que o leitor ve.
        girado = pymupdf.Point(ponto) * p.rotation_matrix
        if p.rotation in (90, 270):
            largura, altura = altura, largura
        r = pymupdf.Rect(girado.x - largura / 2, girado.y - altura / 2,
                         girado.x + largura / 2, girado.y + altura / 2)
        r = r * p.derotation_matrix
        r.normalize()
        self._executar(anotacoes.imagem, self.documento, pagina, r,
                       dados=dados, descricao="Assinar")

    def _linha(self, ferramenta: Ferramenta, pagina: int, inicio, fim) -> None:
        self._executar(anotacoes.forma, self.documento, pagina,
                       ferramenta.value, inicio, fim, self._estilo())

    def _traco(self, pagina: int, tracos) -> None:
        self._executar(anotacoes.caneta, self.documento, pagina, tracos,
                       self._estilo())

    def _mover_anotacao(self, pagina: int, xref: int, dx: float,
                        dy: float) -> None:
        if self._executar(anotacoes.mover_anotacao, self.documento, pagina,
                          xref, dx, dy) is FALHOU:
            self.visualizador.recarregar()

    def _excluir_anotacao(self, pagina: int, xref: int) -> None:
        self.visualizador.selecionar_anotacao(None)
        self._executar(anotacoes.excluir_anotacao, self.documento, pagina, xref)

    def excluir_selecionada(self) -> bool:
        sel = self.visualizador.selecionada
        if not sel:
            return False
        self._excluir_anotacao(*sel)
        return True

    def _selecao(self, pagina: int, rect: pymupdf.Rect, posicao) -> None:
        """Menu da selecao feita com a ferramenta Selecionar."""
        menu = QMenu(self)
        copiar = menu.addAction("Copiar texto")
        menu.addSeparator()
        destacar = menu.addAction("Destacar")
        sublinhar = menu.addAction("Sublinhar")
        tachar = menu.addAction("Tachar")
        menu.addSeparator()
        tarjar = menu.addAction("Tarjar (remover definitivamente)")
        escolhida = menu.exec(posicao)
        if escolhida is copiar:
            self.copiar_texto(pagina, rect)
        elif escolhida in (destacar, sublinhar, tachar):
            tipo = {destacar: Ferramenta.DESTACAR, sublinhar:
                    Ferramenta.SUBLINHAR, tachar: Ferramenta.TACHAR}[escolhida]
            self._retangulo(tipo, pagina, rect)
        elif escolhida is tarjar:
            self._retangulo(Ferramenta.TARJAR, pagina, rect)

    def copiar_texto(self, pagina: int, rect: pymupdf.Rect) -> str:
        valor = self.documento.doc[pagina].get_textbox(rect).strip()
        QGuiApplication.clipboard().setText(valor)
        self.mensagem.emit(f"{len(valor)} caractere(s) copiado(s).")
        return valor

    def _campo(self, pagina: int, ponto: pymupdf.Point) -> None:
        c = formularios.campo_em(self.documento, pagina, ponto)
        if c is None:
            return
        if c.marcavel:
            valor: str | bool = not bool(c.valor)
        else:
            valor = pedir_texto(self, "Preencher campo", c.nome + ":",
                                str(c.valor))
            if valor is None or valor == c.valor:
                return
        self._executar(formularios.preencher, self.documento, {c.xref: valor})

    # -- paginas -------------------------------------------------------------
    def _reordenar(self, ordem: list[int]) -> None:
        if self._executar(paginas.reordenar, self.documento, ordem) is FALHOU:
            self.miniaturas.recarregar()

    def _acao_miniatura(self, acao: str, indices: list[int]) -> None:
        if acao == "girar_esq":
            self.girar(-90, indices)
        elif acao == "girar_dir":
            self.girar(90, indices)
        elif acao == "excluir":
            self.excluir_paginas(indices)
        elif acao == "duplicar":
            self._executar(paginas.duplicar, self.documento, indices[-1])
        elif acao == "branco_depois":
            self._executar(paginas.inserir_em_branco, self.documento,
                           indices[-1] + 1)
        elif acao == "inserir_arquivo":
            self.inserir_arquivo(indices[-1] + 1)
        elif acao == "extrair":
            self.extrair_paginas(indices)

    def girar(self, graus: int, indices: list[int] | None = None) -> None:
        self._executar(paginas.girar, self.documento,
                       indices or self.paginas_alvo(), graus)

    def excluir_paginas(self, indices: list[int] | None = None) -> None:
        indices = indices or self.paginas_alvo()
        rotulo = (f"a página {indices[0] + 1}" if len(indices) == 1
                  else f"{len(indices)} páginas")
        if confirmar(self, "Excluir páginas", f"Excluir {rotulo}?"):
            self._executar(paginas.excluir, self.documento, indices)

    def mover_pagina(self, passo: int) -> None:
        atual = self.visualizador.pagina_atual
        destino = atual + passo
        if 0 <= destino < self.documento.paginas:
            if self._executar(paginas.mover, self.documento, atual,
                              destino) is not FALHOU:
                self.visualizador.ir_para_pagina(destino)

    def inserir_arquivo(self, posicao: int | None = None) -> None:
        arquivo = pedir_arquivo(self, "Inserir arquivo",
                                dialogos.FILTRO_ENTRADA)
        if arquivo:
            if posicao is None:
                posicao = self.visualizador.pagina_atual + 1
            quantas = self._executar(paginas.inserir_arquivo, self.documento,
                                     arquivo, posicao)
            if quantas and quantas is not FALHOU:
                self.mensagem.emit(f"{quantas} página(s) inserida(s).")

    def extrair_paginas(self, indices: list[int] | None = None) -> None:
        indices = indices or self.paginas_alvo()
        base = pathlib.Path(self.documento.nome).stem
        sugestao = str(self._pasta() / f"{base}_extraido.pdf")
        destino = pedir_destino(self, "Extrair páginas", sugestao,
                                dialogos.FILTRO_PDF)
        if destino:
            if self._executar(paginas.extrair, self.documento, indices,
                              destino) is not FALHOU:
                self.mensagem.emit(f"{len(indices)} página(s) extraída(s) "
                                   f"para {destino}")

    def _pasta(self) -> pathlib.Path:
        if self.documento.caminho:
            return self.documento.caminho.parent
        return pathlib.Path.home()

    # -- busca -----------------------------------------------------------------
    def buscar(self, termo: str) -> int:
        self._busca = termo
        self.resultados = []
        if termo:
            for i in range(self.documento.paginas):
                for r in self.documento.doc[i].search_for(termo):
                    self.resultados.append((i, r))
        self.resultado_atual = 0 if self.resultados else -1
        self._mostrar_resultado()
        return len(self.resultados)

    def _buscar_de_novo(self) -> None:
        atual = self.resultado_atual
        self.buscar(self._busca)
        if self.resultados:
            self.resultado_atual = min(max(atual, 0), len(self.resultados) - 1)
            self._mostrar_resultado()

    def proximo(self, passo: int = 1) -> None:
        if not self.resultados:
            return
        self.resultado_atual = (self.resultado_atual + passo) % len(self.resultados)
        self._mostrar_resultado()

    def _mostrar_resultado(self) -> None:
        self.visualizador.marcar_resultados(
            self.resultados, self.resultado_atual if self.resultados else None)
        if self.resultados:
            pagina, rect = self.resultados[self.resultado_atual]
            self.visualizador.mostrar_retangulo(pagina, rect)

    def limpar_busca(self) -> None:
        self._busca = ""
        self.resultados = []
        self.resultado_atual = -1
        self.visualizador.marcar_resultados([])

    # -- fechar ----------------------------------------------------------------
    def fechar(self) -> None:
        # Os temporizadores de renderizacao podem estar armados; sem soltar o
        # documento antes, eles disparam depois e acham um PDF ja' fechado.
        self.visualizador._temporizador.stop()
        self.miniaturas._temporizador.stop()
        self.visualizador.documento = None
        self.miniaturas.documento = None
        self.documento.fechar()


def pasta_padrao(cfg: config.Config) -> str:
    p = cfg.get("ultima_pasta") or ""
    return p if p and os.path.isdir(p) else str(pathlib.Path.home())
