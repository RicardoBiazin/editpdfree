"""PDF/A-2b (arquivamento de longo prazo) -- conversao PARCIAL e verificacao.

O que e' feito:
* remove JavaScript, arquivos anexados e acoes de abertura (proibidos);
* remove a criptografia (proibida);
* inclui o OutputIntent com o perfil de cor sRGB (obrigatorio);
* grava metadados XMP com `pdfaid:part=2`, `conformance=B`, coerentes com
  o dicionario Info (a norma exige que os dois batam);
* marca todas as anotacoes como imprimiveis e com aparencia.

O que NAO da' para garantir: fontes nao embutidas. As 14 fontes padrao
(Helvetica, Times...) sao usadas por referencia, sem o arquivo da fonte, e
PDF/A exige toda fonte embutida. `verificar()` lista essas pendencias em vez
de fingir que o arquivo ficou conforme -- a certificacao de verdade so' vem
de um validador (veraPDF).
"""

from __future__ import annotations

import datetime
import html

import pymupdf

from .documento import Documento

ID_SRGB = "sRGB IEC61966-2.1"


def _perfil_srgb() -> bytes:
    from PIL import ImageCms
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def _data_pdf(agora: datetime.datetime) -> str:
    deslocamento = agora.strftime("%z")
    return (agora.strftime("D:%Y%m%d%H%M%S")
            + (f"{deslocamento[:3]}'{deslocamento[3:]}'" if deslocamento else "Z"))


def _xmp(meta: dict, agora: datetime.datetime) -> str:
    e = lambda v: html.escape(v or "", quote=True)      # noqa: E731
    iso = agora.isoformat(timespec="seconds")
    return f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{e(meta.get("title"))}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>{e(meta.get("author"))}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{e(meta.get("subject"))}</rdf:li></rdf:Alt></dc:description>
   <pdf:Keywords>{e(meta.get("keywords"))}</pdf:Keywords>
   <pdf:Producer>{e(meta.get("producer"))}</pdf:Producer>
   <xmp:CreatorTool>{e(meta.get("creator"))}</xmp:CreatorTool>
   <xmp:CreateDate>{iso}</xmp:CreateDate>
   <xmp:ModifyDate>{iso}</xmp:ModifyDate>
   <xmp:MetadataDate>{iso}</xmp:MetadataDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def fontes_nao_embutidas(doc: pymupdf.Document) -> list[str]:
    nomes = set()
    for i in range(doc.page_count):
        for xref, ext, tipo, nome, *_ in doc.get_page_fonts(i, full=True):
            # ext vazio ou "n/a" = sem arquivo de fonte no PDF.
            if ext in ("", "n/a") and tipo != "Type3":
                nomes.add(nome.split("+")[-1])
    return sorted(nomes)


def verificar(doc: pymupdf.Document) -> list[str]:
    """Pendencias conhecidas para PDF/A-2b (lista vazia = nenhuma achada;
    NAO e' certificacao)."""
    pendencias = []
    if doc.is_encrypted or doc.needs_pass:
        pendencias.append("O documento é criptografado.")
    nao_embutidas = fontes_nao_embutidas(doc)
    if nao_embutidas:
        pendencias.append("Fontes não embutidas: " + ", ".join(nao_embutidas))
    catalogo = doc.pdf_catalog()
    if doc.xref_get_key(catalogo, "OutputIntents")[0] == "null":
        pendencias.append("Falta o perfil de cor (OutputIntent).")
    if "pdfaid:part" not in (doc.get_xml_metadata() or ""):
        pendencias.append("Faltam os metadados XMP de PDF/A.")
    for chave in ("Names/JavaScript", "OpenAction", "AA"):
        if doc.xref_get_key(catalogo, chave)[0] != "null":
            pendencias.append(f"Ação ou JavaScript no documento ({chave}).")
    if doc.embfile_count():
        pendencias.append("Há arquivos anexados.")
    return pendencias


def para_pdfa(d: Documento) -> list[str]:
    """Aplica o que da' para corrigir. Devolve as pendencias que restaram."""
    with d.operacao("Converter para PDF/A"):
        doc = d.doc
        doc.scrub(attached_files=True, clean_pages=False, embedded_files=True,
                  hidden_text=False, javascript=True, metadata=False,
                  redactions=False, redact_images=0, remove_links=False,
                  reset_fields=False, reset_responses=False, thumbnails=False,
                  xml_metadata=True)
        catalogo = doc.pdf_catalog()
        for chave in ("OpenAction", "AA"):
            doc.xref_set_key(catalogo, chave, "null")
        # Perfil de cor
        icc = _perfil_srgb()
        xref_icc = doc.get_new_xref()
        doc.update_object(xref_icc, "<< /N 3 >>")
        doc.update_stream(xref_icc, icc, compress=True)
        xref_intent = doc.get_new_xref()
        doc.update_object(
            xref_intent,
            f"<< /Type /OutputIntent /S /GTS_PDFA1 "
            f"/OutputConditionIdentifier ({ID_SRGB}) /Info ({ID_SRGB}) "
            f"/DestOutputProfile {xref_icc} 0 R >>")
        doc.xref_set_key(catalogo, "OutputIntents", f"[{xref_intent} 0 R]")
        # Anotacoes: imprimiveis, nao ocultas (PDF/A exige o flag Print).
        for pagina in doc:
            for a in pagina.annots() or []:
                a.set_flags((a.flags | pymupdf.PDF_ANNOT_IS_PRINT)
                            & ~pymupdf.PDF_ANNOT_IS_HIDDEN
                            & ~pymupdf.PDF_ANNOT_IS_INVISIBLE)
                a.update()
        # Metadados: Info e XMP com os MESMOS valores e datas.
        agora = datetime.datetime.now().astimezone().replace(microsecond=0)
        meta = {k: v for k, v in (doc.metadata or {}).items()
                if k in ("title", "author", "subject", "keywords", "creator",
                         "producer")}
        meta["producer"] = meta.get("producer") or "EditPDFree"
        meta["creator"] = meta.get("creator") or "EditPDFree"
        data = _data_pdf(agora)
        doc.set_metadata({**meta, "creationDate": data, "modDate": data})
        doc.set_xml_metadata(_xmp(meta, agora))
    # A criptografia sai ao salvar.
    from . import seguranca
    if d.protegido:
        seguranca.remover_protecao(d)
    return verificar(d.doc)
