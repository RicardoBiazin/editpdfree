"""Campos de formulario (AcroForm): listar, preencher, criar e achatar."""

from __future__ import annotations

import dataclasses
import re
import unicodedata

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


@dataclasses.dataclass
class Sugestao:
    pagina: int
    rect: pymupdf.Rect
    tipo: str            # "texto" ou "caixa"
    nome: str
    motivo: str


def _nome_do_rotulo(texto: str, usados: set[str]) -> str:
    base = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9]+", "_", base).strip("_").lower()[:30] or "campo"
    nome, n = base, 2
    while nome in usados:
        nome, n = f"{base}_{n}", n + 1
    usados.add(nome)
    return nome


def detectar_campos(d: Documento) -> list[Sugestao]:
    """Sugere campos num formulario "de papel" (sem AcroForm):

    * sequencias de sublinhado (`____`) viram campo de texto na linha;
    * quadrados pequenos vazios desenhados (8 a 20 pt) viram caixa de selecao;
    * linhas horizontais desenhadas (tracos de assinatura/preenchimento) com
      um rotulo a esquerda viram campo de texto.

    E' heuristica: o usuario confirma antes de criar. Areas onde ja' existe
    campo sao ignoradas."""
    sugestoes: list[Sugestao] = []
    usados = {c.nome for c in campos(d)}
    for i in range(d.paginas):
        p = d.doc[i]
        existentes = [pymupdf.Rect(w.rect) for w in (p.widgets() or [])]
        palavras = p.get_text("words", sort=True)

        def livre(r: pymupdf.Rect) -> bool:
            return not any(r.intersects(e) for e in existentes + [
                s.rect for s in sugestoes if s.pagina == i])

        def rotulo_antes(r: pymupdf.Rect) -> str:
            mesma_linha = [w for w in palavras
                           if abs((w[1] + w[3]) / 2 - (r.y0 + r.y1) / 2) < r.height
                           and w[2] <= r.x0 + 2 and "__" not in w[4]]
            return " ".join(w[4] for w in mesma_linha[-4:]).rstrip(":").strip()

        # 1. sublinhados no texto
        for x0, y0, x1, y1, texto, *_ in palavras:
            if texto.count("_") >= 4 and set(texto.strip(".:")) <= {"_"}:
                r = pymupdf.Rect(x0, y0 - 2, x1, y1)
                if r.width >= 20 and livre(r):
                    rot = rotulo_antes(r)
                    sugestoes.append(Sugestao(i, r, "texto",
                                              _nome_do_rotulo(rot or "campo", usados),
                                              "linha de sublinhado"))
        # 2. e 3. desenhos
        for desenho in p.get_drawings():
            r = pymupdf.Rect(desenho["rect"])
            preenchido = desenho.get("fill") is not None and \
                desenho.get("fill") != (1.0, 1.0, 1.0)
            if (8 <= r.width <= 20 and 8 <= r.height <= 20
                    and abs(r.width - r.height) < 3 and not preenchido):
                vazio = not p.get_text("text", clip=r).strip()
                if vazio and livre(r):
                    rot = _texto_depois(palavras, r)
                    sugestoes.append(Sugestao(i, r, "caixa",
                                              _nome_do_rotulo(rot or "opcao", usados),
                                              "quadrado vazio"))
            elif r.height <= 1.5 and r.width >= 60:
                area = pymupdf.Rect(r.x0, r.y0 - 16, r.x1, r.y1)
                vazio = not p.get_text("text", clip=area).strip()
                if vazio and livre(area):
                    rot = rotulo_antes(area)
                    if rot:
                        sugestoes.append(Sugestao(i, area, "texto",
                                                  _nome_do_rotulo(rot, usados),
                                                  "linha de preenchimento"))
    return sugestoes


def _texto_depois(palavras, r: pymupdf.Rect) -> str:
    seguintes = [w for w in palavras
                 if abs((w[1] + w[3]) / 2 - (r.y0 + r.y1) / 2) < r.height
                 and w[0] >= r.x1 - 1]
    return " ".join(w[4] for w in seguintes[:4])


def criar_sugeridos(d: Documento, sugestoes: list[Sugestao]) -> int:
    if not sugestoes:
        return 0
    with d.operacao("Criar campos detectados"):
        for s in sugestoes:
            if s.tipo == "caixa":
                w = _novo_widget(pymupdf.PDF_WIDGET_TYPE_CHECKBOX, s.rect, s.nome)
                w.field_value = False
            else:
                w = _novo_widget(pymupdf.PDF_WIDGET_TYPE_TEXT, s.rect, s.nome)
                w.text_fontsize = 0
                w.border_width = 0
            p = d.doc[s.pagina]
            p.add_widget(w)
    return len(sugestoes)
