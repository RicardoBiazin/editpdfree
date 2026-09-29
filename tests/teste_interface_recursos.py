"""Recursos da 0.2 pela janela: carimbo, link, recortar, marcadores,
assinatura digital, abrir DOCX, imprimir e comparar."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, drenar_eventos, paginas_numeradas,
                       pasta_temporaria, pdf_texto, preparar_qt, pular,
                       resumir, secao, texto_da_pagina)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

import pymupdf
from PySide6.QtWidgets import QApplication

from editpdfree import assinatura_digital, marcadores
from editpdfree.interface import aba as modulo_aba
from editpdfree.interface import config
from editpdfree.interface.ferramentas import Ferramenta
from editpdfree.interface.janela_principal import JanelaPrincipal

sys.path.insert(0, __file__.rsplit("\\", 1)[0])
from teste_assinatura import certificado_teste            # noqa: E402
from teste_interface import (arrastar, cena_de_pdf, clicar,  # noqa: E402
                             encerrar, nova_janela)

modulo_aba.avisar = lambda *a, **k: print("         (aviso) " + str(a[2:]))
modulo_aba.confirmar = lambda *a, **k: False       # "nao" por padrao


def ferramentas_novas(pasta) -> None:
    secao("carimbo, link e recortar")
    arquivo = pasta / "f.pdf"
    arquivo.write_bytes(paginas_numeradas(3))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    v, d = aba.visualizador, aba.documento

    modulo_aba.pedir_carimbo = lambda _p: ("APROVADO", "29/09/2026")
    j.definir_ferramenta(Ferramenta.CARIMBO)
    clicar(v, cena_de_pdf(v, 0, 300, 400))
    p = d.doc[0]
    a = p.first_annot
    checa(a is not None and a.type[1] == "Stamp", "clique com Carimbo carimba")

    modulo_aba.pedir_link = lambda _p, _t: {"destino": 2}
    j.definir_ferramenta(Ferramenta.LINK)
    arrastar(v, cena_de_pdf(v, 0, 70, 85), cena_de_pdf(v, 0, 200, 105))
    ls = marcadores.links(d, 0)
    checa_igual([l.destino_pagina for l in ls], [2], "link para a pagina 3")
    j.definir_ferramenta(Ferramenta.SELECIONAR)
    v.ir_para_pagina(0)
    clicar(v, cena_de_pdf(v, 0, 100, 95))
    checa_igual(v.pagina_atual, 2, "clicar no link vai para a pagina")

    aberto = []
    modulo_aba.abrir_url = lambda _p, url: aberto.append(url)
    modulo_aba.pedir_link = lambda _p, _t: {"url": "exemplo.com"}
    j.definir_ferramenta(Ferramenta.LINK)
    arrastar(v, cena_de_pdf(v, 1, 70, 85), cena_de_pdf(v, 1, 200, 105))
    j.definir_ferramenta(Ferramenta.SELECIONAR)
    clicar(v, cena_de_pdf(v, 1, 100, 95))
    checa_igual(aberto, ["https://exemplo.com"],
                "link externo passa pela confirmacao (nao abre direto)")

    j.definir_ferramenta(Ferramenta.RECORTAR)
    arrastar(v, cena_de_pdf(v, 2, 50, 50), cena_de_pdf(v, 2, 350, 500))
    r = d.doc[2].rect
    checa(abs(r.width - 300) < 2 and abs(r.height - 450) < 2,
          f"recortar pelo arraste, so' a pagina ({r.width:.1f} x "
          f"{r.height:.1f})")
    checa_igual(round(d.doc[0].rect.width), 595, "outras paginas intactas")
    encerrar(j)


def painel_marcadores(pasta) -> None:
    secao("painel de marcadores")
    arquivo = pasta / "m.pdf"
    arquivo.write_bytes(paginas_numeradas(4))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    nomes = iter(["Introdução", "Conclusão"])
    modulo_aba.pedir_texto = lambda *a, **k: next(nomes)
    aba.visualizador.ir_para_pagina(0)
    aba._acao_marcador("adicionar", -1)
    aba.visualizador.ir_para_pagina(3)
    aba._acao_marcador("adicionar", -1)
    drenar_eventos()
    checa_igual(aba.marcadores.arvore.topLevelItemCount(), 2,
                "dois marcadores no painel")
    item = aba.marcadores.arvore.topLevelItem(1)
    checa_igual(item.text(0), "Conclusão", "titulo no painel")
    aba.marcadores._clicou(aba.marcadores.arvore.topLevelItem(0), 0)
    checa_igual(aba.visualizador.pagina_atual, 0, "clicar navega")
    aba.marcadores.arvore.setCurrentItem(item)
    aba._acao_marcador("avancar", aba.marcadores.indice_atual())
    drenar_eventos()
    checa_igual(aba.marcadores.arvore.topLevelItem(0).childCount(), 1,
                "descer nivel vira filho do anterior")
    aba.documento.desfazer()
    drenar_eventos()
    checa_igual(aba.marcadores.arvore.topLevelItemCount(), 2,
                "desfazer atualiza o painel")
    encerrar(j)


def assinatura(pasta) -> None:
    secao("assinatura digital pela janela")
    pfx, _cert = certificado_teste()
    arquivo_pfx = pasta / "cert.pfx"
    arquivo_pfx.write_bytes(pfx)
    arquivo = pasta / "contrato.pdf"
    arquivo.write_bytes(pdf_texto([["Contrato"]]))
    j = nova_janela()
    aba = j.abrir(arquivo)
    drenar_eventos()
    v = aba.visualizador
    modulo_aba.pedir_certificado = lambda *a: {
        "pfx": pfx, "senha": "1234", "motivo": "Concordo", "local": "SC",
        "arquivo": str(arquivo_pfx)}
    destino = pasta / "contrato_assinado.pdf"
    modulo_aba.pedir_destino = lambda *a, **k: str(destino)
    j.definir_ferramenta(Ferramenta.ASSINAR_CERTIFICADO)
    arrastar(v, cena_de_pdf(v, 0, 72, 600), cena_de_pdf(v, 0, 300, 680))
    checa(destino.is_file(), "arquivo assinado gravado")
    lista = assinatura_digital.verificar(destino.read_bytes())
    checa(len(lista) == 1 and lista[0].integra, "assinatura integra")
    checa_igual(j.abas.count(), 2, "o assinado abre numa aba nova")
    checa_igual(j.cfg["ultimo_certificado"], str(arquivo_pfx),
                "lembra o caminho do certificado (nao a senha)")
    checa("1234" not in str(dict(j.cfg)), "a senha nao vai para a config")
    checa(j.ferramenta is Ferramenta.SELECIONAR,
          "volta para Selecionar depois de assinar")
    aba2 = j._aba()
    checa(aba2.documento.assinado, "a aba nova sabe que o PDF e' assinado")
    # Documento modificado: recusa assinar sem salvar (confirmar = False).
    j.abas.setCurrentIndex(0)
    aba.documento.modificado = True
    antes = destino.stat().st_mtime_ns
    j.assinar_certificado(aba, 0, None)
    checa_igual(destino.stat().st_mtime_ns, antes,
                "com alteracoes pendentes e 'nao' para salvar, nao assina")
    encerrar(j)


def abrir_docx_imprimir(pasta) -> None:
    secao("abrir DOCX e imprimir")
    import docx
    w = docx.Document()
    w.add_paragraph("Documento do Word com ação")
    arquivo = pasta / "carta.docx"
    w.save(arquivo)
    j = nova_janela()
    aba = j.abrir(arquivo)
    checa(aba is not None, "abre DOCX direto")
    checa_igual(aba.documento.nome, "carta.pdf", "nome sugerido .pdf")
    checa(aba.documento.caminho is None, "sem caminho: salvar pede o destino")
    checa("ação" in texto_da_pagina(aba.documento, 0), "texto convertido")

    from PySide6.QtPrintSupport import QPrinter
    from editpdfree.interface.impressao import imprimir_em
    (pasta / "tres.pdf").write_bytes(pdf_texto([["A"], ["B"]],
                                               largura=842, altura=595))
    aba3 = j.abrir(pasta / "tres.pdf")
    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
    printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
    saida = pasta / "impresso.pdf"
    printer.setOutputFileName(str(saida))
    n = imprimir_em(printer, aba3.documento, [0, 1])
    checa_igual(n, 2, "duas paginas impressas")
    with pymupdf.open(saida) as impresso:
        checa_igual(impresso.page_count, 2, "o 'papel' tem duas folhas")
        checa(impresso[0].rect.height > impresso[0].rect.width,
              "papel em pe'")
        info = impresso[0].get_image_info()
        caixa = pymupdf.Rect(info[0]["bbox"]) if info else pymupdf.Rect()
        checa(caixa.height > caixa.width,
              "pagina deitada girada para ocupar o papel em pe'")
    encerrar(j)


def comparacao(pasta) -> None:
    secao("janela de comparacao")
    a = pasta / "v1.pdf"
    b = pasta / "v2.pdf"
    a.write_bytes(pdf_texto([["O prazo é de trinta dias"]]))
    b.write_bytes(pdf_texto([["O prazo é de sessenta dias"]]))
    from editpdfree.interface.comparacao import JanelaComparacao
    janela = JanelaComparacao(str(a), str(b))
    janela.show()
    drenar_eventos()
    checa_igual(janela.lista.count(), 1, "uma diferenca listada")
    checa("trinta → sessenta" in janela.lista.item(0).text(),
          "texto da diferenca")
    janela.lista.setCurrentRow(0)
    drenar_eventos()
    p = janela.doc_b.doc[0]
    checa_igual([x.type[1] for x in p.annots()], ["Highlight"],
                "destaque na versao nova")
    janela.close()
    drenar_eventos()
    checa(a.read_bytes()[:4] == b"%PDF", "arquivos originais intactos")


def main() -> int:
    with pasta_temporaria() as pasta:
        ferramentas_novas(pasta)
        painel_marcadores(pasta)
        assinatura(pasta)
        abrir_docx_imprimir(pasta)
        comparacao(pasta)
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
