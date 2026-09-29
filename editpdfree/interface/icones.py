"""Icones desenhados em codigo (QPainter), sem arquivos de imagem.

Desenhados, e nao baixados de um pacote de icones: nenhum arquivo para o
PyInstaller esquecer, nenhuma licenca de terceiro para acompanhar, e o traco
acompanha a paleta do tema (claro/escuro) porque a cor vem dela.
"""

from __future__ import annotations

import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QColor, QFont, QIcon, QPainter,
                           QPainterPath, QPalette, QPen, QPixmap, QPolygonF)
from PySide6.QtWidgets import QApplication

TAMANHO = 48       # desenhado grande e reduzido pelo Qt: fica nitido em 4K


def _cor_traco() -> QColor:
    app = QApplication.instance()
    if app is None:
        return QColor(40, 40, 40)
    return app.palette().color(QPalette.ColorRole.WindowText)


def _cor_fundo() -> QColor:
    """Preenchimento que contrasta com o traco: claro no tema claro, escuro
    no escuro. Branco fixo sumia no tema escuro (traco claro sobre branco)."""
    app = QApplication.instance()
    if app is None:
        return QColor(255, 255, 255)
    return app.palette().color(QPalette.ColorRole.Base)


def _novo() -> tuple[QPixmap, QPainter]:
    pix = QPixmap(TAMANHO, TAMANHO)
    pix.fill(Qt.GlobalColor.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setRenderHint(QPainter.RenderHint.TextAntialiasing)
    return pix, p


def _caneta(cor: QColor | None = None, largura: float = 3.2) -> QPen:
    pen = QPen(cor or _cor_traco(), largura)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    return pen


def _letra(p: QPainter, texto: str, rect: QRectF, *, negrito=True,
           tamanho=26, cor: QColor | None = None, serif=False) -> None:
    fonte = QFont("Times New Roman" if serif else "Segoe UI")
    fonte.setPixelSize(tamanho)
    fonte.setBold(negrito)
    p.setFont(fonte)
    p.setPen(cor or _cor_traco())
    p.drawText(rect, Qt.AlignmentFlag.AlignCenter, texto)


def _seta_ponta(p: QPainter, a: QPointF, b: QPointF, tamanho=11) -> None:
    ang = math.atan2(b.y() - a.y(), b.x() - a.x())
    pontos = [b,
              QPointF(b.x() - tamanho * math.cos(ang - 0.45),
                      b.y() - tamanho * math.sin(ang - 0.45)),
              QPointF(b.x() - tamanho * math.cos(ang + 0.45),
                      b.y() - tamanho * math.sin(ang + 0.45))]
    p.setBrush(p.pen().color())
    p.drawPolygon(QPolygonF(pontos))
    p.setBrush(Qt.BrushStyle.NoBrush)


def _pagina(p: QPainter, dobra=True) -> None:
    path = QPainterPath()
    path.moveTo(12, 5)
    path.lineTo(30, 5)
    path.lineTo(38, 13)
    path.lineTo(38, 43)
    path.lineTo(12, 43)
    path.closeSubpath()
    p.setPen(_caneta(largura=2.6))
    p.setBrush(QColor(255, 255, 255, 230))
    p.drawPath(path)
    p.setBrush(Qt.BrushStyle.NoBrush)
    if dobra:
        p.drawPolyline(QPolygonF([QPointF(30, 5), QPointF(30, 13),
                                  QPointF(38, 13)]))


def _desenhar(nome: str, p: QPainter) -> None:
    c = _cor_traco()
    vermelho = QColor(215, 40, 40)
    azul = QColor(30, 110, 210)
    if nome == "abrir":
        p.setPen(_caneta())
        p.setBrush(QColor(240, 190, 70))
        p.drawPath(_pasta())
    elif nome == "salvar":
        p.setPen(_caneta())
        p.setBrush(QColor(80, 130, 210))
        p.drawRoundedRect(QRectF(8, 8, 32, 32), 3, 3)
        p.setBrush(QColor(255, 255, 255))
        p.drawRect(QRectF(15, 8, 18, 11))
        p.drawRect(QRectF(14, 27, 20, 13))
    elif nome in ("desfazer", "refazer"):
        p.setPen(_caneta(largura=3.6))
        path = QPainterPath()
        if nome == "desfazer":
            path.moveTo(14, 20)
            path.cubicTo(24, 10, 42, 14, 38, 32)
            p.drawPath(path)
            _seta_ponta(p, QPointF(22, 14), QPointF(10, 22), 12)
        else:
            path.moveTo(34, 20)
            path.cubicTo(24, 10, 6, 14, 10, 32)
            p.drawPath(path)
            _seta_ponta(p, QPointF(26, 14), QPointF(38, 22), 12)
    elif nome in ("girar_esq", "girar_dir"):
        _pagina(p, dobra=False)
        p.setPen(_caneta(azul, 3.4))
        r = QRectF(16, 14, 18, 18)
        if nome == "girar_dir":
            p.drawArc(r, 200 * 16, -250 * 16)
            _seta_ponta(p, QPointF(33, 20), QPointF(33, 27), 9)
        else:
            p.drawArc(r, -20 * 16, 250 * 16)
            _seta_ponta(p, QPointF(17, 20), QPointF(17, 27), 9)
    elif nome in ("ampliar", "reduzir"):
        p.setPen(_caneta(largura=3.6))
        p.drawEllipse(QRectF(8, 8, 24, 24))
        p.drawLine(QPointF(29, 29), QPointF(40, 40))
        p.drawLine(QPointF(14, 20), QPointF(26, 20))
        if nome == "ampliar":
            p.drawLine(QPointF(20, 14), QPointF(20, 26))
    elif nome == "largura":
        _pagina(p, dobra=False)
        p.setPen(_caneta(azul, 3))
        p.drawLine(QPointF(4, 24), QPointF(44, 24))
        _seta_ponta(p, QPointF(20, 24), QPointF(4, 24), 8)
        _seta_ponta(p, QPointF(28, 24), QPointF(44, 24), 8)
    elif nome == "selecionar":
        path = QPainterPath()
        path.moveTo(14, 6)
        path.lineTo(14, 38)
        path.lineTo(22, 30)
        path.lineTo(28, 42)
        path.lineTo(33, 40)
        path.lineTo(27, 28)
        path.lineTo(38, 28)
        path.closeSubpath()
        p.setPen(_caneta(largura=2.4))
        p.setBrush(_cor_fundo())
        p.drawPath(path)
    elif nome == "mao":
        p.setPen(_caneta(largura=2.6))
        p.setBrush(_cor_fundo())
        for i, (x, topo) in enumerate(((12, 16), (18, 9), (24, 7), (30, 10))):
            p.drawRoundedRect(QRectF(x, topo, 6, 24 - topo + 6), 3, 3)
        path = QPainterPath()
        path.addRoundedRect(QRectF(11, 24, 26, 18), 7, 7)
        p.drawPath(path)
        p.drawRoundedRect(QRectF(33, 20, 6, 12), 3, 3)
    elif nome == "adicionar_texto":
        _letra(p, "T", QRectF(2, 2, 34, 40), tamanho=34)
        p.setPen(_caneta(azul, 3.4))
        p.drawLine(QPointF(38, 26), QPointF(38, 44))
        p.drawLine(QPointF(29, 35), QPointF(47, 35))
    elif nome == "editar_texto":
        _letra(p, "T", QRectF(0, 2, 34, 40), tamanho=34)
        p.setPen(_caneta(azul, 3))
        p.drawLine(QPointF(38, 8), QPointF(38, 40))
        p.drawLine(QPointF(34, 8), QPointF(42, 8))
        p.drawLine(QPointF(34, 40), QPointF(42, 40))
    elif nome == "caixa_texto":
        p.setPen(_caneta(largura=2.6))
        pen = p.pen()
        pen.setStyle(Qt.PenStyle.DashLine)
        p.setPen(pen)
        p.drawRect(QRectF(5, 9, 38, 30))
        _letra(p, "T", QRectF(5, 9, 38, 30), tamanho=24)
    elif nome == "nota":
        p.setPen(_caneta(largura=2.6))
        p.setBrush(QColor(255, 220, 90))
        path = QPainterPath()
        path.moveTo(8, 8)
        path.lineTo(40, 8)
        path.lineTo(40, 30)
        path.lineTo(28, 42)
        path.lineTo(8, 42)
        path.closeSubpath()
        p.drawPath(path)
        p.drawLine(QPointF(14, 18), QPointF(34, 18))
        p.drawLine(QPointF(14, 25), QPointF(30, 25))
    elif nome == "destacar":
        p.fillRect(QRectF(4, 26, 40, 14), QColor(255, 225, 0))
        _letra(p, "ab", QRectF(0, 4, 48, 36), tamanho=26)
    elif nome == "sublinhar":
        _letra(p, "U", QRectF(0, 0, 48, 38), tamanho=30)
        p.setPen(_caneta(azul, 3.6))
        p.drawLine(QPointF(10, 42), QPointF(38, 42))
    elif nome == "tachar":
        _letra(p, "S", QRectF(0, 2, 48, 42), tamanho=32)
        p.setPen(_caneta(vermelho, 3.6))
        p.drawLine(QPointF(8, 24), QPointF(40, 24))
    elif nome == "caneta":
        p.setPen(_caneta(vermelho, 3.4))
        path = QPainterPath()
        path.moveTo(6, 34)
        path.cubicTo(14, 14, 18, 44, 26, 28)
        path.cubicTo(32, 16, 36, 34, 42, 22)
        p.drawPath(path)
        p.setPen(_caneta(largura=3))
        p.drawLine(QPointF(30, 6), QPointF(42, 18))
    elif nome == "retangulo":
        p.setPen(_caneta(vermelho, 3.4))
        p.drawRect(QRectF(7, 11, 34, 26))
    elif nome == "elipse":
        p.setPen(_caneta(vermelho, 3.4))
        p.drawEllipse(QRectF(5, 11, 38, 26))
    elif nome == "linha":
        p.setPen(_caneta(vermelho, 3.6))
        p.drawLine(QPointF(8, 40), QPointF(40, 8))
    elif nome == "seta":
        p.setPen(_caneta(vermelho, 3.6))
        p.drawLine(QPointF(8, 40), QPointF(36, 12))
        _seta_ponta(p, QPointF(8, 40), QPointF(40, 8), 13)
    elif nome == "imagem":
        p.setPen(_caneta(largura=2.6))
        p.setBrush(QColor(200, 225, 250))
        p.drawRect(QRectF(5, 9, 38, 30))
        p.setBrush(QColor(90, 160, 90))
        p.drawPolygon(QPolygonF([QPointF(8, 36), QPointF(20, 20),
                                 QPointF(28, 30), QPointF(33, 24),
                                 QPointF(40, 36)]))
        p.setBrush(QColor(250, 200, 50))
        p.drawEllipse(QRectF(31, 12, 7, 7))
    elif nome == "assinatura":
        p.setPen(_caneta(azul, 3))
        path = QPainterPath()
        path.moveTo(6, 30)
        path.cubicTo(10, 6, 18, 6, 16, 30)
        path.cubicTo(15, 38, 24, 16, 28, 28)
        path.cubicTo(30, 34, 36, 18, 42, 26)
        p.drawPath(path)
        p.setPen(_caneta(largura=2.4))
        p.drawLine(QPointF(4, 40), QPointF(44, 40))
    elif nome == "tarjar":
        _letra(p, "abc", QRectF(0, 0, 48, 20), tamanho=16, negrito=False)
        p.fillRect(QRectF(4, 22, 40, 12), QColor(10, 10, 10))
        _letra(p, "abc", QRectF(0, 34, 48, 14), tamanho=14, negrito=False)
    elif nome == "campo_texto":
        p.setPen(_caneta(largura=2.6))
        p.setBrush(QColor(255, 255, 255))
        p.drawRect(QRectF(4, 14, 40, 20))
        p.drawLine(QPointF(10, 19), QPointF(10, 29))
    elif nome == "caixa_selecao":
        p.setPen(_caneta(largura=2.6))
        p.setBrush(QColor(255, 255, 255))
        p.drawRect(QRectF(9, 9, 30, 30))
        p.setPen(_caneta(QColor(30, 150, 60), 4))
        p.drawPolyline(QPolygonF([QPointF(15, 24), QPointF(22, 32),
                                  QPointF(34, 15)]))
    elif nome == "app":
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(200, 30, 45))
        p.drawRoundedRect(QRectF(2, 2, 44, 44), 9, 9)
        p.setBrush(QColor(255, 255, 255))
        path = QPainterPath()
        path.moveTo(13, 8)
        path.lineTo(29, 8)
        path.lineTo(36, 15)
        path.lineTo(36, 40)
        path.lineTo(13, 40)
        path.closeSubpath()
        p.drawPath(path)
        p.setPen(_caneta(QColor(200, 30, 45), 3.2))
        p.drawLine(QPointF(18, 32), QPointF(31, 19))
        p.drawLine(QPointF(17, 35), QPointF(19, 31))
    else:
        _letra(p, nome[:1].upper(), QRectF(0, 0, 48, 48), cor=c)


def _pasta() -> QPainterPath:
    path = QPainterPath()
    path.moveTo(5, 14)
    path.lineTo(18, 14)
    path.lineTo(22, 18)
    path.lineTo(43, 18)
    path.lineTo(43, 40)
    path.lineTo(5, 40)
    path.closeSubpath()
    return path


_cache: dict[str, QIcon] = {}


def icone(nome: str) -> QIcon:
    if nome not in _cache:
        pix, p = _novo()
        try:
            _desenhar(nome, p)
        finally:
            p.end()
        _cache[nome] = QIcon(pix)
    return _cache[nome]


def pixmap(nome: str, tamanho: int = TAMANHO) -> QPixmap:
    return icone(nome).pixmap(tamanho, tamanho)

