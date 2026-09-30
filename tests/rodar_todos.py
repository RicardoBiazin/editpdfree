"""Roda todas as suites e resume o resultado.

    .venv\\Scripts\\python.exe tests\\rodar_todos.py

Sem pytest, de proposito -- padrao dos projetos desta maquina. Cada suite roda
num processo separado: um travamento de Qt numa suite nao leva as outras, e o
teto de tempo aponta a culpada em vez de pendurar a rodada (um dialogo modal
aberto sem ninguem para clicar bloqueia PARA SEMPRE).
"""

from __future__ import annotations

import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

LIMITE_POR_SUITE_S = 180

SUITES = [
    ("teste_base.py", "versao, coordenadas nas quatro rotacoes, idioma"),
    ("teste_documento.py", "abrir, desfazer/refazer, gravar atomico, senha"),
    ("teste_paginas.py", "girar, mover, excluir, inserir, juntar, dividir"),
    ("teste_anotacoes.py", "texto, destaque, formas, caneta, imagem, mover"),
    ("teste_texto.py", "editar texto existente, substituir, extrair"),
    ("teste_seguranca.py", "tarja de verdade e formularios"),
    ("teste_extras.py", "marca d'agua, numeracao, compressao, exportacao"),
    ("teste_interface.py", "janela: abas, gestos do mouse, teclas, busca"),
    ("teste_assinatura.py", "assinatura digital A1 (PAdES): assinar e validar"),
    ("teste_ocr_conversao.py", "OCR embutido; DOCX/TXT/imagem -> PDF -> Word"),
    ("teste_produtividade.py", "lote, comparar, recortar, carimbo, marcadores"),
    ("teste_interface_recursos.py", "recursos 0.2 pela janela e impressao"),
    ("teste_ferramentas_03.py", "reparar, PPTX/XLSX/MD, imagens, PDF/A, campos"),
    ("teste_interface_03.py", "recursos 0.3 pela janela, scanner simulado"),
    ("teste_atalhos.py", "barra de atalhos personalizavel"),
    ("teste_juntar.py", "juntar PDFs escolhendo a ordem"),
]


def main() -> int:
    total_ok = total_falhas = 0
    quebradas: list[tuple[str, str]] = []
    ambiente = dict(os.environ)
    ambiente.setdefault("QT_QPA_PLATFORM", "offscreen")
    ambiente["PYTHONIOENCODING"] = "utf-8"
    ambiente["PYTHONPATH"] = RAIZ + os.pathsep + ambiente.get("PYTHONPATH", "")

    for arquivo, descricao in SUITES:
        caminho = os.path.join(AQUI, arquivo)
        if not os.path.isfile(caminho):
            print("%-22s AUSENTE  %s" % (arquivo, descricao))
            quebradas.append((arquivo, "arquivo de teste nao encontrado"))
            continue
        try:
            proc = subprocess.run([sys.executable, "-u", caminho],
                                  capture_output=True, text=True,
                                  errors="replace", env=ambiente, cwd=RAIZ,
                                  timeout=LIMITE_POR_SUITE_S)
        except subprocess.TimeoutExpired as expirou:
            parcial = str(expirou.stdout or "") + str(expirou.stderr or "")
            print("%-22s TRAVOU apos %ds  [PROBLEMA]  %s"
                  % (arquivo, LIMITE_POR_SUITE_S, descricao))
            quebradas.append((arquivo, "A SUITE TRAVOU (dialogo modal?)\n"
                              + parcial))
            continue
        saida = proc.stdout + proc.stderr
        ok = saida.count("\n  OK   ")
        falhas = saida.count("\n  FALHA")
        total_ok += ok
        total_falhas += falhas
        estado = ("pulado" if ("PULADO:" in saida and not ok and not falhas)
                  else ("ok" if proc.returncode == 0 else "PROBLEMA"))
        print("%-22s %3d ok  %d falhas  [%-8s]  %s"
              % (arquivo, ok, falhas, estado, descricao))
        if proc.returncode != 0:
            quebradas.append((arquivo, saida))

    print("-" * 74)
    print("TOTAL: %d verificacoes ok, %d falhas" % (total_ok, total_falhas))
    for arquivo, saida in quebradas:
        print("\n===== saida de %s =====" % arquivo)
        print(saida[-4000:])
    return 1 if (total_falhas or quebradas) else 0


if __name__ == "__main__":
    sys.exit(main())
