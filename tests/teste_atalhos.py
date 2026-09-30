"""Barra de atalhos personalizavel."""

from __future__ import annotations

import sys

from ajudantes import (checa, checa_igual, drenar_eventos, preparar_qt, pular,
                       resumir, secao)

if not preparar_qt():
    sys.exit(pular("PySide6 nao instalado"))

from editpdfree.interface import atalhos, config
from editpdfree.interface.janela_principal import JanelaPrincipal


def ids_na_barra(j) -> list[str]:
    por_acao = {id(a): i for i, _c, a in atalhos.catalogo(j)}
    return [por_acao[id(a)] for a in j.barra_atalhos.actions()]


def main() -> int:
    secao("catalogo")
    j = JanelaPrincipal(config.Config(config.Config.PADRAO))
    itens = atalhos.catalogo(j)
    ids = [i for i, _c, _a in itens]
    checa(len(itens) > 60, f"todos os itens dos menus ({len(itens)})")
    checa_igual(len(ids), len(set(ids)), "ids unicos")
    caminhos = {i: c for i, c, _a in itens}
    checa_igual(caminhos.get("a_para_xlsx"),
                "Arquivo › Converter › PDF para Excel (.xlsx) — tabelas…",
                "submenu entra com o caminho completo")
    checa("ferramenta:carimbo" in ids, "ferramentas tambem entram")
    checa("_a_personalizar" not in ids, "o proprio 'personalizar' fica fora")
    checa(not any(c.startswith("Arquivo › Abrir recente") for c in caminhos.values()),
          "itens de 'Abrir recente' ficam fora")

    secao("barra")
    checa_igual(ids_na_barra(j), atalhos.PADRAO, "padrao de fabrica")
    checa(not j.barra_atalhos.isHidden(), "barra visivel")
    aplicados = j.definir_atalhos(["a_para_pptx", "inexistente", "a_reparar"],
                                  com_texto=True)
    checa_igual(aplicados, ["a_para_pptx", "a_reparar"],
                "id desconhecido e' ignorado sem erro")
    checa_igual(ids_na_barra(j), ["a_para_pptx", "a_reparar"], "nova ordem")
    checa_igual(j.cfg["atalhos"], ["a_para_pptx", "a_reparar"], "vai para a config")
    checa(j.cfg["atalhos_texto"], "preferencia de texto guardada")
    # O botao dispara a mesma acao do menu (mesmo objeto QAction).
    acao = j.barra_atalhos.actions()[1]
    checa(acao is j.a_reparar, "o botao e' a propria acao do menu")
    j.definir_atalhos([])
    checa(j.barra_atalhos.isHidden(), "barra vazia fica escondida")

    secao("persistencia")
    cfg = config.Config(config.Config.PADRAO)
    cfg["atalhos"] = ["a_digitalizar", "ferramenta:tarjar"]
    j2 = JanelaPrincipal(cfg)
    checa_igual(ids_na_barra(j2), ["a_digitalizar", "ferramenta:tarjar"],
                "janela nova abre com os atalhos salvos")
    vazio = config.Config(config.Config.PADRAO)
    vazio["atalhos"] = []
    j3 = JanelaPrincipal(vazio)
    checa_igual(ids_na_barra(j3), [], "lista vazia salva nao volta ao padrao")

    secao("dialogo")
    d = atalhos.DialogoAtalhos(itens, ["a_juntar"], False)
    checa_igual(d.escolhidos(), ["a_juntar"], "comeca com os atuais")
    checa(all(d.disponiveis.item(i).data(256) != "a_juntar"
              for i in range(d.disponiveis.count())),
          "o que ja' esta' na barra sai da lista de disponiveis")
    d.filtro.setText("excel")
    visiveis = [d.disponiveis.item(i) for i in range(d.disponiveis.count())
                if not d.disponiveis.item(i).isHidden()]
    checa_igual(len(visiveis), 1, "filtro")
    d.disponiveis.setCurrentItem(visiveis[0])
    d.adicionar()
    checa_igual(d.escolhidos(), ["a_juntar", "a_para_xlsx"], "adicionar")
    d.mover(-1)
    checa_igual(d.escolhidos(), ["a_para_xlsx", "a_juntar"], "subir")
    d.na_barra.setCurrentRow(1)
    d.remover()
    checa_igual(d.escolhidos(), ["a_para_xlsx"], "remover")
    d.restaurar()
    checa_igual(d.escolhidos(), atalhos.PADRAO, "restaurar padrao")
    menu = j.createPopupMenu()
    checa(j._a_personalizar in menu.actions(),
          "botao direito numa barra oferece personalizar")
    for janela in (j, j2, j3):
        janela.close()
    drenar_eventos()
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
