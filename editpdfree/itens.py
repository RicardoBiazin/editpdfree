"""Itens inseridos no CONTEUDO da pagina que continuam moveis.

Texto, imagem e assinatura inseridos vao para o conteudo da pagina (nao sao
anotacao: nao somem com um "excluir anotacao" e saem em qualquer leitor e
impressora). Para poderem ser arrastados depois, cada um fica num fluxo de
conteudo proprio, marcado no dicionario do fluxo:

    /EPFItem /Texto   /EPFCaixa [x0 y0 x1 y1]   (espaco do ARQUIVO, y para cima)

e comecando por ``q 1 0 0 1 tx ty cm``: mover e' so' trocar tx ty. O texto
guarda tambem o que foi digitado e o estilo (/EPFTexto, /EPFTam, /EPFCor,
/EPFFonte com o nome Base-14 do PDF, /EPFOrigem com a linha de base no espaco
do arquivo antes do deslocamento) para ser editado depois. E' o mesmo
formato da versao web -- um PDF salvo numa e' movido na outra.

Uma operacao que reescreve o conteudo da pagina inteira (tarja, editar texto)
junta os fluxos, e o item vira conteudo comum, fixo.
"""

from __future__ import annotations

import re

import pymupdf

from .documento import Documento

NOMES = {"Texto": "Texto inserido", "Imagem": "Imagem",
         "Assinatura": "Assinatura"}

_PREFIXO = re.compile(rb"^q 1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n")


def _para_arquivo(p: pymupdf.Page) -> pymupdf.Matrix:
    """Espaco PDF do PyMuPDF (sem rotacao, y para baixo) -> espaco do arquivo.

    `transformation_matrix` vai do arquivo ao espaco SEM rotacao (conferido
    numa pagina a 90 graus: compor com a `derotation_matrix` girava o
    deslocamento)."""
    return ~p.transformation_matrix


def _num(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _caixa(doc: pymupdf.Document, xref: int) -> list[float] | None:
    tipo, valor = doc.xref_get_key(xref, "EPFCaixa")
    if tipo != "array":
        return None
    try:
        return [float(v) for v in valor.strip("[]").split()]
    except ValueError:
        return None


def _tipo(doc: pymupdf.Document, xref: int) -> str | None:
    tipo, valor = doc.xref_get_key(xref, "EPFItem")
    return valor.lstrip("/") if tipo == "name" else None


def registrar(p: pymupdf.Page, antes: list[int], tipo: str,
              rect: pymupdf.Rect) -> int | None:
    """Marca como item o fluxo que a insercao acabou de criar.

    `antes`: os fluxos da pagina antes da insercao. `rect`: caixa do item no
    espaco PDF do PyMuPDF. Devolve o xref do item (None se a insercao nao
    criou um fluxo proprio)."""
    doc = p.parent
    novos = [x for x in p.get_contents() if x not in antes]
    alvo = None
    for x in novos:
        # O PyMuPDF pode acrescentar fluxos so' com "q"/"Q" ao embrulhar.
        if doc.xref_stream(x).strip() not in (b"", b"q", b"Q"):
            alvo = x
    if alvo is None:
        return None
    dados = doc.xref_stream(alvo)
    doc.update_stream(alvo, b"q 1 0 0 1 0 0 cm\n" + dados + b"\nQ\n")
    r = pymupdf.Rect(rect) * _para_arquivo(p)
    r.normalize()
    doc.xref_set_key(alvo, "EPFItem", "/" + tipo)
    doc.xref_set_key(alvo, "EPFCaixa",
                     "[%s]" % " ".join(_num(v) for v in (r.x0, r.y0, r.x1, r.y1)))
    return alvo


#: Codigo de fonte do PyMuPDF <-> nome Base-14 no PDF (a web grava o nome).
_FONTES = {"helv": "Helvetica", "hebo": "Helvetica-Bold",
           "heit": "Helvetica-Oblique", "hebi": "Helvetica-BoldOblique",
           "tiro": "Times-Roman", "tibo": "Times-Bold", "tiit": "Times-Italic",
           "tibi": "Times-BoldItalic", "cour": "Courier", "cobo": "Courier-Bold",
           "coit": "Courier-Oblique", "cobi": "Courier-BoldOblique"}
_CODIGOS = {v: k for k, v in _FONTES.items()}


def escrever_texto(p: pymupdf.Page, ponto: pymupdf.Point, texto: str,
                   tamanho: float, cor, fonte: str = "helv") -> int | None:
    """Escreve o texto (linha de base em `ponto`, espaco PDF do PyMuPDF) como
    item movel e editavel. Nao abre operacao: quem chama abre."""
    antes = p.get_contents()
    p.insert_text(ponto, texto, fontsize=tamanho, fontname=fonte, color=cor,
                  rotate=p.rotation)
    # Caixa no espaco que o leitor ve (o texto corre para a direita dele) e
    # depois de volta ao espaco sem rotacao.
    linhas = texto.split("\n")
    largura = max(max(pymupdf.get_text_length(lin, fontname=fonte,
                                              fontsize=tamanho)
                      for lin in linhas), tamanho * 0.5)
    o = pymupdf.Point(ponto) * p.rotation_matrix
    caixa = pymupdf.Rect(o.x, o.y - tamanho * 0.85, o.x + largura,
                         o.y + (len(linhas) - 1) * tamanho * 1.2
                         + tamanho * 0.25) * p.derotation_matrix
    caixa.normalize()
    xref = registrar(p, antes, "Texto", caixa)
    if xref is not None:
        doc = p.parent
        origem = pymupdf.Point(ponto) * _para_arquivo(p)
        doc.xref_set_key(xref, "EPFTexto", pymupdf.get_pdf_str(texto))
        doc.xref_set_key(xref, "EPFTam", _num(tamanho))
        doc.xref_set_key(xref, "EPFCor", "[%s]" % " ".join(_num(c) for c in cor))
        doc.xref_set_key(xref, "EPFFonte", "/" + _FONTES.get(fonte, "Helvetica"))
        doc.xref_set_key(xref, "EPFOrigem", f"[{_num(origem.x)} {_num(origem.y)}]")
    return xref


def dados_texto(p: pymupdf.Page, xref: int) -> dict | None:
    """{texto, tamanho, cor, fonte (codigo do PyMuPDF)} de um item de texto;
    None se o item nao guarda o texto."""
    doc = p.parent
    tipo, texto = doc.xref_get_key(xref, "EPFTexto")
    if tipo != "string" or doc.xref_get_key(xref, "EPFOrigem")[0] != "array":
        return None
    try:
        tamanho = float(doc.xref_get_key(xref, "EPFTam")[1])
    except ValueError:
        tamanho = 12.0
    try:
        cor = tuple(float(v) for v in
                    doc.xref_get_key(xref, "EPFCor")[1].strip("[]").split())
    except ValueError:
        cor = (0.0, 0.0, 0.0)
    nome = doc.xref_get_key(xref, "EPFFonte")[1].lstrip("/")
    return {"texto": texto, "tamanho": tamanho,
            "cor": cor if len(cor) == 3 else (0.0, 0.0, 0.0),
            "fonte": _CODIGOS.get(nome, "helv")}


def editar_texto(d: Documento, pagina: int, xref: int, texto: str, *,
                 tamanho: float | None = None, cor=None,
                 fonte: str | None = None) -> int | None:
    """Troca o texto de um item de texto, no lugar onde ele esta' agora. O
    item e' reescrito (sai e volta com o texto novo): o xref muda e e'
    devolvido."""
    if not texto.strip():
        raise ValueError("Digite o texto.")
    p0 = d.doc[pagina]
    atual = dados_texto(p0, xref) if eh_item(p0, xref) else None
    if atual is None:
        raise ValueError("Este item não é um texto editável.")
    with d.operacao("Editar texto inserido"):
        p = d.doc[pagina]
        doc = d.doc
        o = [float(v) for v in
             doc.xref_get_key(xref, "EPFOrigem")[1].strip("[]").split()]
        achado = _PREFIXO.match(doc.xref_stream(xref))
        tx, ty = ((float(achado.group(1)), float(achado.group(2)))
                  if achado else (0.0, 0.0))
        ponto = pymupdf.Point(o[0] + tx, o[1] + ty) * ~_para_arquivo(p)
        resto = [x for x in p.get_contents() if x != xref]
        doc.xref_set_key(p.xref, "Contents",
                         "[%s]" % " ".join(f"{x} 0 R" for x in resto))
        return escrever_texto(p, ponto, texto,
                              tamanho if tamanho is not None else atual["tamanho"],
                              tuple(cor) if cor is not None else atual["cor"],
                              fonte or atual["fonte"])


def listar(p: pymupdf.Page) -> list[tuple[int, str, pymupdf.Rect]]:
    """(xref, tipo, caixa no espaco PDF do PyMuPDF) de cada item, na ordem
    de desenho."""
    doc = p.parent
    volta = ~_para_arquivo(p)
    itens = []
    for x in p.get_contents():
        tipo, caixa = _tipo(doc, x), _caixa(doc, x)
        if tipo and caixa and len(caixa) == 4:
            r = pymupdf.Rect(caixa) * volta
            r.normalize()
            itens.append((x, tipo, r))
    return itens


def eh_item(p: pymupdf.Page, xref: int) -> bool:
    return any(x == xref for x, _t, _r in listar(p))


def caixa_do_item(p: pymupdf.Page, xref: int) -> pymupdf.Rect | None:
    for x, _t, r in listar(p):
        if x == xref:
            return r
    return None


def item_em(p: pymupdf.Page, ponto: pymupdf.Point,
            folga: float = 3.0) -> int | None:
    """O item sob o ponto -- o de cima, se houver varios."""
    ponto = pymupdf.Point(ponto)
    achado = None
    for x, _t, r in listar(p):
        if ponto in pymupdf.Rect(r.x0 - folga, r.y0 - folga, r.x1 + folga,
                                 r.y1 + folga):
            achado = x
    return achado


def mover(d: Documento, pagina: int, xref: int, dx: float, dy: float) -> None:
    """Desloca o item em (dx, dy) pontos (espaco PDF do PyMuPDF)."""
    if abs(dx) < 0.01 and abs(dy) < 0.01:
        return
    if not eh_item(d.doc[pagina], xref):
        raise LookupError("item não encontrado")
    with d.operacao("Mover item"):
        p = d.doc[pagina]
        doc = d.doc
        m = _para_arquivo(p)
        v = pymupdf.Point(dx, dy) * m - pymupdf.Point(0, 0) * m
        dados = doc.xref_stream(xref)
        achado = _PREFIXO.match(dados)
        if not achado:
            raise LookupError("item não encontrado")
        tx = float(achado.group(1)) + v.x
        ty = float(achado.group(2)) + v.y
        doc.update_stream(xref, b"q 1 0 0 1 %s %s cm\n" % (
            _num(tx).encode(), _num(ty).encode()) + dados[achado.end():])
        c = _caixa(doc, xref)
        doc.xref_set_key(xref, "EPFCaixa", "[%s]" % " ".join(
            _num(c[i] + (v.x if i % 2 == 0 else v.y)) for i in range(4)))


def excluir(d: Documento, pagina: int, xref: int) -> None:
    """Tira o item do conteudo da pagina."""
    if not eh_item(d.doc[pagina], xref):
        raise LookupError("item não encontrado")
    with d.operacao("Excluir item"):
        p = d.doc[pagina]
        resto = [x for x in p.get_contents() if x != xref]
        d.doc.xref_set_key(p.xref, "Contents",
                           "[%s]" % " ".join(f"{x} 0 R" for x in resto))
