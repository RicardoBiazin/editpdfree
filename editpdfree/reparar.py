"""Reparar PDF danificado.

O MuPDF ja' reconstroi a tabela de referencias (xref) ao abrir um arquivo
quebrado: le o arquivo inteiro procurando "N 0 obj" e remonta o que der. O
que este modulo acrescenta e' GRAVAR o resultado limpo (garbage=4 remove
objetos orfaos e duplicados, clean=True reescreve os fluxos de conteudo) e
dizer ao usuario o que foi recuperado -- "reparado" sem relatorio nao diz se
voltou a primeira pagina ou o documento inteiro.
"""

from __future__ import annotations

import dataclasses
import os
import pathlib

import pymupdf


@dataclasses.dataclass
class Relatorio:
    paginas: int
    precisou_reparo: bool
    paginas_ilegiveis: list[int]
    tamanho_antes: int
    tamanho_depois: int
    avisos: str

    @property
    def resumo(self) -> str:
        if not self.precisou_reparo and not self.paginas_ilegiveis:
            base = f"O arquivo não estava danificado ({self.paginas} página(s))."
        else:
            base = f"Recuperada(s) {self.paginas - len(self.paginas_ilegiveis)} " \
                   f"de {self.paginas} página(s)."
        if self.paginas_ilegiveis:
            base += " Página(s) com conteúdo ilegível: " + ", ".join(
                str(i + 1) for i in self.paginas_ilegiveis) + "."
        return base


def reparar(origem: str | os.PathLike | bytes) -> tuple[bytes, Relatorio]:
    """Devolve (bytes do PDF reparado, relatorio). Nao grava nada."""
    dados = origem if isinstance(origem, bytes) else \
        pathlib.Path(origem).read_bytes()
    pymupdf.TOOLS.reset_mupdf_warnings()
    try:
        doc = pymupdf.open(stream=dados, filetype="pdf")
    except Exception as erro:                       # noqa: BLE001
        raise ValueError("O arquivo está danificado demais para ser "
                         f"recuperado ({erro}).") from None
    try:
        if doc.needs_pass:
            raise ValueError("O PDF é protegido por senha: abra-o no "
                             "EditPDFree com a senha e salve.")
        if doc.page_count == 0:
            raise ValueError("Nenhuma página pôde ser recuperada.")
        reparado_ao_abrir = bool(doc.is_repaired)
        ilegiveis = []
        for i in range(doc.page_count):
            try:
                # Interpretar o conteudo e' o que falha numa pagina corrompida.
                doc[i].get_text("text")
            except Exception:                        # noqa: BLE001
                ilegiveis.append(i)
        avisos = pymupdf.TOOLS.mupdf_warnings()
        saida = doc.tobytes(garbage=4, clean=True, deflate=True)
        relatorio = Relatorio(
            paginas=doc.page_count, precisou_reparo=reparado_ao_abrir,
            paginas_ilegiveis=ilegiveis, tamanho_antes=len(dados),
            tamanho_depois=len(saida), avisos=avisos)
        return saida, relatorio
    finally:
        doc.close()
