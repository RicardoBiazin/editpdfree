# -*- mode: python ; coding: utf-8 -*-
"""Empacotamento do EditPDFree.

    .venv\\Scripts\\python.exe -m PyInstaller --noconfirm --clean EditPDFree.spec

`build.bat` e' o caminho normal: roda a suite antes e a autoverificacao do
.exe depois. Com EPF_UM_ARQUIVO=1 gera um .exe portatil unico.

O PyMuPDF traz a DLL do MuPDF (dezenas de MB) -- e' o grosso do pacote, e nao
ha' o que cortar nela.
"""

import os
import pathlib

UM_ARQUIVO = bool(os.environ.get("EPF_UM_ARQUIVO"))

excludes = [
    # Modulos Qt que o projeto nao usa.
    "PySide6.QtQml", "PySide6.QtQuick", "PySide6.QtQuickWidgets",
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
    "PySide6.Qt3DCore", "PySide6.QtCharts", "PySide6.QtDataVisualization",
    "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets",
    "PySide6.QtOpenGL", "PySide6.QtOpenGLWidgets", "PySide6.QtPositioning",
    "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtBluetooth",
    "PySide6.QtSerialPort", "PySide6.QtSvgWidgets", "PySide6.QtPdf",
    "PySide6.QtPdfWidgets", "PySide6.QtDesigner", "PySide6.QtHelp",
    "PySide6.QtUiTools", "PySide6.QtConcurrent", "PySide6.QtNetwork",
    # Pesos pesados que nada aqui importa.
    "tkinter", "numpy", "pandas", "matplotlib", "scipy", "PIL",
    "PyQt5", "PyQt6", "IPython", "pytest", "setuptools", "pip",
]

# Bibliotecas NATIVAS (excludes age sobre modulos Python). opengl32sw.dll e' o
# rasterizador de software do Qt; o programa e' Widgets puro. Se em alguma
# maquina ele nao abrir, o primeiro teste e' tirar essa DLL desta lista.
#
# O OpenSSL (libssl/libcrypto) FICA: o pyHanko importa `ssl` ao carregar os
# modulos de carimbo de tempo, e sem as DLLs a assinatura digital morre com
# "DLL load failed while importing _ssl" -- so' no .exe. A autoverificacao
# pegou isso na 0.2.0.
DLLS_DESNECESSARIAS = [
    "opengl32sw.dll", "Qt6Pdf.dll", "Qt6Quick.dll", "Qt6Qml.dll",
    "Qt6Network.dll",
]

# Traducao do Qt para pt-BR ("Salvar"/"Cancelar" nos dialogos padrao). O
# PyInstaller NAO inclui os .qm sozinho.
import PySide6 as _PySide6
_traducoes = pathlib.Path(_PySide6.__file__).parent / "translations"
datas = [(str(_traducoes / f"{c}.qm"), "traducoes")
         for c in ("qtbase_pt_BR", "qt_pt_BR")
         if (_traducoes / f"{c}.qm").is_file()]
print(f"[EditPDFree] {len(datas)} catalogo(s) de traducao no pacote")

_icone = pathlib.Path("editpdfree/recursos/icone.ico")
if not _icone.is_file():
    raise SystemExit("[EditPDFree] editpdfree/recursos/icone.ico ausente: "
                     "rode ferramentas\\gerar_icone.py")
datas.append((str(_icone), "editpdfree/recursos"))

# Idiomas do OCR e raizes ICP-Brasil. Sem eles o .exe abre normalmente e so'
# falha na hora do OCR ("tessdata not found") ou diz que TODA assinatura
# ICP-Brasil e' "nao confiavel" -- por isso o empacotamento aborta.
for _pasta, _padrao in (("editpdfree/recursos/tessdata", "*.traineddata"),
                        ("editpdfree/recursos/icp_brasil", "*.crt")):
    _arquivos = sorted(pathlib.Path(_pasta).glob(_padrao))
    if not _arquivos:
        raise SystemExit(f"[EditPDFree] {_pasta} vazio: empacotamento abortado.")
    datas += [(str(a), _pasta) for a in _arquivos]
    print(f"[EditPDFree] {len(_arquivos)} arquivo(s) de {_pasta}")

# O pyHanko carrega partes por importacao tardia (dentro de funcao) e le
# arquivos de dados do proprio pacote; o python-docx tem um template .docx
# interno sem o qual `Document()` falha.
from PyInstaller.utils.hooks import collect_data_files, collect_submodules
datas += collect_data_files("docx")
datas += collect_data_files("pyhanko")
datas += collect_data_files("pyhanko_certvalidator")
hiddenimports = (collect_submodules("pyhanko.sign")
                 + collect_submodules("pyhanko.stamp")
                 + collect_submodules("pyhanko_certvalidator")
                 + ["docx", "tzlocal"])
datas.append(("LICENSE", "."))

a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=1,          # remove asserts; NAO usa 2, que apagaria docstrings
)

_antes = len(a.binaries)
_fora = {d.lower() for d in DLLS_DESNECESSARIAS}
a.binaries = [b for b in a.binaries if pathlib.Path(b[0]).name.lower()
              not in _fora]
print(f"[EditPDFree] {_antes - len(a.binaries)} DLL(s) desnecessaria(s) "
      f"removida(s)")

pyz = PYZ(a.pure)

# UPX fica fora: comprimir as DLLs grandes atrasa a partida e e' gatilho
# conhecido de falso positivo de antivirus.
comum = dict(name="EditPDFree", debug=False, bootloader_ignore_signals=False,
             strip=False, upx=False, console=False,
             disable_windowed_traceback=False, argv_emulation=False,
             target_arch=None, codesign_identity=None, entitlements_file=None,
             icon=str(_icone), version="versao.txt", uac_admin=False)

if UM_ARQUIVO:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], runtime_tmpdir=None,
              **comum)
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, **comum)
    coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False,
                   name="EditPDFree")
