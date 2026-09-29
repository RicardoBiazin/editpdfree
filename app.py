"""EditPDFree -- ponto de entrada.

    python app.py [arquivo.pdf ...]
    python app.py --autoverificacao     (usado pelo build.bat no .exe gerado)
"""

from __future__ import annotations

import os
import sys
import tempfile
import traceback


def exigir(condicao: object, mensagem: str) -> None:
    # `assert` nao serve aqui: o .spec empacota com optimize=1, que os remove.
    if not condicao:
        raise RuntimeError(mensagem)


def autoverificacao() -> int:
    """Exercita o pacote de ponta a ponta sem janela visivel.

    Existe para o .exe: um modulo cortado pelos `excludes` do .spec so'
    quebra em tempo de execucao, e este e' o ultimo lugar onde da' para
    descobrir isso antes de o usuario."""
    os.environ["QT_QPA_PLATFORM"] = "offscreen"
    os.environ["APPDATA"] = tempfile.mkdtemp(prefix="epf_auto_")
    try:
        import pymupdf
        from PySide6.QtWidgets import QApplication

        from editpdfree import (anotacoes, extras, formularios, idioma,
                                seguranca, texto)
        from editpdfree.documento import Documento
        from editpdfree.interface.janela_principal import JanelaPrincipal

        app = QApplication.instance() or QApplication(sys.argv)
        idioma.instalar(app)
        pasta = tempfile.mkdtemp(prefix="epf_auto_")
        arquivo = os.path.join(pasta, "teste.pdf")
        doc = pymupdf.open()
        p = doc.new_page()
        p.insert_text((72, 72), "Texto original do teste", fontsize=12)
        p.insert_text((72, 120), "CPF 123.456.789-00", fontsize=12)
        doc.save(arquivo)
        doc.close()

        janela = JanelaPrincipal()
        aba = janela.abrir(arquivo)
        exigir(aba is not None, "abrir falhou")
        app.processEvents()
        d = aba.documento
        t = texto.trecho_em(d, 0, pymupdf.Point(80, 68))
        exigir(t is not None, "trecho nao encontrado")
        texto.substituir_trecho(d, t, "Texto editado com acentuação")
        anotacoes.marcar_texto(d, 0, pymupdf.Rect(70, 55, 300, 80),
                               "destacar", anotacoes.Estilo())
        seguranca.tarjar_texto(d, "123.456.789-00")
        extras.numerar(d)
        formularios.criar_campo_texto(d, 0, pymupdf.Rect(72, 200, 250, 220),
                                      "nome")
        aba.visualizador._renderizar_visiveis()
        exigir(aba.visualizador.paginas_renderizadas() >= 1, "sem render")
        exigir(janela.salvar(aba), "salvar falhou")
        with pymupdf.open(arquivo) as conferir:
            conteudo = conferir[0].get_text()
        exigir("Texto editado com acentuação" in conteudo, conteudo)
        exigir("123.456.789-00" not in conteudo, "tarja nao removeu")
        janela.close()
        return 0
    except Exception:                               # noqa: BLE001
        traceback.print_exc()
        try:
            with open(os.path.join(tempfile.gettempdir(),
                                   "editpdfree_autoverificacao.log"), "w",
                      encoding="utf-8") as log:
                traceback.print_exc(file=log)
        except OSError:
            pass
        return 1


def main() -> int:
    if "--autoverificacao" in sys.argv:
        return autoverificacao()
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication

    from editpdfree import NOME, idioma
    from editpdfree.interface.janela_principal import JanelaPrincipal

    app = QApplication(sys.argv)
    app.setApplicationName(NOME)
    app.setOrganizationName(NOME)
    app.setStyle("Fusion")
    icone = os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(
        os.path.abspath(__file__))), "editpdfree", "recursos", "icone.ico")
    if os.path.isfile(icone):
        app.setWindowIcon(QIcon(icone))
    idioma.instalar(app)
    janela = JanelaPrincipal()
    janela.show()
    arquivos = [a for a in sys.argv[1:] if not a.startswith("--")]
    for arquivo in arquivos:
        janela.abrir(arquivo)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
