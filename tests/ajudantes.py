"""Utilidades comuns as suites de teste.

Mesmo contrato do TextForgeEdit: `rodar_todos.py` conta as ocorrencias de
"\\n  OK   " e "\\n  FALHA" na saida de cada suite, entao os espacos importam.

    checa(cond, "descricao do que foi verificado")

`preparar_qt()` define QT_QPA_PLATFORM=offscreen e isola %APPDATA% ANTES de
importar PySide6 -- chame na primeira linha executavel de toda suite de
interface.
"""

from __future__ import annotations

import atexit
import contextlib
import os
import pathlib
import shutil
import sys
import tempfile
from typing import Iterator

RAIZ = pathlib.Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(errors="replace")
    except (AttributeError, OSError):
        pass

falhas: list[str] = []
_total = 0


def checa(condicao: object, mensagem: str) -> bool:
    global _total
    _total += 1
    ok = bool(condicao)
    print(("  OK   " if ok else "  FALHA") + " " + mensagem)
    if not ok:
        falhas.append(mensagem)
    return ok


def checa_igual(obtido: object, esperado: object, mensagem: str) -> bool:
    if obtido == esperado:
        return checa(True, mensagem)
    return checa(False, f"{mensagem}\n         esperado: {esperado!r}"
                        f"\n         obtido:   {obtido!r}")


def checa_levanta(excecao: type[BaseException], funcao, mensagem: str,
                  *args, **kwargs) -> bool:
    try:
        funcao(*args, **kwargs)
    except excecao:
        return checa(True, mensagem)
    except BaseException as exc:                  # noqa: BLE001
        return checa(False, f"{mensagem} (levantou {exc.__class__.__name__})")
    return checa(False, f"{mensagem} (nao levantou nada)")


def secao(titulo: str) -> None:
    print(f"\n[{titulo}]")


def resumir() -> int:
    print()
    if falhas:
        print("FALHAS: %d de %d verificacoes" % (len(falhas), _total))
        for f in falhas:
            print("  - " + f.splitlines()[0])
    else:
        print("TODOS OS TESTES PASSARAM (%d verificacoes)" % _total)
    return 1 if falhas else 0


def _isolar_appdata() -> None:
    """%APPDATA% descartavel para o processo inteiro: a janela grava
    preferencias e a assinatura ao fechar, e isso nunca pode cair no perfil
    real do usuario."""
    if os.environ.get("EPF_APPDATA_ISOLADO"):
        return
    pasta = pathlib.Path(tempfile.mkdtemp(prefix="epf-appdata-suite-"))
    os.environ["APPDATA"] = str(pasta)
    os.environ["EPF_APPDATA_ISOLADO"] = "1"
    atexit.register(shutil.rmtree, pasta, True)


def preparar_qt() -> bool:
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    _isolar_appdata()
    try:
        from PySide6.QtWidgets import QApplication
    except ImportError:
        return False
    if QApplication.instance() is None:
        QApplication([])
    return True


def pular(motivo: str) -> int:
    print(f"PULADO: {motivo}")
    return 0


@contextlib.contextmanager
def pasta_temporaria(prefixo: str = "epf-teste-") -> Iterator[pathlib.Path]:
    caminho = pathlib.Path(tempfile.mkdtemp(prefix=prefixo))
    try:
        yield caminho
    finally:
        shutil.rmtree(caminho, ignore_errors=True)


def drenar_eventos(rodadas: int = 4) -> None:
    import gc

    from PySide6.QtCore import QCoreApplication, QEvent
    from PySide6.QtWidgets import QApplication

    for _ in range(rodadas):
        QApplication.processEvents()
        QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        gc.collect()


# -- fixtures geradas (nenhum PDF binario no repositorio) ---------------------
def pdf_texto(linhas_por_pagina: list[list[str]], *, largura: float = 595,
              altura: float = 842, rotacoes: list[int] | None = None) -> bytes:
    """PDF com as linhas dadas em cada pagina, a partir de (72, 100), a cada
    24 pontos, Helvetica 12."""
    import pymupdf
    doc = pymupdf.open()
    for n, linhas in enumerate(linhas_por_pagina):
        p = doc.new_page(width=largura, height=altura)
        for i, linha in enumerate(linhas):
            p.insert_text((72, 100 + 24 * i), linha, fontsize=12)
        if rotacoes:
            p.set_rotation(rotacoes[n])
    dados = doc.tobytes()
    doc.close()
    return dados


def paginas_numeradas(n: int) -> bytes:
    return pdf_texto([[f"Pagina {i + 1}"] for i in range(n)])


def texto_da_pagina(doc_ou_documento, i: int) -> str:
    doc = getattr(doc_ou_documento, "doc", doc_ou_documento)
    return doc[i].get_text()


def primeira_linha(doc_ou_documento, i: int) -> str:
    return texto_da_pagina(doc_ou_documento, i).strip().splitlines()[0]
