"""Assinatura digital com certificado A1 (gerado no teste, autoassinado)."""

from __future__ import annotations

import datetime
import sys

from ajudantes import (checa, checa_igual, checa_levanta, pdf_texto, resumir,
                       secao)

import pymupdf
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from editpdfree import assinatura_digital as ad


def certificado_teste(senha: str = "1234", dias: int = 30):
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "FULANO DE TAL:12345678900"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "BR")])
    agora = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome)
            .public_key(chave.public_key()).serial_number(7)
            .not_valid_before(agora - datetime.timedelta(days=1))
            .not_valid_after(agora + datetime.timedelta(days=dias))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None),
                           critical=True)
            .add_extension(x509.KeyUsage(
                digital_signature=True, content_commitment=True,
                key_encipherment=False, data_encipherment=False,
                key_agreement=False, key_cert_sign=True, crl_sign=False,
                encipher_only=False, decipher_only=False), critical=True)
            .sign(chave, hashes.SHA256()))
    pfx = pkcs12.serialize_key_and_certificates(
        b"fulano", chave, cert, None,
        serialization.BestAvailableEncryption(senha.encode()))
    return pfx, cert


def raiz_asn1(cert):
    from asn1crypto import x509 as asn1_x509
    return asn1_x509.Certificate.load(
        cert.public_bytes(serialization.Encoding.DER))


def main() -> int:
    pfx, cert = certificado_teste()
    dados = pdf_texto([["Contrato de prestação de serviços"], ["Página 2"]])

    secao("certificado")
    info = ad.info_certificado(pfx, "1234")
    checa_igual(info.titular, "FULANO DE TAL:12345678900", "titular lido")
    checa_igual(info.cpf_cnpj, "12345678900", "CPF extraido do CN")
    checa(not info.vencido, "certificado dentro da validade")
    checa_levanta(ad.SenhaCertificadoIncorreta, ad.info_certificado,
                  "senha errada tem mensagem propria", pfx, "errada")
    checa_levanta(ValueError, ad.info_certificado, "arquivo que nao e' pfx",
                  b"lixo", "1234")
    checa(len(ad.raizes_icp_brasil()) >= 4, "raizes ICP-Brasil embutidas")

    secao("assinar e verificar")
    assinado = ad.assinar(dados, pfx, "1234", pagina=0,
                          rect=pymupdf.Rect(72, 600, 300, 680),
                          motivo="Concordo com os termos",
                          local="Florianópolis")
    checa(assinado.startswith(dados[:8]) and len(assinado) > len(dados),
          "assinatura por atualizacao incremental")
    checa(assinado[:len(dados)] == dados,
          "os bytes originais ficam intactos (incremental de verdade)")
    lista = ad.verificar(assinado)
    checa_igual(len(lista), 1, "uma assinatura")
    s = lista[0]
    checa(s.integra, "assinatura integra")
    checa(not s.confiavel,
          "autoassinado nao e' confiavel sem a raiz (e nao finge ser)")
    checa_igual(s.titular, "FULANO DE TAL:12345678900", "titular na assinatura")
    checa_igual(s.motivo, "Concordo com os termos", "motivo gravado")
    checa(s.cobre_tudo, "cobre o documento inteiro")
    confiavel = ad.verificar(assinado, raizes_extras=[raiz_asn1(cert)])[0]
    checa(confiavel.confiavel, "confiavel quando a raiz e' conhecida")
    with pymupdf.open("pdf", assinado) as doc:
        checa(doc.get_sigflags() > 0, "o PyMuPDF enxerga o PDF como assinado")
        campos = [w.field_name for w in doc[0].widgets()]
        checa_igual(campos, ["Assinatura1"], "campo de assinatura visivel")
        checa("Contrato" in doc[0].get_text(), "conteudo preservado")

    secao("alteracao depois de assinar")
    with pymupdf.open("pdf", assinado) as doc:
        doc[0].insert_text((72, 300), "clausula inserida depois")
        adulterado = doc.tobytes(incremental=False)
    depois = ad.verificar(adulterado)
    checa(not depois or not depois[0].integra,
          "reescrever o PDF quebra a assinatura")
    # Adulteracao de bytes dentro da area assinada
    i = assinado.find(b"Contrato")
    if i < 0:
        # O texto pode estar comprimido; troca um byte do inicio do stream.
        i = assinado.find(b"stream") + 20
    trocado = assinado[:i] + bytes([assinado[i] ^ 1]) + assinado[i + 1:]
    r = ad.verificar(trocado)
    checa(r and not r[0].integra, "um byte alterado e' detectado")

    secao("segunda assinatura e invisivel")
    duas = ad.assinar(assinado, pfx, "1234", pagina=1, rect=None,
                      motivo="Testemunha")
    lista = ad.verificar(duas)
    checa_igual(len(lista), 2, "duas assinaturas")
    checa(all(x.integra for x in lista), "as duas integras")
    checa_igual([x.campo for x in lista], ["Assinatura1", "Assinatura2"],
                "nome do campo novo nao colide")
    checa(not lista[0].cobre_tudo and lista[1].cobre_tudo,
          "a primeira nao cobre a atualizacao seguinte (e isso e' informado)")

    secao("recusas")
    girado = pymupdf.open("pdf", dados)
    girado[0].set_rotation(90)
    checa_levanta(ValueError, ad.assinar, "assinatura visivel em pagina girada",
                  girado.tobytes(), pfx, "1234", pagina=0,
                  rect=pymupdf.Rect(10, 10, 100, 60))
    protegido = pymupdf.open("pdf", dados).tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="x", owner_pw="x")
    checa_levanta(ValueError, ad.assinar, "PDF com senha", protegido, pfx,
                  "1234")
    checa_levanta(ad.SenhaCertificadoIncorreta, ad.assinar,
                  "senha do certificado errada", dados, pfx, "0000")
    checa_igual(ad.nome_assinado(r"C:\x\contrato.pdf", "contrato.pdf"),
                r"C:\x\contrato_assinado.pdf", "nome do arquivo assinado")
    return resumir()


if __name__ == "__main__":
    sys.exit(main())
