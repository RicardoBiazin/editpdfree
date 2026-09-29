"""Editar o texto que ja' esta' no PDF.

PDF nao tem "paragrafo editavel": tem instrucoes que desenham glifos em
posicoes fixas. Editar e', portanto, **apagar de verdade** o trecho antigo
(redacao, que remove os glifos do conteudo -- nao e' um retangulo branco por
cima) e escrever o novo no mesmo ponto de partida, com fonte, tamanho e cor o
mais proximos possivel.

A fonte original quase nunca pode ser reaproveitada: vem em subconjunto (so'
os glifos usados) e uma letra nova nao existiria nela. Por isso o texto novo
usa a Base-14 mais parecida -- serifada, sem serifa ou monoespacada, com ou sem
negrito/italico. E' a mesma limitacao de qualquer editor de PDF.
"""

from __future__ import annotations

import dataclasses

import pymupdf

from .documento import Documento

# Bits de `span["flags"]` no PyMuPDF.
_ITALICO = 2
_SERIFADA = 4
_MONO = 8
_NEGRITO = 16


@dataclasses.dataclass
class Trecho:
    """Uma linha de texto do PDF, pronta para edicao."""
    pagina: int
    rect: pymupdf.Rect
    origem: pymupdf.Point
    texto: str
    fonte: str
    tamanho: float
    cor: tuple[float, float, float]
    flags: int
    horizontal: bool


def _cor(inteiro: int) -> tuple[float, float, float]:
    return (((inteiro >> 16) & 255) / 255, ((inteiro >> 8) & 255) / 255,
            (inteiro & 255) / 255)


def trecho_em(d: Documento, pagina: int,
              ponto: pymupdf.Point) -> Trecho | None:
    """A LINHA de texto sob o ponto (espaco PDF).

    Linha, e nao span: um span muda a cada troca de estilo, e editar "Ola'
    **mundo**" palavra por palavra seria inutil. A fonte e a cor vem do span
    mais longo da linha."""
    ponto = pymupdf.Point(ponto)
    dados = d.doc[pagina].get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
    for bloco in dados["blocks"]:
        for linha in bloco.get("lines", []):
            if ponto not in pymupdf.Rect(linha["bbox"]):
                continue
            spans = [s for s in linha["spans"] if s["text"].strip()]
            if not spans:
                continue
            principal = max(spans, key=lambda s: len(s["text"]))
            texto = "".join(s["text"] for s in linha["spans"])
            dx, dy = linha["dir"]
            return Trecho(
                pagina=pagina, rect=pymupdf.Rect(linha["bbox"]),
                origem=pymupdf.Point(linha["spans"][0]["origin"]),
                texto=texto.rstrip(), fonte=principal["font"],
                tamanho=principal["size"], cor=_cor(principal["color"]),
                flags=principal["flags"],
                horizontal=abs(dy) < 1e-3 and dx > 0)
    return None


def fonte_base14(trecho: Trecho) -> str:
    nome = trecho.fonte.lower()
    negrito = bool(trecho.flags & _NEGRITO) or "bold" in nome
    italico = (bool(trecho.flags & _ITALICO) or "italic" in nome
               or "oblique" in nome)
    if trecho.flags & _MONO or "courier" in nome or "mono" in nome:
        familia = "co"
    elif trecho.flags & _SERIFADA or "times" in nome or "serif" in nome:
        familia = "ti"
    else:
        familia = "he"
    sufixo = {(False, False): "ro", (True, False): "bo",
              (False, True): "it", (True, True): "bi"}[(negrito, italico)]
    if familia == "he" and sufixo == "ro":
        return "helv"
    return familia + sufixo


def _area_da_linha(trecho: Trecho) -> pymupdf.Rect:
    """A caixa da linha encolhida na vertical.

    As caixas de linhas vizinhas se sobrepoem um pouco (ascendente de uma sobre
    descendente da outra). Redigir a caixa inteira arrancaria pedaco da linha
    de cima ou de baixo -- o defeito so' aparece em texto com entrelinha
    apertada."""
    r = pymupdf.Rect(trecho.rect)
    folga = r.height * 0.2
    return pymupdf.Rect(r.x0, r.y0 + folga, r.x1, r.y1 - folga)


def substituir_trecho(d: Documento, trecho: Trecho, novo: str, *,
                      tamanho: float | None = None,
                      cor: tuple[float, float, float] | None = None) -> None:
    if not trecho.horizontal:
        raise ValueError("Só é possível editar texto horizontal.")
    fonte = fonte_base14(trecho)
    tamanho = tamanho or trecho.tamanho
    cor = cor if cor is not None else trecho.cor
    with d.operacao("Editar texto"):
        p = d.doc[trecho.pagina]
        p.add_redact_annot(_area_da_linha(trecho), fill=False)
        p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                           graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                           text=pymupdf.PDF_REDACT_TEXT_REMOVE)
        if novo:
            p.insert_text(trecho.origem, novo, fontsize=tamanho,
                          fontname=fonte, color=cor)


def substituir_em_tudo(d: Documento, procurado: str, novo: str) -> int:
    """Troca TODAS as ocorrencias de `procurado` no documento. Devolve quantas.

    Cada ocorrencia e' redigida e reescrita no mesmo lugar, na fonte/tamanho do
    trecho em que estava. Um so' desfazer para tudo."""
    if not procurado:
        return 0
    alvos: list[tuple[int, pymupdf.Rect, Trecho]] = []
    for i in range(d.paginas):
        p = d.doc[i]
        for r in p.search_for(procurado):
            t = trecho_em(d, i, pymupdf.Point((r.x0 + r.x1) / 2,
                                              (r.y0 + r.y1) / 2))
            if t is not None and t.horizontal:
                alvos.append((i, r, t))
    if not alvos:
        return 0
    with d.operacao("Substituir texto"):
        por_pagina: dict[int, list[tuple[pymupdf.Rect, Trecho]]] = {}
        for i, r, t in alvos:
            por_pagina.setdefault(i, []).append((r, t))
        for i, lista in por_pagina.items():
            p = d.doc[i]
            for r, t in lista:
                folga = r.height * 0.2
                p.add_redact_annot(pymupdf.Rect(r.x0, r.y0 + folga, r.x1,
                                                r.y1 - folga), fill=False)
            p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                               graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
            for r, t in lista:
                # A linha de base do trecho, na altura do achado.
                p.insert_text(pymupdf.Point(r.x0, t.origem.y), novo,
                              fontsize=t.tamanho, fontname=fonte_base14(t),
                              color=t.cor)
    return len(alvos)


def inserir_texto(d: Documento, pagina: int, ponto: pymupdf.Point, texto: str,
                  *, tamanho: float = 12, cor=(0, 0, 0),
                  fonte: str = "helv") -> None:
    """Texto novo NO CONTEUDO da pagina (nao anotacao), com a linha de base em
    `ponto`. Em pagina girada, sai de pe' para o leitor."""
    with d.operacao("Adicionar texto"):
        p = d.doc[pagina]
        p.insert_text(ponto, texto, fontsize=tamanho, fontname=fonte,
                      color=cor, rotate=p.rotation)


def extrair_texto(d: Documento) -> str:
    partes = []
    for i in range(d.paginas):
        partes.append(f"--- Página {i + 1} ---\n" + d.doc[i].get_text())
    return "\n".join(partes)
