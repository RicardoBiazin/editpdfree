"""Processamento em lote: a mesma sequencia de operacoes em varios arquivos.

Cada arquivo e' aberto, processado e gravado na pasta de saida com o mesmo
nome. **Os originais nunca sao alterados**, e a pasta de saida nao pode ser a
mesma de origem de nenhum arquivo -- gravar por cima de um lote inteiro por
engano nao tem desfazer.
"""

from __future__ import annotations

import dataclasses
import os
import pathlib
from typing import Callable, Sequence

from . import extras, ocr, paginas, pdfa, seguranca
from .documento import Documento, SenhaNecessaria


@dataclasses.dataclass
class Operacao:
    nome: str
    aplicar: Callable[[Documento], None]


@dataclasses.dataclass
class Resultado:
    arquivo: pathlib.Path
    saida: pathlib.Path | None
    erro: str = ""

    @property
    def ok(self) -> bool:
        return not self.erro


# Fabricas de operacoes -- a interface monta a lista a partir do dialogo.
def op_marca_dagua(texto: str, **kw) -> Operacao:
    return Operacao("Marca d’água",
                    lambda d: extras.marca_dagua(d, texto, **kw))


def op_numerar(**kw) -> Operacao:
    return Operacao("Numerar páginas", lambda d: extras.numerar(d, **kw))


def op_cabecalho_rodape(textos: dict, **kw) -> Operacao:
    return Operacao("Cabeçalho e rodapé",
                    lambda d: extras.cabecalho_rodape(d, textos, **kw))


def op_comprimir(**kw) -> Operacao:
    return Operacao("Comprimir", lambda d: extras.comprimir(d, **kw))


def op_girar(graus: int) -> Operacao:
    return Operacao("Girar",
                    lambda d: paginas.girar(d, range(d.paginas), graus))


def op_ocr(idioma: str = "por+eng") -> Operacao:
    return Operacao("OCR", lambda d: ocr.reconhecer(d, idioma=idioma))


def op_proteger(senha: str, dono: str | None = None) -> Operacao:
    return Operacao("Senha", lambda d: seguranca.proteger(d, senha, dono))


def op_pdfa() -> Operacao:
    return Operacao("PDF/A", pdfa.para_pdfa)


def op_marca_imagem(imagem: bytes, **kw) -> Operacao:
    return Operacao("Marca d’água de imagem",
                    lambda d: extras.marca_dagua_imagem(d, imagem, **kw))


def op_remover_senha() -> Operacao:
    return Operacao("Remover senha", seguranca.remover_protecao)


def processar(arquivos: Sequence[str | os.PathLike],
              pasta_saida: str | os.PathLike,
              operacoes: Sequence[Operacao], *,
              senha_entrada: str | None = None,
              progresso: Callable[[int, int, str], bool] | None = None
              ) -> list[Resultado]:
    if not operacoes:
        raise ValueError("Escolha ao menos uma operação.")
    saida = pathlib.Path(pasta_saida).resolve()
    arquivos = [pathlib.Path(a).resolve() for a in arquivos]
    for a in arquivos:
        if a.parent == saida:
            raise ValueError("A pasta de saída não pode ser a mesma dos "
                             "arquivos: os originais seriam sobrescritos.")
    saida.mkdir(parents=True, exist_ok=True)
    resultados = []
    for n, arquivo in enumerate(arquivos):
        if progresso is not None and progresso(n, len(arquivos),
                                               arquivo.name) is False:
            break
        destino = saida / (arquivo.stem + ".pdf")
        try:
            try:
                d = Documento(arquivo, senha=senha_entrada)
            except SenhaNecessaria:
                raise ValueError("protegido por senha") from None
            try:
                for op in operacoes:
                    op.aplicar(d)
                d.salvar(destino)
            finally:
                d.fechar()
            resultados.append(Resultado(arquivo, destino))
        except Exception as erro:                   # noqa: BLE001
            resultados.append(Resultado(arquivo, None,
                                        str(erro) or erro.__class__.__name__))
    if progresso is not None:
        progresso(len(arquivos), len(arquivos), "")
    return resultados


def pdfs_da_pasta(pasta: str | os.PathLike,
                  subpastas: bool = False) -> list[pathlib.Path]:
    pasta = pathlib.Path(pasta)
    padrao = "**/*" if subpastas else "*"
    return sorted(p for p in pasta.glob(padrao)
                  if p.is_file() and p.suffix.lower() == ".pdf")
