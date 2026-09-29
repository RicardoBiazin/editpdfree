"""Imprimir: cada pagina renderizada na resolucao da impressora (ate' 300
dpi), ajustada a area imprimivel sem distorcer.

Pagina deitada em papel em pe' (ou o contrario) e' girada 90 graus para
ocupar o papel -- e' o que o "ajustar" de qualquer leitor faz, e o contrario
imprime um retangulo pequeno no meio da folha.
"""

from __future__ import annotations

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QImage, QPainter, QTransform
from PySide6.QtPrintSupport import QPrinter

from ..documento import Documento

DPI_MAXIMO = 300


def imprimir_em(printer: QPrinter, documento: Documento,
                paginas: list[int], progresso=None) -> int:
    """Desenha `paginas` no `printer`. Devolve quantas foram impressas."""
    pintor = QPainter()
    if not pintor.begin(printer):
        raise RuntimeError("Não foi possível iniciar a impressão.")
    feitas = 0
    try:
        dpi = min(DPI_MAXIMO, printer.resolution())
        for n, i in enumerate(paginas):
            if progresso is not None and progresso(n, len(paginas)) is False:
                break
            if n:
                printer.newPage()
            p = documento.doc[i]
            area = QRectF(printer.pageLayout().paintRectPixels(
                printer.resolution()))
            area.moveTo(0, 0)
            pagina_deitada = p.rect.width > p.rect.height
            papel_deitado = area.width() > area.height()
            girar = pagina_deitada != papel_deitado
            pix = p.get_pixmap(dpi=dpi, alpha=False, annots=True)
            amostras = pix.samples            # vivo ate' o copy(): ver visualizador
            imagem = QImage(amostras, pix.width, pix.height, pix.stride,
                            QImage.Format.Format_RGB888).copy()
            if girar:
                imagem = imagem.transformed(QTransform().rotate(90))
            escala = min(area.width() / imagem.width(),
                         area.height() / imagem.height())
            w, h = imagem.width() * escala, imagem.height() * escala
            destino = QRectF((area.width() - w) / 2, (area.height() - h) / 2,
                             w, h)
            pintor.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
            pintor.drawImage(destino, imagem)
            feitas += 1
    finally:
        pintor.end()
    return feitas


def imprimir(parent, documento: Documento, pagina_atual: int = 0) -> int:
    from PySide6.QtPrintSupport import QAbstractPrintDialog, QPrintDialog
    from PySide6.QtWidgets import QApplication, QProgressDialog

    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
    printer.setDocName(documento.nome)
    printer.setFromTo(1, documento.paginas)
    dialogo = QPrintDialog(printer, parent)
    dialogo.setWindowTitle("Imprimir")
    dialogo.setMinMax(1, documento.paginas)
    dialogo.setOption(QAbstractPrintDialog.PrintDialogOption.PrintCurrentPage,
                      True)
    dialogo.setOption(QAbstractPrintDialog.PrintDialogOption.PrintPageRange,
                      True)
    if dialogo.exec() != QPrintDialog.DialogCode.Accepted:
        return 0
    modo = printer.printRange()
    if modo == QPrinter.PrintRange.CurrentPage:
        paginas = [pagina_atual]
    elif modo == QPrinter.PrintRange.PageRange:
        paginas = list(range(printer.fromPage() - 1, printer.toPage()))
    else:
        paginas = list(range(documento.paginas))
    barra = QProgressDialog("Imprimindo…", "Cancelar", 0, len(paginas), parent)
    barra.setWindowModality(Qt.WindowModality.WindowModal)
    barra.setMinimumDuration(400)

    def andamento(n: int, total: int) -> bool:
        barra.setValue(n)
        QApplication.processEvents()
        return not barra.wasCanceled()

    try:
        return imprimir_em(printer, documento, paginas, andamento)
    finally:
        barra.close()

