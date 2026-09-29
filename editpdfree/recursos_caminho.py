"""Onde ficam os arquivos de `editpdfree/recursos` -- do fonte ou do .exe."""

from __future__ import annotations

import pathlib
import sys


def recursos() -> pathlib.Path:
    if getattr(sys, "frozen", False):
        return pathlib.Path(getattr(sys, "_MEIPASS", "")) / "editpdfree" / "recursos"
    return pathlib.Path(__file__).resolve().parent / "recursos"
