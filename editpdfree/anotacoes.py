"""Anotacoes e elementos desenhados por cima da pagina.

Toda coordenada que entra aqui ja' esta' no **espaco PDF** (sem rotacao) -- a
conversao da tela e' trabalho de `coordenadas.py`, e so' dele.

Anotacao (destaque, nota, forma, caneta) continua editavel em outro leitor.
Imagem e assinatura entram no **conteudo** da pagina: e' o que se espera de uma
assinatura, que nao deve sair com um clique em "excluir anotacao".
"""

from __future__ import annotations

import dataclasses
import os
import re
from typing import Sequence

import pymupdf

from .documento import Documento

Cor = tuple[float, float, float]


@dataclasses.dataclass
class Estilo:
    cor: Cor = (0.85, 0.1, 0.1)
    espessura: float = 2.0
    opacidade: float = 1.0
    tamanho_fonte: float = 12.0
    preenchimento: Cor | None = None


def _finalizar(anotacao: pymupdf.Annot, estilo: Estilo, *,
               com_borda: bool = True, preencher: bool = False) -> None:
    if com_borda:
        anotacao.set_border(width=estilo.espessura)
    cores = {"stroke": estilo.cor}
    if preencher and estilo.preenchimento is not None:
        cores["fill"] = estilo.preenchimento
    anotacao.set_colors(**cores)
    anotacao.set_opacity(estilo.opacidade)
    anotacao.update()


def texto_livre(d: Documento, pagina: int, rect: pymupdf.Rect, texto: str,
                estilo: Estilo) -> None:
    with d.operacao("Inserir texto"):
        p = d.doc[pagina]
        rect = pymupdf.Rect(rect)
        # Caixa pequena demais corta o texto sem aviso: garante ao menos uma
        # linha na fonte escolhida.
        minimo = estilo.tamanho_fonte * 1.6
        if rect.height < minimo:
            rect.y1 = rect.y0 + minimo * max(1, texto.count("\n") + 1)
        if rect.width < 20:
            largura = max(len(l) for l in texto.splitlines() or [""])
            rect.x1 = rect.x0 + max(40, largura * estilo.tamanho_fonte * 0.55)
        a = p.add_freetext_annot(
            rect, texto, fontsize=estilo.tamanho_fonte, fontname="helv",
            text_color=estilo.cor, fill_color=estilo.preenchimento,
            rotate=p.rotation, opacity=estilo.opacidade)
        a.update()


def nota(d: Documento, pagina: int, ponto: pymupdf.Point, texto: str,
         estilo: Estilo) -> None:
    with d.operacao("Inserir nota"):
        p = d.doc[pagina]
        a = p.add_text_annot(ponto, texto, icon="Note")
        a.set_colors(stroke=estilo.cor)
        a.update()


def palavras_em(pagina: pymupdf.Page, rect: pymupdf.Rect) -> list[pymupdf.Quad]:
    """Quadrilateros das palavras tocadas pelo retangulo, em ordem de leitura.

    Destacar pelo retangulo cru pintaria meia letra e o espaco entre linhas;
    pelas palavras, fica como o destaque de qualquer leitor."""
    rect = pymupdf.Rect(rect)
    # Uma caixa por LINHA (uniao das palavras tocadas), e nao por palavra:
    # por palavra, o destaque sai em gomos com buracos entre elas.
    linhas: dict[tuple[int, int], pymupdf.Rect] = {}
    for x0, y0, x1, y1, _p, bloco, linha, _n in pagina.get_text("words",
                                                                 sort=True):
        caixa = pymupdf.Rect(x0, y0, x1, y1)
        if caixa.intersects(rect):
            chave = (bloco, linha)
            linhas[chave] = linhas[chave] | caixa if chave in linhas else caixa
    return [r.quad for r in linhas.values()]


_MARCACOES = {
    "destacar": ("Destacar texto", "add_highlight_annot"),
    "sublinhar": ("Sublinhar texto", "add_underline_annot"),
    "tachar": ("Tachar texto", "add_strikeout_annot"),
}


def marcar_texto(d: Documento, pagina: int, rect: pymupdf.Rect, tipo: str,
                 estilo: Estilo) -> bool:
    """Destaque, sublinhado ou tachado nas palavras dentro de `rect`.

    Devolve False (e nao altera nada) se nao havia texto ali."""
    descricao, metodo = _MARCACOES[tipo]
    quads = palavras_em(d.doc[pagina], rect)
    if not quads:
        return False
    with d.operacao(descricao):
        # A pagina precisa de uma referencia viva: a anotacao so' guarda uma
        # referencia fraca a ela, e com `d.doc[pagina].metodo()` a pagina e'
        # coletada na hora -- o proximo acesso da "annotation not bound".
        p = d.doc[pagina]
        a = getattr(p, metodo)(quads)
        a.set_colors(stroke=estilo.cor)
        a.set_opacity(estilo.opacidade)
        a.update()
    return True


def caneta(d: Documento, pagina: int, tracos: Sequence[Sequence[pymupdf.Point]],
           estilo: Estilo) -> None:
    tracos = [[(p.x, p.y) for p in traco] for traco in tracos if len(traco) > 1]
    if not tracos:
        return
    with d.operacao("Desenho à mão livre"):
        p = d.doc[pagina]
        a = p.add_ink_annot(tracos)
        _finalizar(a, estilo)


def forma(d: Documento, pagina: int, tipo: str, inicio: pymupdf.Point,
          fim: pymupdf.Point, estilo: Estilo) -> None:
    """tipo: retangulo, elipse, linha ou seta."""
    p = d.doc[pagina]
    rect = pymupdf.Rect(inicio, fim)
    rect.normalize()
    nomes = {"retangulo": "Retângulo", "elipse": "Elipse", "linha": "Linha",
             "seta": "Seta"}
    with d.operacao(nomes[tipo]):
        if tipo == "retangulo":
            a = p.add_rect_annot(rect)
            _finalizar(a, estilo, preencher=True)
        elif tipo == "elipse":
            a = p.add_circle_annot(rect)
            _finalizar(a, estilo, preencher=True)
        else:
            a = p.add_line_annot(inicio, fim)
            if tipo == "seta":
                a.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE,
                                pymupdf.PDF_ANNOT_LE_CLOSED_ARROW)
                if estilo.preenchimento is None:
                    a.set_colors(stroke=estilo.cor, fill=estilo.cor)
                    a.set_border(width=estilo.espessura)
                    a.set_opacity(estilo.opacidade)
                    a.update()
                    return
            _finalizar(a, estilo, preencher=True)


def imagem(d: Documento, pagina: int, rect: pymupdf.Rect, *,
           arquivo: str | os.PathLike | None = None,
           dados: bytes | None = None,
           descricao: str = "Inserir imagem") -> None:
    """Imagem no conteudo da pagina, mantendo a proporcao dentro de `rect`.

    Em pagina girada a imagem recebe a MESMA rotacao da pagina, senao aparece
    deitada ou de cabeca para baixo para quem le -- `rect` esta' no espaco sem
    rotacao, a leitura nao. (O sinal foi conferido renderizando: com -rotacao
    a imagem sai invertida 180 graus numa pagina a 90.)"""
    p = d.doc[pagina]
    with d.operacao(descricao):
        p.insert_image(pymupdf.Rect(rect), filename=str(arquivo) if arquivo
                       else None, stream=dados, keep_proportion=True,
                       rotate=p.rotation)


def anotacao_em(pagina: pymupdf.Page, ponto: pymupdf.Point,
                folga: float = 3.0) -> pymupdf.Annot | None:
    """A anotacao sob o ponto -- a de cima, se houver varias."""
    ponto = pymupdf.Point(ponto)
    encontrada = None
    for a in pagina.annots() or []:
        r = pymupdf.Rect(a.rect)
        r.x0 -= folga
        r.y0 -= folga
        r.x1 += folga
        r.y1 += folga
        if ponto in r:
            encontrada = a
    return encontrada


def _achar(d: Documento, pagina: int,
           xref: int) -> tuple[pymupdf.Page, pymupdf.Annot]:
    """Devolve a pagina JUNTO: sem uma referencia viva a ela, a anotacao
    fica "not bound to any page" assim que o coletor passa."""
    p = d.doc[pagina]
    try:
        a = p.load_annot(xref)
    except Exception:                             # noqa: BLE001
        a = None
    if a is None:
        raise LookupError("anotação não encontrada")
    return p, a


def excluir_anotacao(d: Documento, pagina: int, xref: int) -> None:
    with d.operacao("Excluir anotação"):
        p, a = _achar(d, pagina, xref)
        p.delete_annot(a)


def mover_anotacao(d: Documento, pagina: int, xref: int, dx: float,
                   dy: float) -> None:
    """Desloca a anotacao em (dx, dy) pontos PDF.

    Mexe direto nas chaves do objeto (/Rect e a geometria: /L, /Vertices,
    /InkList, /CL) e NAO regenera a aparencia. A aparencia e' desenhada
    dentro do /Rect (o PDF mapeia a /BBox dela sobre o retangulo), entao
    deslocar o retangulo desloca o desenho intacto -- inclusive o de anotacoes
    criadas por outros programas, que um `update()` redesenharia do jeito do
    MuPDF. As chaves de geometria vao junto para a anotacao continuar
    coerente quando outro leitor a regenerar.

    Ha' duas armadilhas aqui: o PyMuPDF nao tem `set_ink_list`, e o arquivo
    guarda y de BAIXO para cima -- o dy da tela entra com o sinal trocado."""
    if abs(dx) < 0.01 and abs(dy) < 0.01:
        return
    _p, a = _achar(d, pagina, xref)
    if a.type[0] in (pymupdf.PDF_ANNOT_HIGHLIGHT, pymupdf.PDF_ANNOT_UNDERLINE,
                     pymupdf.PDF_ANNOT_STRIKE_OUT,
                     pymupdf.PDF_ANNOT_SQUIGGLY):
        raise ValueError("Marcações de texto ficam presas ao texto.")
    with d.operacao("Mover anotação"):
        doc = d.doc
        for chave in ("Rect", "L", "Vertices", "CL", "InkList"):
            tipo, valor = doc.xref_get_key(xref, chave)
            if tipo != "array":
                continue
            doc.xref_set_key(xref, chave, _deslocar_array(valor, dx, -dy))


def _deslocar_array(valor: str, dx: float, dy: float) -> str:
    """Soma (dx, dy) aos pares x y de um array PDF, inclusive aninhado
    ("[[x y x y] [x y]]" do /InkList)."""
    def pares(trecho: re.Match) -> str:
        numeros = [float(n) for n in trecho.group(1).split()]
        movidos = [n + (dx if i % 2 == 0 else dy)
                   for i, n in enumerate(numeros)]
        return "[" + " ".join(f"{n:.4f}".rstrip("0").rstrip(".")
                              for n in movidos) + "]"
    return re.sub(r"\[([-+0-9.\s]*)\]", pares, valor)
