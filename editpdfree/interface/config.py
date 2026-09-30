"""Preferencias do usuario em %APPDATA%\\EditPDFree\\config.json.

JSON e nao QSettings/registro: da' para os testes isolarem trocando APPDATA
(ver `tests/ajudantes.py`), e o usuario consegue apagar ou copiar um arquivo.
"""

from __future__ import annotations

import json
import os
import pathlib

MAX_RECENTES = 12


def pasta() -> pathlib.Path:
    base = os.environ.get("APPDATA") or str(pathlib.Path.home())
    p = pathlib.Path(base) / "EditPDFree"
    p.mkdir(parents=True, exist_ok=True)
    return p


def caminho_assinatura() -> pathlib.Path:
    return pasta() / "assinatura.png"


class Config(dict):
    PADRAO = {
        "recentes": [],
        "geometria": "",
        "cor": [0.85, 0.1, 0.1],
        "espessura": 2.0,
        "opacidade": 1.0,
        "tamanho_fonte": 12.0,
        "ultima_pasta": "",
        # So' o CAMINHO do .pfx; a senha nunca e' guardada.
        "ultimo_certificado": "",
        # Barra de atalhos: ids das acoes (ver interface/atalhos.py). None =
        # usar o padrao de fabrica; lista vazia = o usuario esvaziou a barra.
        "atalhos": None,
        "atalhos_texto": False,
    }

    @classmethod
    def carregar(cls) -> "Config":
        c = cls(cls.PADRAO)
        try:
            dados = json.loads((pasta() / "config.json").read_text("utf-8"))
            if isinstance(dados, dict):
                c.update({k: v for k, v in dados.items() if k in cls.PADRAO})
        except (OSError, ValueError):
            pass
        return c

    def gravar(self) -> None:
        destino = pasta() / "config.json"
        temporario = destino.with_suffix(".tmp")
        try:
            temporario.write_text(json.dumps(self, ensure_ascii=False,
                                             indent=2), "utf-8")
            os.replace(temporario, destino)
        except OSError:
            pass

    def adicionar_recente(self, caminho: str) -> None:
        chave = os.path.normcase(os.path.abspath(caminho))
        lista = [c for c in self["recentes"]
                 if os.path.normcase(os.path.abspath(c)) != chave]
        self["recentes"] = [str(caminho)] + lista[:MAX_RECENTES - 1]
