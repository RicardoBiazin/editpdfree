"""Marca d'agua, numeracao, compressao, exportacao e metadados."""

from __future__ import annotations

import math
import os
import pathlib

import pymupdf

from . import fontes
from .documento import Documento


def _girado_para_pdf(p: pymupdf.Page, x: float, y: float) -> pymupdf.Point:
    return pymupdf.Point(x, y) * p.derotation_matrix


def marca_dagua(d: Documento, texto: str, *, tamanho: float = 60,
                cor=(0.6, 0.6, 0.6), opacidade: float = 0.3,
                diagonal: bool = True,
                paginas: list[int] | None = None) -> None:
    """Texto grande e translucido no centro de cada pagina."""
    if not texto.strip():
        raise ValueError("Informe o texto da marca d’água.")
    alvo = paginas if paginas is not None else range(d.paginas)
    largura = fontes.largura(texto, fontname="helv",
                                      fontsize=tamanho)
    with d.operacao("Marca d’água"):
        for i in alvo:
            p = d.doc[i]
            # O angulo e' o que o LEITOR ve; a rotacao da pagina entra na
            # conta porque o texto e' escrito no espaco sem rotacao.
            angulo = (45 if diagonal else 0) + p.rotation
            rad = math.radians(angulo)
            centro = _girado_para_pdf(p, p.rect.width / 2, p.rect.height / 2)
            # Recua meia largura ao longo da direcao do texto e meia altura na
            # perpendicular, para o CENTRO do texto cair no centro da pagina.
            ux, uy = math.cos(rad), -math.sin(rad)
            inicio = pymupdf.Point(
                centro.x - ux * largura / 2 - uy * tamanho * 0.35,
                centro.y - uy * largura / 2 + ux * tamanho * 0.35)
            p.insert_text(inicio, texto, fontsize=tamanho, fontname="helv",
                          color=cor, fill_opacity=opacidade,
                          stroke_opacity=opacidade,
                          morph=(inicio, pymupdf.Matrix(angulo)))


POSICOES = {
    "inferior-centro": "Rodapé, centro",
    "inferior-direita": "Rodapé, direita",
    "inferior-esquerda": "Rodapé, esquerda",
    "superior-centro": "Cabeçalho, centro",
    "superior-direita": "Cabeçalho, direita",
    "superior-esquerda": "Cabeçalho, esquerda",
}


def numerar(d: Documento, *, formato: str = "{n} / {total}",
            posicao: str = "inferior-centro", tamanho: float = 10,
            cor=(0, 0, 0), inicio: int = 1, margem: float = 24) -> None:
    """Numero em cada pagina. `formato` aceita {n} e {total}."""
    if posicao not in POSICOES:
        raise ValueError(f"posição inválida: {posicao}")
    try:
        formato.format(n=1, total=1)
    except (KeyError, IndexError, ValueError):
        raise ValueError("O formato só aceita {n} e {total}.") from None
    total = d.paginas + inicio - 1
    with d.operacao("Numerar páginas"):
        for i in range(d.paginas):
            p = d.doc[i]
            texto = formato.format(n=i + inicio, total=total)
            largura = fontes.largura(texto, fontname="helv",
                                              fontsize=tamanho)
            w, h = p.rect.width, p.rect.height
            vertical, horizontal = posicao.split("-")
            y = h - margem if vertical == "inferior" else margem + tamanho
            x = {"centro": (w - largura) / 2, "esquerda": margem,
                 "direita": w - margem - largura}[horizontal]
            p.insert_text(_girado_para_pdf(p, x, y), texto, fontsize=tamanho,
                          fontname="helv", color=cor, rotate=p.rotation)


#: Os tres niveis oferecidos ao usuario (os mesmos valores da versao web,
#: em web/src/core/formatos.ts -- mudar um sem o outro faz o mesmo nome
#: comprimir diferente em cada versao).
NIVEIS_COMPRESSAO = {
    "leve": {"rotulo": "Leve", "dpi": 150, "qualidade": 80,
             "descricao": "Quase sem perda visível. Bom para imprimir."},
    "media": {"rotulo": "Recomendada", "dpi": 110, "qualidade": 65,
              "descricao": "Equilíbrio entre tamanho e qualidade. Bom para "
                           "e-mail e sistemas."},
    "forte": {"rotulo": "Máxima", "dpi": 72, "qualidade": 45,
              "descricao": "Menor arquivo, para ler na tela. Imagens perdem "
                         "nitidez; remove miniaturas e metadados XML."},
}

#: Opcoes de gravacao usadas para MEDIR o resultado -- as mesmas do salvar.
OPCOES_GRAVAR = {"garbage": 3, "deflate": True, "use_objstms": 1}


def _aplicar_compressao(doc: pymupdf.Document, dpi: int, qualidade: int,
                        limpar: bool) -> None:
    doc.rewrite_images(dpi_threshold=int(dpi * 1.3), dpi_target=dpi,
                       quality=qualidade)
    try:
        doc.subset_fonts()
    except Exception:                             # noqa: BLE001
        # Fonte que nao se deixa subconjuntar fica como estava; a
        # reamostragem das imagens continua valendo.
        pass
    if limpar:
        doc.scrub(attached_files=False, clean_pages=False,
                  embedded_files=False, hidden_text=False, javascript=False,
                  metadata=False, redactions=False, redact_images=0,
                  remove_links=False, reset_fields=False,
                  reset_responses=False, thumbnails=True, xml_metadata=True)


def _parametros(nivel: str | None, dpi: int | None,
                qualidade: int | None) -> tuple[int, int, bool]:
    if nivel is not None:
        if nivel not in NIVEIS_COMPRESSAO:
            raise ValueError(f"nível de compressão desconhecido: {nivel}")
        n = NIVEIS_COMPRESSAO[nivel]
        return n["dpi"], n["qualidade"], nivel == "forte"
    return dpi or 110, qualidade or 65, False


def comprimir(d: Documento, nivel: str | None = None, *,
              dpi: int | None = None, qualidade: int | None = None) -> None:
    """Reamostra imagens acima da resolucao alvo, subconjunta as fontes e
    (no nivel maximo) tira miniaturas e metadados XML. Por nivel ("leve",
    "media", "forte") ou valores proprios (dpi, qualidade)."""
    dpi, qualidade, limpar = _parametros(nivel, dpi, qualidade)
    rotulo = NIVEIS_COMPRESSAO[nivel]["rotulo"].lower() if nivel else None
    with d.operacao(f"Comprimir ({rotulo})" if rotulo else "Comprimir"):
        _aplicar_compressao(d.doc, dpi, qualidade, limpar)


def estimar_compressao(d: Documento, niveis=None, progresso=None
                       ) -> dict[str, int]:
    """Tamanho que o arquivo teria em cada nivel, SEM mexer no documento
    (cada nivel roda numa copia). Inclui "atual": o tamanho de hoje, medido
    do mesmo jeito, para a comparacao ser justa."""
    niveis = list(niveis or NIVEIS_COMPRESSAO)
    base = d.doc.tobytes(garbage=0, encryption=pymupdf.PDF_ENCRYPT_NONE)
    with pymupdf.open("pdf", base) as copia:
        tamanhos = {"atual": len(copia.tobytes(**OPCOES_GRAVAR))}
    for n, nivel in enumerate(niveis):
        if progresso is not None and progresso(n, len(niveis)) is False:
            break
        dpi, qualidade, limpar = _parametros(nivel, None, None)
        with pymupdf.open("pdf", base) as copia:
            _aplicar_compressao(copia, dpi, qualidade, limpar)
            tamanhos[nivel] = len(copia.tobytes(**OPCOES_GRAVAR))
    return tamanhos


def exportar_imagens(d: Documento, pasta: str | os.PathLike, *,
                     dpi: int = 150, formato: str = "png",
                     paginas: list[int] | None = None) -> list[pathlib.Path]:
    pasta = pathlib.Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    base = pathlib.Path(d.nome).stem
    saidas = []
    for i in (paginas if paginas is not None else range(d.paginas)):
        destino = pasta / f"{base}_p{i + 1:03d}.{formato}"
        pix = d.doc[i].get_pixmap(dpi=dpi, alpha=False)
        if formato in ("jpg", "jpeg"):
            pix.save(destino, jpg_quality=90)
        else:
            pix.save(destino)
        saidas.append(destino)
    return saidas


CAMPOS_METADADOS = {"title": "Título", "author": "Autor",
                    "subject": "Assunto", "keywords": "Palavras-chave",
                    "creator": "Aplicativo de criação",
                    "producer": "Produtor"}


def metadados(d: Documento) -> dict[str, str]:
    m = d.doc.metadata or {}
    return {k: m.get(k) or "" for k in CAMPOS_METADADOS}


def definir_metadados(d: Documento, valores: dict[str, str]) -> None:
    atual = metadados(d)
    novo = {**atual, **{k: v for k, v in valores.items()
                        if k in CAMPOS_METADADOS}}
    if novo == atual:
        return
    with d.operacao("Propriedades do documento"):
        d.doc.set_metadata(novo)


def _preencher_campos(texto: str, n: int, total: int, arquivo: str,
                      data: str) -> str:
    return (texto.replace("{n}", str(n)).replace("{total}", str(total))
            .replace("{arquivo}", arquivo).replace("{data}", data))


def cabecalho_rodape(d: Documento, textos: dict[str, str], *,
                     tamanho: float = 9, cor=(0.25, 0.25, 0.25),
                     margem: float = 24, pular_primeira: bool = False) -> None:
    """Textos por posicao (as mesmas chaves de POSICOES). Aceita {n},
    {total}, {arquivo} e {data} -- troca literal, sem `str.format`, para uma
    chave digitada errada nao derrubar a operacao inteira."""
    import datetime
    textos = {k: v for k, v in textos.items() if v and v.strip()}
    invalidas = set(textos) - set(POSICOES)
    if invalidas:
        raise ValueError(f"posição inválida: {', '.join(sorted(invalidas))}")
    if not textos:
        raise ValueError("Informe ao menos um texto de cabeçalho ou rodapé.")
    hoje = datetime.date.today().strftime("%d/%m/%Y")
    arquivo = pathlib.Path(d.nome).stem
    with d.operacao("Cabeçalho e rodapé"):
        for i in range(d.paginas):
            if pular_primeira and i == 0:
                continue
            p = d.doc[i]
            w, h = p.rect.width, p.rect.height
            for posicao, modelo in textos.items():
                texto = _preencher_campos(modelo, i + 1, d.paginas, arquivo,
                                          hoje)
                largura = fontes.largura(texto, fontname="helv",
                                                  fontsize=tamanho)
                vertical, horizontal = posicao.split("-")
                y = h - margem if vertical == "inferior" else margem + tamanho
                x = {"centro": (w - largura) / 2, "esquerda": margem,
                     "direita": w - margem - largura}[horizontal]
                p.insert_text(_girado_para_pdf(p, x, y), texto,
                              fontsize=tamanho, fontname="helv", color=cor,
                              rotate=p.rotation)



def marca_dagua_imagem(d: Documento, imagem: bytes, *, opacidade: float = 0.25,
                       escala: float = 0.5, lado_a_lado: bool = False,
                       atras: bool = False,
                       paginas: list[int] | None = None) -> None:
    """Imagem translucida em cada pagina: centralizada (ocupando `escala` da
    menor dimensao da pagina) ou repetida lado a lado.

    A opacidade vai para o canal alfa da propria imagem -- o `insert_image`
    nao tem parametro de opacidade. Com `atras`, a imagem fica por baixo do
    conteudo (so' aparece onde a pagina e' transparente, ou seja, em PDF
    gerado por texto; num escaneado ela some atras da foto da pagina)."""
    if not 0 < opacidade <= 1:
        raise ValueError("Opacidade entre 1% e 100%.")
    pix = pymupdf.Pixmap(imagem)
    if pix.n - pix.alpha >= 4:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    if not pix.alpha:
        pix = pymupdf.Pixmap(pix, 1)
    alfa = bytearray(pix.samples_mv[pix.n - 1::pix.n])
    fator = opacidade
    pix.set_alpha(bytes(int(a * fator) for a in alfa))
    png = pix.tobytes("png")
    proporcao = pix.width / pix.height
    alvo = paginas if paginas is not None else range(d.paginas)
    with d.operacao("Marca d’água de imagem"):
        for i in alvo:
            p = d.doc[i]
            w, h = p.rect.width, p.rect.height          # como o leitor ve
            lado = min(w, h) * escala
            iw, ih = (lado, lado / proporcao) if proporcao >= 1 \
                else (lado * proporcao, lado)
            if lado_a_lado:
                posicoes = [(x, y) for y in _passos(h, ih) for x in _passos(w, iw)]
            else:
                posicoes = [((w - iw) / 2, (h - ih) / 2)]
            for x, y in posicoes:
                r = pymupdf.Rect(x, y, x + iw, y + ih) * p.derotation_matrix
                r.normalize()
                p.insert_image(r, stream=png, keep_proportion=True,
                               overlay=not atras, rotate=p.rotation)


def _passos(total: float, tamanho: float) -> list[float]:
    """Posicoes para repetir `tamanho` ao longo de `total`, com meio tamanho
    de espaco entre as copias e o conjunto centralizado."""
    passo = tamanho * 1.5
    n = max(1, int((total + tamanho * 0.5) // passo))
    usado = n * passo - tamanho * 0.5
    inicio = (total - usado) / 2
    return [inicio + k * passo for k in range(n)]
