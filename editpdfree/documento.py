"""O documento aberto: abrir, desfazer/refazer e gravar sem risco.

Tres decisoes que parecem detalhe e nao sao:

* **O arquivo e' lido para a memoria e aberto do fluxo** (`stream=`), nunca pelo
  caminho. Aberto pelo caminho, o MuPDF segura o arquivo aberto enquanto o
  documento vive, e no Windows a troca atomica no "Salvar" falha com acesso
  negado -- justamente ao gravar por cima do proprio arquivo.
* **Desfazer guarda instantaneos em bytes** (`tobytes`), e nao operacoes
  inversas. Operacao inversa de "apagar texto com tarja" nao existe: o conteudo
  foi reescrito. O custo e' memoria, por isso o limite `NIVEIS_DESFAZER`.
* **Gravar e' temporario na mesma pasta + `os.replace`.** Uma falha no meio
  (disco cheio, energia) deixa o original intacto. O temporario nasce na mesma
  pasta porque `os.replace` entre volumes falha.
"""

from __future__ import annotations

import contextlib
import os
import pathlib
import tempfile
from typing import Callable, Iterator

import pymupdf

NIVEIS_DESFAZER = 30


class SenhaNecessaria(Exception):
    """O PDF e' protegido e a senha nao veio (ou estava errada)."""


class Documento:
    def __init__(self, caminho: str | os.PathLike | None = None, *,
                 dados: bytes | None = None, senha: str | None = None,
                 nome: str | None = None):
        self.caminho: pathlib.Path | None = (
            pathlib.Path(caminho) if caminho else None)
        if dados is None and self.caminho is not None:
            dados = self.caminho.read_bytes()
        self._senha = senha
        #: Nome sugerido para um documento sem caminho (ex.: um DOCX
        #: convertido vira "relatorio.pdf").
        self._nome = nome
        #: Criptografia que o arquivo JA' tinha e que tem de sobreviver ao
        #: salvar. O MuPDF, depois de autenticar, grava o documento SEM
        #: criptografia (PDF_ENCRYPT_KEEP nao adianta num documento
        #: autenticado): sem isto, editar um PDF protegido e salvar tirava a
        #: senha dele em silencio.
        self._protecao: dict | None = None
        if dados is None:
            self.doc = pymupdf.open()
            self.doc.new_page()
        else:
            self.doc = self._abrir_bytes(dados)
            if self._senha and self.doc.metadata.get("encryption"):
                # A senha de dono original so' e' conhecida se foi ela a
                # digitada; senao a de abrir passa a valer para as duas.
                self._protecao = {
                    "encryption": pymupdf.PDF_ENCRYPT_AES_256,
                    "user_pw": self._senha, "owner_pw": self._senha,
                    "permissions": self.doc.permissions,
                }
        self.modificado = False
        self._desfazer: list[tuple[str, bytes]] = []
        self._refazer: list[tuple[str, bytes]] = []
        #: Parametros de criptografia a aplicar no proximo salvar. None mantem
        #: o que o arquivo ja' tinha.
        self.criptografia: dict | None = None
        self.ouvintes: list[Callable[[], None]] = []

    # -- abertura ----------------------------------------------------------
    def _abrir_bytes(self, dados: bytes) -> pymupdf.Document:
        doc = pymupdf.open(stream=dados, filetype="pdf")
        if doc.needs_pass:
            if not self._senha or not doc.authenticate(self._senha):
                doc.close()
                raise SenhaNecessaria()
        return doc

    @property
    def nome(self) -> str:
        if self.caminho:
            return self.caminho.name
        return self._nome or "Sem título.pdf"

    @property
    def paginas(self) -> int:
        return self.doc.page_count

    @property
    def protegido(self) -> bool:
        """Se o arquivo SALVO vai exigir senha (considerando o que esta'
        agendado em `criptografia`)."""
        prot = self.criptografia if self.criptografia is not None             else self._protecao
        return bool(prot and prot.get("encryption")
                    != pymupdf.PDF_ENCRYPT_NONE and prot.get("user_pw"))

    @property
    def assinado(self) -> bool:
        try:
            return self.doc.get_sigflags() > 0
        except Exception:                        # noqa: BLE001
            return False

    # -- avisos ------------------------------------------------------------
    def avisar(self) -> None:
        for ouvinte in list(self.ouvintes):
            ouvinte()

    # -- desfazer ----------------------------------------------------------
    def _instantaneo(self) -> bytes:
        # Sem criptografia: o instantaneo so' vive na memoria, e reabri-lo
        # criptografado exigiria autenticar de novo a cada desfazer.
        return self.doc.tobytes(garbage=0, deflate=False,
                                encryption=pymupdf.PDF_ENCRYPT_NONE)

    @contextlib.contextmanager
    def operacao(self, descricao: str) -> Iterator[pymupdf.Document]:
        """Toda alteracao passa por aqui: guarda o estado anterior, e se a
        operacao falhar no meio, volta a ele -- nenhum PDF fica meio editado."""
        antes = self._instantaneo()
        try:
            yield self.doc
        except BaseException:
            self._restaurar(antes)
            raise
        self._desfazer.append((descricao, antes))
        del self._desfazer[:-NIVEIS_DESFAZER]
        self._refazer.clear()
        self.modificado = True
        self.avisar()

    def _restaurar(self, dados: bytes) -> None:
        novo = pymupdf.open(stream=dados, filetype="pdf")
        self.doc.close()
        self.doc = novo

    def pode_desfazer(self) -> bool:
        return bool(self._desfazer)

    def pode_refazer(self) -> bool:
        return bool(self._refazer)

    def descricao_desfazer(self) -> str:
        return self._desfazer[-1][0] if self._desfazer else ""

    def descricao_refazer(self) -> str:
        return self._refazer[-1][0] if self._refazer else ""

    def desfazer(self) -> bool:
        if not self._desfazer:
            return False
        descricao, dados = self._desfazer.pop()
        self._refazer.append((descricao, self._instantaneo()))
        self._restaurar(dados)
        self.modificado = True
        self.avisar()
        return True

    def refazer(self) -> bool:
        if not self._refazer:
            return False
        descricao, dados = self._refazer.pop()
        self._desfazer.append((descricao, self._instantaneo()))
        self._restaurar(dados)
        self.modificado = True
        self.avisar()
        return True

    # -- gravacao ----------------------------------------------------------
    def _opcoes_gravar(self) -> dict:
        opcoes: dict = {"garbage": 3, "deflate": True}
        prot = self.criptografia if self.criptografia is not None             else self._protecao
        if prot:
            opcoes.update(prot)
        return opcoes

    def para_bytes(self) -> bytes:
        return self.doc.tobytes(**self._opcoes_gravar())

    def salvar(self, caminho: str | os.PathLike | None = None) -> pathlib.Path:
        destino = pathlib.Path(caminho) if caminho else self.caminho
        if destino is None:
            raise ValueError("documento sem caminho: use salvar como")
        destino = destino.resolve()
        dados = self.para_bytes()
        pasta = destino.parent
        fd, temporario = tempfile.mkstemp(prefix=".~" + destino.stem[:20],
                                          suffix=".epfnew", dir=pasta)
        try:
            with os.fdopen(fd, "wb") as saida:
                saida.write(dados)
                saida.flush()
                os.fsync(saida.fileno())
            os.replace(temporario, destino)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(temporario)
            raise
        if self.criptografia is not None:
            nova = self.criptografia
            self._protecao = (None if nova.get("encryption")
                              == pymupdf.PDF_ENCRYPT_NONE else dict(nova))
            self._senha = (self._protecao or {}).get("user_pw") or None
            self.criptografia = None
        # Reabre do que foi gravado: o documento em memoria passa a ser
        # exatamente o arquivo em disco.
        novo = pymupdf.open(stream=dados, filetype="pdf")
        if novo.needs_pass:
            novo.authenticate(self._senha or
                              (self._protecao or {}).get("owner_pw", ""))
        self.doc.close()
        self.doc = novo
        self.caminho = destino
        self.modificado = False
        self.avisar()
        return destino

    def fechar(self) -> None:
        self.ouvintes.clear()
        self.doc.close()
