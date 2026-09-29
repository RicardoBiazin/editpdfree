r"""Gera editpdfree\recursos\icone.ico a partir do desenho em `icones.py`.

    .venv\Scripts\python.exe ferramentas\gerar_icone.py

O .ico entra no repositorio (o .spec o embute no .exe); rode de novo so' se o
desenho do icone "app" mudar.
"""

from __future__ import annotations

import os
import pathlib
import struct
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt  # noqa: E402
from PySide6.QtGui import QPainter, QPixmap  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

TAMANHOS = (16, 24, 32, 48, 64, 128, 256)


def _png(pixmap: QPixmap) -> bytes:
    dados = QByteArray()
    buf = QBuffer(dados)
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    pixmap.save(buf, "PNG")
    buf.close()
    return bytes(dados)


def main() -> int:
    app = QApplication.instance() or QApplication([])
    from editpdfree.interface import icones

    imagens = []
    for t in TAMANHOS:
        # Desenha no tamanho final, escalando o PAINTER (e nao a imagem):
        # reduzir um bitmap de 48 px para 16 borra o traco.
        pix = QPixmap(t, t)
        pix.fill(Qt.GlobalColor.transparent)
        p = QPainter(pix)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.scale(t / icones.TAMANHO, t / icones.TAMANHO)
        icones._desenhar("app", p)
        p.end()
        imagens.append((t, _png(pix)))

    # Formato ICO com PNG embutido (aceito desde o Vista), varios tamanhos.
    cabecalho = struct.pack("<HHH", 0, 1, len(imagens))
    deslocamento = 6 + 16 * len(imagens)
    diretorio = b""
    corpo = b""
    for t, png in imagens:
        lado = 0 if t >= 256 else t
        diretorio += struct.pack("<BBBBHHII", lado, lado, 0, 0, 1, 32,
                                 len(png), deslocamento + len(corpo))
        corpo += png
    destino = RAIZ / "editpdfree" / "recursos" / "icone.ico"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(cabecalho + diretorio + corpo)
    print(destino, destino.stat().st_size, "bytes")
    del app
    return 0


if __name__ == "__main__":
    sys.exit(main())
