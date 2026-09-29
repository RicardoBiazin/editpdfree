"""Traducao dos dialogos padrao do Qt para portugues do Brasil.

Os `QTranslator` ficam guardados no proprio QApplication (`_tradutores`). Numa
variavel local, o coletor do Python os destroi e os botoes voltam ao ingles
segundos depois de a janela abrir -- licao do projeto irmao TextForgeEdit.
"""

from __future__ import annotations

import pathlib
import sys

from PySide6.QtCore import QLibraryInfo, QLocale, QTranslator


def _pastas() -> list[pathlib.Path]:
    pastas = []
    if getattr(sys, "frozen", False):
        pastas.append(pathlib.Path(getattr(sys, "_MEIPASS", "")) / "traducoes")
    pastas.append(pathlib.Path(QLibraryInfo.path(
        QLibraryInfo.LibraryPath.TranslationsPath)))
    return pastas


def instalar(app) -> int:
    QLocale.setDefault(QLocale(QLocale.Language.Portuguese,
                               QLocale.Country.Brazil))
    app._tradutores = []
    for nome in ("qtbase_pt_BR", "qt_pt_BR"):
        for pasta in _pastas():
            arquivo = pasta / f"{nome}.qm"
            if arquivo.is_file():
                t = QTranslator(app)
                if t.load(str(arquivo)):
                    app.installTranslator(t)
                    app._tradutores.append(t)
                    break
    return len(app._tradutores)
