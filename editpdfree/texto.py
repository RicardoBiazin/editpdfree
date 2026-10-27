"""Editar o texto que ja' esta' no PDF.

PDF nao tem "paragrafo editavel": tem instrucoes que desenham glifos em
posicoes fixas. Editar e', portanto, **apagar de verdade** o trecho antigo
(redacao, que remove os glifos do conteudo -- nao e' um retangulo branco por
cima) e escrever o novo no mesmo ponto de partida, com tamanho e cor iguais.

So' o que muda e' reescrito: prefixo e sufixo iguais ao original ficam como
estao. Quando todos os glifos da linha existem nas fontes originais, a linha
inteira e' reescrita caractere por caractere no mesmo lugar (fica uma linha so'
para a busca e para a proxima edicao); o que vem depois da troca anda o tanto
que a largura mudou.

Fonte: a ORIGINAL do PDF sempre que ela tem o glifo. A embutida vem quase
sempre em subconjunto (so' as letras que o documento usa): ela e' embutida de
novo e as letras que nao tem saem na Base-14 mais parecida -- serifada, sem
serifa ou monoespacada, com ou sem negrito/italico. Fonte so' nomeada (nao
embutida) tambem vai na Base-14: e' o que o leitor ja' mostra.
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
class Estilo:
    fonte: str
    tamanho: float
    cor: tuple[float, float, float]
    flags: int


@dataclasses.dataclass
class Caractere:
    c: str
    #: Linha de base (origem do glifo), espaco PDF.
    x: float
    y: float
    #: Extensao horizontal desenhada.
    x0: float
    x1: float
    #: Indice em `Trecho.estilos`.
    e: int


@dataclasses.dataclass
class Trecho:
    """Uma linha de texto do PDF, pronta para edicao.

    `inicio`/`fim` delimitam a parte selecionada em `caracteres` (a linha
    inteira por padrao); fonte, tamanho, cor e flags sao os da selecao."""
    pagina: int
    rect: pymupdf.Rect
    origem: pymupdf.Point
    texto: str
    fonte: str
    tamanho: float
    cor: tuple[float, float, float]
    flags: int
    horizontal: bool
    caracteres: list[Caractere] = dataclasses.field(default_factory=list)
    estilos: list[Estilo] = dataclasses.field(default_factory=list)
    inicio: int = 0
    fim: int = 0

    @property
    def selecionado(self) -> str:
        return "".join(k.c for k in self.caracteres[self.inicio:self.fim])

    @property
    def parcial(self) -> bool:
        return self.inicio > 0 or self.fim < len(self.caracteres)

    def caixa_selecao(self) -> pymupdf.Rect:
        cs = self.caracteres[self.inicio:self.fim]
        if not cs:
            return pymupdf.Rect(self.rect)
        return pymupdf.Rect(min(k.x0 for k in cs), self.rect.y0,
                            max(k.x1 for k in cs), self.rect.y1)


@dataclasses.dataclass
class ResultadoEdicao:
    alterou: bool
    #: Letras que a fonte original nao tem (sairam na Base-14 parecida).
    faltando: str = ""
    #: O fim da linha foi empurrado para fora da pagina.
    passou_da_pagina: bool = False


def _cor(inteiro: int) -> tuple[float, float, float]:
    return (((inteiro >> 16) & 255) / 255, ((inteiro >> 8) & 255) / 255,
            (inteiro & 255) / 255)


def _principal(t: Trecho, a: int, b: int) -> Estilo:
    """O estilo com mais caracteres visiveis em [a, b)."""
    contagem: dict[int, int] = {}
    for k in t.caracteres[a:b]:
        if k.c.strip():
            contagem[k.e] = contagem.get(k.e, 0) + 1
    if not contagem:
        return t.estilos[t.caracteres[min(a, len(t.caracteres) - 1)].e]
    return t.estilos[max(contagem, key=contagem.get)]


def com_selecao(t: Trecho, inicio: int, fim: int) -> Trecho:
    n = len(t.caracteres)
    inicio = max(0, min(n, inicio))
    fim = max(inicio, min(n, fim))
    e = _principal(t, inicio, max(fim, inicio + 1))
    return dataclasses.replace(t, inicio=inicio, fim=fim, fonte=e.fonte,
                               tamanho=e.tamanho, cor=e.cor, flags=e.flags)


def selecionar_faixa(t: Trecho, xa: float, xb: float) -> Trecho:
    """So' os caracteres cujo centro esta' entre os x dados (espaco PDF)."""
    lo, hi = min(xa, xb), max(xa, xb)
    dentro = [i for i, k in enumerate(t.caracteres)
              if lo <= (k.x0 + k.x1) / 2 <= hi]
    if dentro:
        return com_selecao(t, dentro[0], dentro[-1] + 1)
    meio = (lo + hi) / 2
    i = min(range(len(t.caracteres)),
            key=lambda j: abs((t.caracteres[j].x0 + t.caracteres[j].x1) / 2
                              - meio))
    return com_selecao(t, i, i + 1)


def diferenca(antigo: str, novo: str) -> tuple[int, int, str]:
    """O menor trecho que muda: (a, b, meio) -- [a, b) de `antigo` vira
    `meio`. Prefixo e sufixo comuns ficam intactos."""
    a = 0
    while a < len(antigo) and a < len(novo) and antigo[a] == novo[a]:
        a += 1
    s = 0
    while (s < len(antigo) - a and s < len(novo) - a
           and antigo[-1 - s] == novo[-1 - s]):
        s += 1
    return a, len(antigo) - s, novo[a:len(novo) - s]


def _linha_em(p: pymupdf.Page, ponto: pymupdf.Point):
    """(linha do rawdict, [(char, span)]) sob o ponto, sem o branco final."""
    dados = p.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)
    for bloco in dados["blocks"]:
        for linha in bloco.get("lines", []):
            if ponto not in pymupdf.Rect(linha["bbox"]):
                continue
            cars = [(c, s) for s in linha["spans"] for c in s["chars"]]
            while cars and not cars[-1][0]["c"].strip():
                cars.pop()
            if cars:
                return linha, cars
    return None


def trecho_em(d: Documento, pagina: int, ponto: pymupdf.Point,
              ate: pymupdf.Point | None = None) -> Trecho | None:
    """A LINHA de texto sob o ponto (espaco PDF).

    Linha, e nao span: um span muda a cada troca de estilo, e editar "Ola'
    **mundo**" palavra por palavra seria inutil. Com `ate`, so' os
    caracteres entre os x de `ponto` e `ate` ficam selecionados."""
    ponto = pymupdf.Point(ponto)
    achada = _linha_em(d.doc[pagina], ponto)
    if achada is None:
        return None
    linha, cars = achada
    estilos: list[Estilo] = []
    indice: dict[int, int] = {}
    caracteres: list[Caractere] = []
    for c, s in cars:
        if id(s) not in indice:
            indice[id(s)] = len(estilos)
            estilos.append(Estilo(s["font"], s["size"], _cor(s["color"]),
                                  s["flags"]))
        caracteres.append(Caractere(c["c"], c["origin"][0], c["origin"][1],
                                    c["bbox"][0], c["bbox"][2],
                                    indice[id(s)]))
    dx, dy = linha["dir"]
    e = estilos[0]
    t = Trecho(pagina=pagina, rect=pymupdf.Rect(linha["bbox"]),
               origem=pymupdf.Point(cars[0][0]["origin"]),
               texto="".join(k.c for k in caracteres), fonte=e.fonte,
               tamanho=e.tamanho, cor=e.cor, flags=e.flags,
               horizontal=abs(dy) < 1e-3 and dx > 0, caracteres=caracteres,
               estilos=estilos)
    t = com_selecao(t, 0, len(caracteres))
    if ate is not None:
        t = selecionar_faixa(t, ponto.x, pymupdf.Point(ate).x)
    return t


def fonte_base14(trecho: Trecho | Estilo) -> str:
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


def _chave_fonte(nome: str) -> str:
    """Nome comparavel: sem o prefixo de subconjunto ("ABCDEF+"), sem
    espaco/hifen e em minusculas. O PyMuPDF da' o nome do span de um jeito
    ("NimbusRoman-Regular") e o `get_fonts` de outro ("Nimbus Roman
    Regular")."""
    if len(nome) > 7 and nome[6] == "+":
        nome = nome[7:]
    return "".join(c for c in nome.lower() if c.isalnum())


class _Fontes:
    """As fontes originais da pagina, prontas para reescrever glifos.

    O mesmo nome pode ter mais de um objeto de fonte (o Word as vezes embute
    dois subconjuntos da mesma fonte): o glifo e' procurado em todos."""

    def __init__(self, doc: pymupdf.Document, p: pymupdf.Page):
        self.doc = doc
        self.p = p
        self.xrefs: dict[str, list[int]] = {}
        for f in p.get_fonts(full=True):
            self.xrefs.setdefault(_chave_fonte(f[3]), []).append(f[0])
        self._carregadas: dict[int, tuple[pymupdf.Font, bytes] | None] = {}
        self._nomes: dict[int, str] = {}

    def _carregar(self, xref: int) -> tuple[pymupdf.Font, bytes] | None:
        if xref not in self._carregadas:
            achada = None
            try:
                _n, _ext, _tipo, buf = self.doc.extract_font(xref)
                if buf:
                    achada = (pymupdf.Font(fontbuffer=buf), buf)
            except Exception:                  # noqa: BLE001 - fonte estranha
                achada = None
            self._carregadas[xref] = achada
        return self._carregadas[xref]

    def embutida(self, nome: str) -> bool:
        """Ha' arquivo de fonte embutido com esse nome? (None: so' nomeada,
        ou Type3 -- vai na Base-14.)"""
        return any(self._carregar(x)
                   for x in self.xrefs.get(_chave_fonte(nome), []))

    def para(self, nome: str, ch: str) -> tuple[int, pymupdf.Font] | None:
        """(xref, fonte) da fonte original que tem o glifo de `ch`."""
        for xref in self.xrefs.get(_chave_fonte(nome), []):
            c = self._carregar(xref)
            if c and c[0].has_glyph(ord(ch)):
                return xref, c[0]
        return None

    def recurso(self, xref: int) -> str:
        """Nome do recurso na pagina para a fonte original (embute 1 vez)."""
        if xref not in self._nomes:
            r = f"EPF{len(self._nomes) + 1}"
            self.p.insert_font(fontname=r, fontbuffer=self._carregadas[xref][1])
            self._nomes[xref] = r
        return self._nomes[xref]


def _medir(ch: str, fontes: _Fontes, nome: str | None, base14: str,
           tamanho: float) -> tuple[int | None, float]:
    """(xref da fonte original que tem o glifo, ou None; avanco em pontos)."""
    achada = fontes.para(nome, ch) if nome else None
    if achada:
        return achada[0], achada[1].glyph_advance(ord(ch)) * tamanho
    return None, pymupdf.get_text_length(ch, fontname=base14,
                                         fontsize=tamanho)


def substituir_trecho(d: Documento, trecho: Trecho, novo: str, *,
                      tamanho: float | None = None,
                      cor: tuple[float, float, float] | None = None,
                      fonte: str | None = None) -> ResultadoEdicao:
    """Troca o texto SELECIONADO do trecho (a linha inteira, se nada foi
    selecionado) por `novo`. `fonte`: None/"original" ou um nome Base-14 do
    PyMuPDF ("helv", "tibo"...). Sem mudar tamanho/cor/fonte, so' a parte que
    difere e' reescrita."""
    if not trecho.horizontal:
        raise ValueError("Só é possível editar texto horizontal.")
    t = trecho
    outra_fonte = bool(fonte) and fonte != "original"
    muda_estilo = tamanho is not None or cor is not None or outra_fonte
    a, b, meio = t.inicio, t.fim, novo
    if not muda_estilo:
        da, db, meio = diferenca(t.selecionado, novo)
        if da == db and not meio:
            return ResultadoEdicao(False)
        a, b = t.inicio + da, t.inicio + db
    resultado = ResultadoEdicao(True)
    with d.operacao("Editar texto"):
        p = d.doc[t.pagina]
        k0 = t.caracteres[0]
        achada = _linha_em(p, pymupdf.Point(
            (k0.x0 + k0.x1) / 2, k0.y - t.estilos[k0.e].tamanho * 0.3))
        if achada is None or "".join(c["c"] for c, _s in achada[1]) != t.texto:
            raise ValueError("A linha mudou desde que foi clicada. "
                             "Clique nela de novo.")
        cs, n = t.caracteres, len(t.caracteres)
        fontes = _Fontes(d.doc, p)
        # Estilo do texto novo: o do primeiro caractere trocado (ou o
        # anterior, quando so' se insere).
        base = cs[min(a, n - 1) if a < b or a == 0 else a - 1]
        est = t.estilos[base.e]
        tam = tamanho if tamanho is not None else est.tamanho
        cor_nova = tuple(cor) if cor is not None else est.cor
        original = None if outra_fonte else est.fonte
        b14 = fonte if outra_fonte else fonte_base14(est)

        def avanco(k: Caractere) -> float:
            e = t.estilos[k.e]
            return _medir(k.c, fontes, e.fonte, fonte_base14(e), e.tamanho)[1]

        x_ini = cs[a].x if a < n else cs[-1].x + avanco(cs[-1])
        y = cs[a].y if a < n else cs[-1].y
        largura = sum(_medir(ch, fontes, original, b14, tam)[1] for ch in meio)
        delta = largura - (cs[b].x - x_ini) if b < n else 0.0

        def tem_glifo(k: Caractere) -> bool:
            if not k.c.strip():
                return True
            nome = t.estilos[k.e].fonte
            if fontes.embutida(nome):
                return fontes.para(nome, k.c) is not None
            # So' nomeada: vai na Base-14, que so' tem o Latin-1 (e pouco mais).
            return ord(k.c) < 256 or k.c in "–—‘’“”•…€"

        # Com todos os glifos disponiveis, a linha INTEIRA e' reescrita (o que
        # nao muda sai identico): continua uma linha so' para a busca, a
        # copia e a proxima edicao. Sem isso, so' o que muda (e o resto da
        # linha, se a largura mudou).
        linha_toda = all(tem_glifo(k) for k in cs)
        mover_resto = b < n and abs(delta) > 0.01
        de = 0 if linha_toda else a
        ate = n if linha_toda or mover_resto else b
        if ate > de:
            def corte(i: int) -> float:
                # No meio do vao entre dois caracteres: nao pega o vizinho.
                if i <= 0:
                    return t.rect.x0 - 1
                if i >= n:
                    return t.rect.x1 + 1
                return (max(cs[i - 1].x1, cs[i - 1].x) + cs[i].x) / 2
            r = _area_da_linha(t)
            p.add_redact_annot(pymupdf.Rect(corte(de), r.y0, corte(ate), r.y1),
                               fill=False)
            p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                               graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                               text=pymupdf.PDF_REDACT_TEXT_REMOVE)

        forma = p.new_shape()
        faltando: list[str] = []

        def escrever(ch: str, fonte_orig: str | None, base14: str, x: float,
                     yy: float, tam_: float, cor_: tuple,
                     registrar: bool) -> float:
            xref, w = _medir(ch, fontes, fonte_orig, base14, tam_)
            if xref is not None:
                nome = fontes.recurso(xref)
            else:
                nome = base14
                if (fonte_orig and fontes.embutida(fonte_orig) and registrar
                        and ch.strip() and ch not in faltando):
                    faltando.append(ch)
            if ch.strip():
                forma.insert_text(pymupdf.Point(x, yy), ch, fontname=nome,
                                  fontsize=tam_, color=cor_)
            return w

        def copiar(k: Caractere, dx: float) -> None:
            e = t.estilos[k.e]
            escrever(k.c, e.fonte, fonte_base14(e), k.x + dx, k.y, e.tamanho,
                     e.cor, False)

        for k in cs[de:a]:
            copiar(k, 0)
        x = x_ini
        for ch in meio:
            x += escrever(ch, original, b14, x, y, tam, cor_nova, True)
        for k in cs[b:ate]:
            copiar(k, delta)
        forma.commit()
        resultado.faltando = "".join(faltando)
        fim_linha = cs[-1].x1 + delta if b < n else x
        resultado.passou_da_pagina = fim_linha > p.mediabox.x1
    return resultado


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
                  fonte: str = "helv") -> int | None:
    """Texto novo NO CONTEUDO da pagina (nao anotacao), com a linha de base em
    `ponto`. Em pagina girada, sai de pe' para o leitor. Fica como item movel
    (ver `itens`); devolve o xref dele."""
    from . import itens
    with d.operacao("Adicionar texto"):
        return itens.escrever_texto(d.doc[pagina], ponto, texto, tamanho, cor,
                                    fonte)


def extrair_texto(d: Documento) -> str:
    partes = []
    for i in range(d.paginas):
        partes.append(f"--- Página {i + 1} ---\n" + d.doc[i].get_text())
    return "\n".join(partes)
