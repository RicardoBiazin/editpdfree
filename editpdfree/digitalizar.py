"""Digitalizar do scanner (WIA, o servico de imagem do proprio Windows).

Usa a caixa de dialogo padrao do Windows ("Digitalizar"): ela ja' sabe
escolher o scanner, a resolucao e a area, e funciona com qualquer aparelho
que tenha driver WIA -- inclusive multifuncionais em rede. Cada chamada
digitaliza uma pagina; a interface pergunta se ha' mais.

`montar_pdf` e' separado da aquisicao para ser testavel sem scanner.
"""

from __future__ import annotations

import os
import tempfile

import pymupdf

# Constantes do WIA
WIA_TIPO_SCANNER = 1
WIA_INTENCAO_COR = 1
WIA_INTENCAO_CINZA = 2
WIA_INTENCAO_TEXTO = 4
WIA_QUALIDADE = 131072               # WiaImageBias.MaximizeQuality
FORMATO_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"

ERRO_CANCELADO = -2145320860         # 0x80210064: usuario cancelou
ERRO_SEM_DISPOSITIVO = -2145320939   # 0x80210015: nenhum scanner


class SemScanner(RuntimeError):
    pass


def scanners() -> list[str]:
    """Nomes dos scanners disponiveis (vazio se nao ha' WIA ou aparelho)."""
    try:
        import comtypes.client
        gerente = comtypes.client.CreateObject("WIA.DeviceManager")
    except Exception:                               # noqa: BLE001
        return []
    nomes = []
    for i in range(1, gerente.DeviceInfos.Count + 1):
        info = gerente.DeviceInfos.Item(i)
        if info.Type == WIA_TIPO_SCANNER:
            nomes.append(str(info.Properties["Name"].Value))
    return nomes


def adquirir_pagina(cor: bool = True) -> bytes | None:
    """Abre o dialogo do Windows e devolve a imagem (JPEG) ou None se o
    usuario cancelou."""
    import comtypes
    import comtypes.client
    try:
        dialogo = comtypes.client.CreateObject("WIA.CommonDialog")
    except OSError as erro:
        raise SemScanner("O serviço de digitalização do Windows (WIA) não "
                         "está disponível.") from erro
    try:
        imagem = dialogo.ShowAcquireImage(
            WIA_TIPO_SCANNER, WIA_INTENCAO_COR if cor else WIA_INTENCAO_CINZA,
            WIA_QUALIDADE, FORMATO_JPEG, False, True, False)
    except comtypes.COMError as erro:
        if erro.hresult == ERRO_CANCELADO:
            return None
        if erro.hresult == ERRO_SEM_DISPOSITIVO:
            raise SemScanner("Nenhum scanner encontrado.") from None
        raise
    if imagem is None:
        return None
    # O ImageFile do WIA so' sabe gravar em arquivo.
    fd, caminho = tempfile.mkstemp(suffix=".jpg", prefix="epf_scan_")
    os.close(fd)
    os.unlink(caminho)                  # SaveFile recusa arquivo existente
    try:
        imagem.SaveFile(caminho)
        with open(caminho, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(caminho)
        except OSError:
            pass


def montar_pdf(imagens: list[bytes]) -> bytes:
    """Uma pagina por imagem, no tamanho fisico da digitalizacao (usa o DPI
    gravado na imagem; sem ele, assume 300)."""
    if not imagens:
        raise ValueError("Nenhuma página digitalizada.")
    doc = pymupdf.open()
    try:
        for dados in imagens:
            pix = pymupdf.Pixmap(dados)
            dpi_x = pix.xres or 300
            dpi_y = pix.yres or 300
            if dpi_x < 50:                   # metadado ausente ou absurdo
                dpi_x = dpi_y = 300
            largura = pix.width * 72 / dpi_x
            altura = pix.height * 72 / dpi_y
            p = doc.new_page(width=largura, height=altura)
            p.insert_image(p.rect, stream=dados)
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
