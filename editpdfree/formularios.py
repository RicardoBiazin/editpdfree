"""Campos de formulario (AcroForm): listar, preencher, criar e achatar."""

from __future__ import annotations

import dataclasses

import pymupdf

from .documento import Documento

TIPOS_SUPORTADOS = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "Texto",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "Caixa de seleção",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "Opção",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "Lista suspensa",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "Lista",
}

_MARCAVEIS = (pymupdf.PDF_WIDGET_TYPE_CHECKBOX,
              pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON)


@dataclasses.dataclass
class Campo:
    pagina: int
    xref: int
    nome: str
    tipo: int
    valor: str | bool
    opcoes: list[str]
    rect: pymupdf.Rect

    @property
    def tipo_legivel(self) -> str:
        return TIPOS_SUPORTADOS.get(self.tipo, "Outro")

    @property
    def marcavel(self) -> bool:
        return self.tipo in _MARCAVEIS


def _marcado(w: pymupdf.Widget) -> bool:
    return w.field_value not in (False, None, "", "Off")


def campos(d: Documento) -> list[Campo]:
    lista = []
    for i in range(d.paginas):
        for w in d.doc[i].widgets() or []:
            if w.field_type not in TIPOS_SUPORTADOS:
                continue
            marcavel = w.field_type in _MARCAVEIS
            lista.append(Campo(
                pagina=i, xref=w.xref, nome=w.field_name or f"campo{w.xref}",
                tipo=w.field_type,
                valor=_marcado(w) if marcavel else str(w.field_value or ""),
                opcoes=[o if isinstance(o, str) else o[-1]
                        for o in (w.choice_values or [])],
                rect=pymupdf.Rect(w.rect)))
    return lista


def campo_em(d: Documento, pagina: int, ponto: pymupdf.Point) -> Campo | None:
    for c in campos(d):
        if c.pagina == pagina and pymupdf.Point(ponto) in c.rect:
            return c
    return None


def preencher(d: Documento, valores: dict[int, str | bool]) -> int:
    """`valores` por xref do widget. Devolve quantos campos foram gravados."""
    alvos = [(i, w.xref) for i in range(d.paginas)
             for w in (d.doc[i].widgets() or []) if w.xref in valores]
    if not alvos:
        return 0
    with d.operacao("Preencher formulário"):
        for i, xref in alvos:
            for w in d.doc[i].widgets() or []:
                if w.xref != xref:
                    continue
                valor = valores[xref]
                if w.field_type in _MARCAVEIS:
                    w.field_value = w.on_state() if valor else "Off"
                else:
                    w.field_value = str(valor)
                w.update()
    return len(alvos)


def achatar(d: Documento) -> None:
    """Transforma campos e anotacoes em conteudo fixo da pagina."""
    with d.operacao("Achatar formulário"):
        d.doc.bake(annots=True, widgets=True)


def _novo_widget(tipo: int, rect: pymupdf.Rect, nome: str) -> pymupdf.Widget:
    w = pymupdf.Widget()
    w.field_type = tipo
    w.field_name = nome
    w.rect = pymupdf.Rect(rect)
    w.border_color = (0.4, 0.4, 0.4)
    w.border_width = 0.5
    return w


def criar_campo_texto(d: Documento, pagina: int, rect: pymupdf.Rect,
                      nome: str) -> None:
    with d.operacao("Criar campo de texto"):
        w = _novo_widget(pymupdf.PDF_WIDGET_TYPE_TEXT, rect, nome)
        w.text_fontsize = 0
        d.doc[pagina].add_widget(w)


def criar_caixa_selecao(d: Documento, pagina: int, rect: pymupdf.Rect,
                        nome: str) -> None:
    with d.operacao("Criar caixa de seleção"):
        w = _novo_widget(pymupdf.PDF_WIDGET_TYPE_CHECKBOX, rect, nome)
        w.field_value = False
        d.doc[pagina].add_widget(w)
