"""Assinatura digital com certificado A1 (.pfx/.p12) -- PAdES via pyHanko.

Diferente da assinatura-imagem (`anotacoes.imagem`): aqui o PDF recebe uma
assinatura criptografica. Qualquer alteracao posterior no arquivo e' detectada,
e leitores como o Adobe mostram "Assinado por ...".

Tres regras:

* **Assinar e' a ultima coisa.** A assinatura cobre os bytes do arquivo; o
  `Documento.salvar` reescreve o PDF inteiro, o que a invalidaria. Por isso
  assinar trabalha sobre BYTES e grava num arquivo novo por atualizacao
  incremental -- nunca pelo caminho normal de salvar.
* **Coordenadas.** O pyHanko usa o espaco do PDF de verdade (y de baixo para
  cima, a partir da mediabox); o resto do programa usa o do PyMuPDF (y de cima
  para baixo). `_caixa_pyhanko` e' a unica conversao.
* **Confianca.** "Integra" (nada mudou desde a assinatura) e "confiavel" (a
  cadeia chega a uma raiz conhecida) sao coisas diferentes. As raizes da
  ICP-Brasil (publicas, do ITI) vem em `recursos/icp_brasil`.
"""

from __future__ import annotations

import dataclasses
import datetime
import io
import logging
import os
import pathlib

import pymupdf

from .recursos_caminho import recursos


class SenhaCertificadoIncorreta(ValueError):
    pass


@dataclasses.dataclass
class InfoCertificado:
    titular: str
    emissor: str
    validade: datetime.datetime
    vencido: bool
    cpf_cnpj: str


@dataclasses.dataclass
class InfoAssinatura:
    campo: str
    titular: str
    data: datetime.datetime | None
    motivo: str
    local: str
    integra: bool
    confiavel: bool
    cobre_tudo: bool
    resumo: str


def _nome_legivel(nome) -> str:
    from cryptography.x509.oid import NameOID
    cn = nome.get_attributes_for_oid(NameOID.COMMON_NAME)
    return cn[0].value if cn else nome.rfc4514_string()


def _cpf_cnpj(titular: str) -> str:
    # Certificados ICP-Brasil costumam trazer "NOME:CPF" no CN.
    if ":" in titular:
        final = titular.rsplit(":", 1)[1].strip()
        if final.isdigit() and len(final) in (11, 14):
            return final
    return ""


def carregar_certificado(pfx: bytes, senha: str):
    """(chave, certificado, cadeia) do .pfx. Senha errada vira
    SenhaCertificadoIncorreta, e nao um erro criptico do cryptography."""
    from cryptography.hazmat.primitives.serialization import pkcs12
    try:
        chave, cert, cadeia = pkcs12.load_key_and_certificates(
            pfx, senha.encode("utf-8") if senha else None)
    except ValueError as erro:
        texto = str(erro).lower()
        if "password" in texto or "mac" in texto or "decrypt" in texto:
            raise SenhaCertificadoIncorreta(
                "Senha do certificado incorreta.") from None
        raise ValueError(f"Arquivo de certificado inválido: {erro}") from None
    if chave is None or cert is None:
        raise ValueError("O arquivo não contém chave privada e certificado.")
    return chave, cert, list(cadeia or [])


def info_certificado(pfx: bytes, senha: str) -> InfoCertificado:
    _chave, cert, _cadeia = carregar_certificado(pfx, senha)
    titular = _nome_legivel(cert.subject)
    validade = cert.not_valid_after_utc
    return InfoCertificado(
        titular=titular, emissor=_nome_legivel(cert.issuer),
        validade=validade,
        vencido=validade < datetime.datetime.now(datetime.timezone.utc),
        cpf_cnpj=_cpf_cnpj(titular))


def _caixa_pyhanko(dados: bytes, pagina: int,
                   rect: pymupdf.Rect) -> tuple[float, float, float, float]:
    with pymupdf.open("pdf", dados) as doc:
        p = doc[pagina]
        mb = p.mediabox
        # rect (PyMuPDF, sem rotacao, y para baixo, origem no canto superior
        # da mediabox) -> espaco do PDF (y para cima).
        return (mb.x0 + rect.x0, mb.y1 - rect.y1,
                mb.x0 + rect.x1, mb.y1 - rect.y0)


def _nome_campo_livre(dados: bytes) -> str:
    with pymupdf.open("pdf", dados) as doc:
        existentes = {w.field_name for p in doc for w in (p.widgets() or [])}
    n = 1
    while f"Assinatura{n}" in existentes:
        n += 1
    return f"Assinatura{n}"


def assinar(dados: bytes, pfx: bytes, senha: str, *, pagina: int = 0,
            rect: pymupdf.Rect | None = None, motivo: str = "",
            local: str = "", contato: str = "") -> bytes:
    """Devolve os bytes do PDF assinado (atualizacao incremental de `dados`).

    `rect` None = assinatura invisivel. Com `rect`, a pagina nao pode estar
    girada: o carimbo do pyHanko nao acompanha a rotacao e sairia deitado."""
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko.sign.fields import SigFieldSpec
    from pyhanko.sign.signers.pdf_signer import (PdfSignatureMetadata,
                                                 PdfSigner)
    from pyhanko.stamp import TextStampStyle

    carregar_certificado(pfx, senha)          # mensagem clara se a senha falhar
    with pymupdf.open("pdf", dados) as doc:
        if doc.needs_pass or doc.is_encrypted:
            raise ValueError("Remova a senha do PDF antes de assinar "
                             "(Documento › Remover senha e salve).")
        if rect is not None and doc[pagina].rotation:
            raise ValueError("A assinatura visível não funciona em página "
                             "girada. Use a assinatura invisível ou desfaça "
                             "a rotação.")
    signer = signers.SimpleSigner.load_pkcs12_data(
        pfx, other_certs=None,
        passphrase=senha.encode("utf-8") if senha else None)
    if signer is None:
        raise SenhaCertificadoIncorreta("Senha do certificado incorreta.")
    campo = _nome_campo_livre(dados)
    escritor = IncrementalPdfFileWriter(io.BytesIO(dados))
    if rect is not None:
        fields.append_signature_field(escritor, SigFieldSpec(
            campo, on_page=pagina, box=_caixa_pyhanko(dados, pagina, rect)))
    else:
        fields.append_signature_field(escritor, SigFieldSpec(campo,
                                                             on_page=pagina))
    meta = PdfSignatureMetadata(
        field_name=campo, reason=motivo or None, location=local or None,
        contact_info=contato or None,
        subfilter=fields.SigSeedSubFilter.PADES,
        md_algorithm="sha256")
    estilo = TextStampStyle(
        stamp_text="Assinado digitalmente por\n%(signer)s\nData: %(ts)s"
                   + (f"\nMotivo: {motivo}" if motivo else ""),
        timestamp_format="%d/%m/%Y %H:%M:%S %z", border_width=1)
    saida = io.BytesIO()
    PdfSigner(meta, signer=signer, stamp_style=estilo).sign_pdf(
        escritor, output=saida)
    return saida.getvalue()


def raizes_icp_brasil() -> list:
    from asn1crypto import pem, x509 as asn1_x509
    raizes = []
    for arquivo in sorted((recursos() / "icp_brasil").glob("*.crt")):
        dados = arquivo.read_bytes()
        if pem.detect(dados):
            _tipo, _cab, dados = pem.unarmor(dados)
        raizes.append(asn1_x509.Certificate.load(dados))
    return raizes


def verificar(dados: bytes, raizes_extras: list | None = None
              ) -> list[InfoAssinatura]:
    """Lista e valida as assinaturas do PDF. Sem rede: revogacao nao e'
    consultada (dizer "confiavel" aqui significa "a cadeia chega a uma raiz
    ICP-Brasil ou a uma raiz informada")."""
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    leitor = PdfFileReader(io.BytesIO(dados), strict=False)
    raizes = raizes_icp_brasil() + list(raizes_extras or [])
    lista = []
    # O pyHanko registra cada cadeia nao confiavel como ERRO com traceback no
    # log -- para um PDF assinado por certificado de teste isso e' esperado,
    # nao um erro do programa.
    registrador = logging.getLogger("pyhanko")
    nivel = registrador.level
    registrador.setLevel(logging.CRITICAL)
    try:
        for sig in leitor.embedded_signatures:
            contexto = ValidationContext(trust_roots=raizes,
                                         allow_fetching=False)
            try:
                estado = validate_pdf_signature(sig, contexto)
            except Exception as erro:                   # noqa: BLE001
                lista.append(InfoAssinatura(
                    campo=sig.field_name, titular="?", data=None, motivo="",
                    local="", integra=False, confiavel=False,
                    cobre_tudo=False, resumo=f"Não foi possível validar: {erro}"))
                continue
            titular = _nome_legivel_asn1(estado.signing_cert)
            obj = sig.sig_object
            cobre = estado.coverage is not None and \
                estado.coverage.name == "ENTIRE_FILE"
            integra = bool(estado.intact and estado.valid)
            confiavel = bool(estado.trusted)
            if not integra:
                resumo = "O documento foi ALTERADO depois da assinatura."
            elif confiavel:
                resumo = "Íntegra e com cadeia de certificação confiável."
            else:
                resumo = ("Íntegra, mas a cadeia do certificado não chega a "
                          "uma raiz confiável (ICP-Brasil).")
            if integra and not cobre:
                resumo += " Houve alterações permitidas depois dela."
            lista.append(InfoAssinatura(
                campo=sig.field_name, titular=titular,
                data=estado.signer_reported_dt,
                motivo=str(obj.get("/Reason", "") or ""),
                local=str(obj.get("/Location", "") or ""),
                integra=integra, confiavel=confiavel, cobre_tudo=cobre,
                resumo=resumo))
    finally:
        registrador.setLevel(nivel)
    return lista


def _nome_legivel_asn1(cert) -> str:
    try:
        return cert.subject.native.get("common_name") or \
            cert.subject.human_friendly
    except Exception:                                   # noqa: BLE001
        return "?"


def nome_assinado(caminho: str | os.PathLike | None, nome: str) -> str:
    base = pathlib.Path(caminho) if caminho else pathlib.Path(nome)
    return str(base.with_name(base.stem + "_assinado.pdf"))
