"""Recursos da 0.3 pela janela (dialogos trocados por respostas prontas)."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, drenar_eventos, pasta_temporaria,
                       pdf_texto, preparar_qt, pular, resumir, secao,
                       texto_da_pagina)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

import pymupdf

from editpdfree import formularios
from editpdfree.interface import aba as modulo_aba

sys.path.insert(0, __file__.rsplit("\\", 1)[0])
from teste_ferramentas_03 import pdf_com_tabela            # noqa: E402
from teste_interface import encerrar, nova_janela         # noqa: E402

modulo_aba.avisar = lambda *a, **k: print("         (aviso) " + str(a[2:]))
modulo_aba.confirmar = lambda *a, **k: True


def main() -> int:
    with pasta_temporaria() as pasta:
        secao("converter pela janela")
        origem = pasta / "vendas.pdf"
        origem.write_bytes(pdf_com_tabela())
        j = nova_janela()
        aba = j.abrir(origem)
        drenar_eventos()
        destinos = iter([str(pasta / "v.xlsx"), str(pasta / "v.pptx"),
                         str(pasta / "v.md")])
        modulo_aba.pedir_destino = lambda *a, **k: next(destinos)
        j.pdf_para_xlsx()
        j.pdf_para_pptx()
        j.pdf_para_md()
        checa(all((pasta / n).is_file() for n in ("v.xlsx", "v.pptx", "v.md")),
              "Excel, PowerPoint e Markdown gravados")
        modulo_aba.pedir_pasta = lambda *a, **k: str(pasta / "imgs")
        j.extrair_imagens()
        checa((pasta / "imgs").is_dir(), "extrair imagens cria a pasta")

        secao("PDF/A")
        from PySide6.QtWidgets import QMessageBox
        mensagens = []
        QMessageBox.information = staticmethod(
            lambda _p, _t, texto, *a, **k: mensagens.append(texto))
        j.converter_pdfa()
        checa(mensagens and "Fontes não embutidas" in mensagens[0],
              "o aviso lista as pendencias (nao finge PDF/A valido)")
        checa("pdfaid" in (aba.documento.doc.get_xml_metadata() or ""),
              "XMP de PDF/A aplicado")
        checa(aba.documento.modificado, "documento marcado como modificado")

        secao("detectar campos")
        doc = pymupdf.open()
        p = doc.new_page()
        p.insert_text((72, 100), "Nome: ____________________", fontsize=12)
        p.draw_rect(pymupdf.Rect(72, 130, 84, 142))
        p.insert_text((90, 140), "Concordo", fontsize=12)
        form = pasta / "form.pdf"
        form.write_bytes(doc.tobytes())
        aba2 = j.abrir(form)
        drenar_eventos()
        vistas = []

        def escolher(_p, sugestoes):
            vistas.extend(sugestoes)
            return [s for s in sugestoes if s.tipo == "texto"]
        modulo_aba.pedir_campos = escolher
        j.detectar_campos()
        checa_igual(len(vistas), 2, "duas sugestoes mostradas ao usuario")
        checa_igual([c.nome for c in formularios.campos(aba2.documento)],
                    ["nome"], "so' o campo escolhido foi criado")

        secao("digitalizar (scanner simulado)")
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 850, 1100), False)
        pix.clear_with(230)
        pix.set_dpi(100, 100)
        paginas_scan = iter([pix.tobytes("jpg"), pix.tobytes("jpg"), None])
        modulo_aba.adquirir_digitalizacao = lambda: next(paginas_scan)
        antes = j.abas.count()
        j.digitalizar()
        checa_igual(j.abas.count(), antes + 1, "documento digitalizado em aba nova")
        d = j._aba().documento
        checa_igual(d.paginas, 2, "duas paginas digitalizadas")
        checa(d.modificado and d.caminho is None,
              "ainda nao salvo (pede destino ao salvar)")
        checa(abs(d.doc[0].rect.width - 612) < 1, "8,5 pol a 100 dpi = 612 pt")
        modulo_aba.adquirir_digitalizacao = lambda: None
        antes = j.abas.count()
        j.digitalizar()
        checa_igual(j.abas.count(), antes, "cancelar nao cria aba")

        secao("reparar pela janela")
        bom = pdf_texto([["Um"], ["Dois"]])
        quebrado = pasta / "quebrado.pdf"
        quebrado.write_bytes(bom[:bom.rfind(b"xref")] + b"%%EOF")
        modulo_aba.pedir_arquivo = lambda *a, **k: str(quebrado)
        modulo_aba.pedir_destino = lambda *a, **k: str(pasta / "ok.pdf")
        j.reparar_pdf()
        checa((pasta / "ok.pdf").is_file(), "reparado gravado")
        checa_igual(texto_da_pagina(j._aba().documento, 1).strip(), "Dois",
                    "reparado aberto com o conteudo")
        encerrar(j)
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
