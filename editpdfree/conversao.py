"""Converter de e para PDF.

**Para PDF:** imagens, texto, HTML, EPUB, XPS e Office (DOCX, XLSX, PPTX) sao
abertos pelo proprio MuPDF, que os diagrama e converte -- sem Word nem
LibreOffice. A fidelidade do Office e' a de um leitor, nao a do Word: tabelas
complexas e fontes especificas podem mudar. Se o LibreOffice estiver instalado,
ele e' usado para os formatos Office, com resultado melhor.

**PDF para Word:** reconstrucao aproximada, bloco a bloco: paragrafos com
fonte, tamanho, negrito/italico e cor; imagens na ordem em que aparecem;
quebra de pagina entre paginas. Nao reconstroi tabelas nem colunas -- e' o
limite honesto de qualquer conversor PDF->Word.
"""

from __future__ import annotations

import io
import os
import pathlib
import shutil
import subprocess
import tempfile

import pymupdf

from .documento import Documento

EXT_IMAGEM = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff",
              ".webp", ".jxr", ".pnm", ".pam")
EXT_OFFICE = (".docx", ".xlsx", ".pptx")
EXT_OUTROS = (".txt", ".html", ".htm", ".xhtml", ".epub", ".xps", ".oxps",
              ".fb2", ".cbz", ".mobi", ".svg")
EXT_ACEITAS = EXT_IMAGEM + EXT_OFFICE + EXT_OUTROS

FILTRO = ("Documentos (*.docx *.xlsx *.pptx *.txt *.html *.htm *.epub *.xps "
          "*.png *.jpg *.jpeg *.bmp *.gif *.tif *.tiff *.webp *.svg);;"
          "Todos os arquivos (*)")


def libreoffice() -> str | None:
    for candidato in (shutil.which("soffice"),
                      r"C:\Program Files\LibreOffice\program\soffice.exe",
                      r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
        if candidato and os.path.isfile(candidato):
            return candidato
    return None


def _via_libreoffice(caminho: pathlib.Path, soffice: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="epf_lo_") as pasta:
        # Lista de argumentos, sem shell: o nome do arquivo e' dado do usuario.
        subprocess.run([soffice, "--headless", "--norestore",
                        "--convert-to", "pdf", "--outdir", pasta,
                        str(caminho)], check=True, timeout=180,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        saida = pathlib.Path(pasta) / (caminho.stem + ".pdf")
        if not saida.is_file():
            raise RuntimeError("O LibreOffice não gerou o PDF.")
        return saida.read_bytes()


def para_pdf(caminho: str | os.PathLike, *,
             usar_libreoffice: bool = True) -> bytes:
    """Bytes de um PDF a partir de qualquer formato aceito."""
    caminho = pathlib.Path(caminho)
    ext = caminho.suffix.lower()
    if ext == ".pdf":
        return caminho.read_bytes()
    if ext not in EXT_ACEITAS:
        raise ValueError(f"Formato não suportado: {ext or caminho.name}")
    if ext in EXT_OFFICE and usar_libreoffice:
        soffice = libreoffice()
        if soffice:
            try:
                return _via_libreoffice(caminho, soffice)
            except (OSError, subprocess.SubprocessError, RuntimeError):
                pass                        # cai no MuPDF
    with pymupdf.open(caminho) as origem:
        if origem.is_pdf:
            return origem.tobytes()
        return origem.convert_to_pdf()


def varios_para_pdf(caminhos, destino: str | os.PathLike) -> pathlib.Path:
    """Converte e junta, na ordem, num PDF so'."""
    novo = pymupdf.open()
    try:
        for c in caminhos:
            with pymupdf.open("pdf", para_pdf(c)) as parte:
                novo.insert_pdf(parte)
        destino = pathlib.Path(destino)
        novo.save(destino, garbage=3, deflate=True)
    finally:
        novo.close()
    return destino


# -- PDF -> Word ------------------------------------------------------------
def _rgb(cor: int) -> tuple[int, int, int]:
    return (cor >> 16) & 255, (cor >> 8) & 255, cor & 255


def para_word(d: Documento, destino: str | os.PathLike,
              progresso=None) -> pathlib.Path:
    from docx import Document as Docx
    from docx.enum.text import WD_BREAK
    from docx.shared import Pt, RGBColor

    saida = Docx()
    secao = saida.sections[0]
    primeira = d.doc[0].rect
    secao.page_width = Pt(primeira.width)
    secao.page_height = Pt(primeira.height)
    for margem in ("left_margin", "right_margin", "top_margin",
                   "bottom_margin"):
        setattr(secao, margem, Pt(40))
    largura_util = primeira.width - 80
    estilo = saida.styles["Normal"]
    estilo.paragraph_format.space_after = Pt(2)

    for i in range(d.paginas):
        if progresso is not None and progresso(i, d.paginas) is False:
            break
        p = d.doc[i]
        dados = p.get_text("dict", sort=True)
        for bloco in dados["blocks"]:
            if bloco["type"] == 1:                     # imagem
                try:
                    largura = min(largura_util,
                                  bloco["bbox"][2] - bloco["bbox"][0])
                    saida.add_picture(io.BytesIO(bloco["image"]),
                                      width=Pt(max(20, largura)))
                except Exception:                      # noqa: BLE001
                    pass           # formato de imagem que o Word nao le
                continue
            paragrafo = saida.add_paragraph()
            linhas = bloco.get("lines", [])
            for n, linha in enumerate(linhas):
                for span in linha["spans"]:
                    texto = span["text"]
                    if not texto:
                        continue
                    run = paragrafo.add_run(texto)
                    run.font.size = Pt(round(span["size"] * 2) / 2)
                    fonte = span["font"].split("+")[-1]
                    run.font.name = fonte.split("-")[0] or None
                    flags = span["flags"]
                    run.bold = bool(flags & 16) or "bold" in fonte.lower()
                    run.italic = bool(flags & 2) or "italic" in fonte.lower()
                    r, g, b = _rgb(span["color"])
                    if (r, g, b) != (0, 0, 0):
                        run.font.color.rgb = RGBColor(r, g, b)
                if n < len(linhas) - 1:
                    # Linha que termina com hifen de separacao continua colada.
                    ultimo = linha["spans"][-1]["text"] if linha["spans"] else ""
                    if not ultimo.endswith("-"):
                        paragrafo.add_run(" ")
        if i < d.paginas - 1:
            saida.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    destino = pathlib.Path(destino)
    saida.save(destino)
    return destino
