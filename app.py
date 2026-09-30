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


def _certificado_teste() -> bytes:
    """Certificado autoassinado so' para a autoverificacao."""
    import datetime
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Teste")])
    agora = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome)
            .public_key(chave.public_key()).serial_number(1)
            .not_valid_before(agora - datetime.timedelta(days=1))
            .not_valid_after(agora + datetime.timedelta(days=1))
            .sign(chave, hashes.SHA256()))
    return pkcs12.serialize_key_and_certificates(
        b"t", chave, cert, None,
        serialization.BestAvailableEncryption(b"1234"))


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

        # Recursos da 0.2: cada um puxa modulos e arquivos de dados que o
        # PyInstaller pode deixar de fora sem erro no build.
        from editpdfree import assinatura_digital, conversao, ocr
        from editpdfree.interface.impressao import imprimir_em
        from PySide6.QtPrintSupport import QPrinter
        escaneado = pymupdf.open()
        pagina = escaneado.new_page()
        fonte = pymupdf.open()
        fp = fonte.new_page()
        fp.insert_text((72, 120), "Reconhecimento de texto", fontsize=18)
        pagina.insert_image(pagina.rect, pixmap=fp.get_pixmap(dpi=200))
        d_ocr = Documento(dados=escaneado.tobytes())
        exigir(ocr.reconhecer(d_ocr, idioma="por") == 1, "ocr nao rodou")
        exigir("texto" in d_ocr.doc[0].get_text(), "ocr sem texto")

        import docx
        w = docx.Document()
        w.add_paragraph("Conversao de Word")
        arquivo_docx = os.path.join(pasta, "t.docx")
        w.save(arquivo_docx)
        with pymupdf.open("pdf", conversao.para_pdf(
                arquivo_docx, usar_libreoffice=False)) as convertido:
            exigir("Conversao" in convertido[0].get_text(), "docx")
        conversao.para_word(d, os.path.join(pasta, "saida.docx"))

        pfx = _certificado_teste()
        with open(arquivo, "rb") as f:
            assinado = assinatura_digital.assinar(
                f.read(), pfx, "1234", rect=pymupdf.Rect(72, 600, 300, 680))
        verif = assinatura_digital.verificar(assinado)
        exigir(verif and verif[0].integra, "assinatura digital")
        exigir(len(assinatura_digital.raizes_icp_brasil()) >= 4, "raizes ICP")

        # 0.3: PowerPoint, Excel, Markdown, PDF/A (Pillow/ImageCms), reparar.
        from editpdfree import conversao_saida, pdfa, reparar
        conversao_saida.para_powerpoint(d, os.path.join(pasta, "s.pptx"),
                                        dpi=40)
        conversao_saida.para_excel(d, os.path.join(pasta, "s.xlsx"))
        exigir("acentua" in conversao_saida.para_markdown(d), "markdown")
        d_pdfa = Documento(dados=d.doc.tobytes())
        pdfa.para_pdfa(d_pdfa)
        exigir("pdfaid" in d_pdfa.doc.get_xml_metadata(), "pdf/a")
        with open(arquivo, "rb") as f:
            _dados, rel = reparar.reparar(f.read())
        exigir(rel.paginas == 1, "reparar")
        import comtypes          # noqa: F401  (scanner: so' importar)

        printer = QPrinter(QPrinter.PrinterMode.HighResolution)
        printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
        printer.setOutputFileName(os.path.join(pasta, "impresso.pdf"))
        exigir(imprimir_em(printer, d, [0]) == 1, "impressao")
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
