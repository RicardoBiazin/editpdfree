# EditPDFree

Editor de PDF gratuito e de código aberto para Windows, em português.

![versão](https://img.shields.io/badge/vers%C3%A3o-0.5.0-blue) ![licença](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-green)

## O que faz

**Páginas**
- Girar, excluir, duplicar, mover e reordenar (arrastando as miniaturas)
- Inserir página em branco, outro PDF ou uma imagem como página
- Extrair páginas para um novo PDF, dividir o documento (a cada N páginas ou por intervalos como `1-3, 5, 8-`)
- Juntar vários PDFs, imagens e documentos do Office num só, **escolhendo a ordem**: miniatura de cada arquivo, arrastar para reordenar (ou soltar arquivos do Explorer), ordenar por nome ou data, inverter, escolher as páginas de cada arquivo e criar um marcador por arquivo; inclui as abas já abertas

**Texto**
- **Editar o texto que já está no PDF**: clique numa linha, altere o texto, o tamanho e a cor
- Adicionar texto novo em qualquer ponto da página
- Substituir um texto em todo o documento
- Localizar com realce dos resultados (Ctrl+F)
- Extrair todo o texto para `.txt`

**Anotações e desenho**
- Caixa de texto, nota, destacar, sublinhar, tachar
- Caneta à mão livre, retângulo, elipse, linha e seta, com cor, espessura e opacidade
- Imagem e assinatura (desenhada com o mouse ou a partir de uma imagem)
- Selecionar uma anotação para movê-la (arrastar) ou excluí-la (Delete)

**Assinatura digital (ICP-Brasil)**
- Assinar com certificado A1 (`.pfx`/`.p12`) no padrão PAdES: visível (na área desenhada) ou invisível. O Adobe e o validador do ITI mostram "assinado por…"
- O documento assinado é salvo como arquivo novo, por atualização incremental; qualquer alteração posterior invalida a assinatura
- Verificar as assinaturas de um PDF: íntegra (nada mudou) e confiável (cadeia ICP-Brasil — as raízes do ITI vêm junto)

**OCR**
- Reconhecer o texto de PDFs escaneados (português e inglês), sem instalar nada: a página continua igual e passa a permitir busca, seleção, cópia e tarja

**Converter**
- Abrir DOCX, XLSX, PPTX, TXT, HTML, EPUB e imagens direto como PDF (usa o LibreOffice se estiver instalado, para mais fidelidade)
- PDF para Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`, as tabelas), Markdown, imagens e texto
- Extrair todas as imagens embutidas no formato original

**Produtividade**
- Processar em lote: OCR, girar, marca d'água, numeração, rodapé, compressão e senha numa pasta inteira (os originais não são alterados)
- Comparar duas versões de um PDF lado a lado, com as diferenças destacadas e listadas
- Recortar páginas (por margens ou desenhando a área) e redimensionar (A4, A3, A5, Carta, Ofício)
- Cabeçalho e rodapé com `{n}`, `{total}`, `{arquivo}` e `{data}`; carimbos prontos (APROVADO, CÓPIA, PAGO, RECEBIDO…)
- Marcadores (sumário lateral) e links para páginas ou sites
- Imprimir (Ctrl+P)
- Digitalizar do scanner (qualquer aparelho com driver WIA, inclusive multifuncionais em rede)
- Reparar PDF danificado, com relatório do que foi recuperado
- Converter para PDF/A-2b (arquivamento): perfil de cor, metadados XMP, sem JavaScript — e avisa o que não deu para corrigir
- Marca d'água de imagem (centralizada ou lado a lado, na frente ou atrás)
- Detectar campos de formulário automaticamente (sublinhados, linhas de preenchimento, quadrados)

**Documento**
- Preencher formulários, criar campos de texto e caixas de seleção, achatar
- **Tarjar de verdade**: remove o texto e os pixels de imagem da área, não é um retângulo preto por cima
- Tarjar todas as ocorrências de um texto (um CPF, por exemplo)
- Proteger com senha (AES-256) e permissões, ou remover a senha
- Marca d'água, numeração de páginas, compressão de imagens
- Exportar páginas como PNG ou JPG, editar título/autor/assunto

Desfazer/refazer (Ctrl+Z / Ctrl+Y) vale para todas as operações. Qualquer item dos menus pode virar botão na **barra de atalhos** (Exibir › Personalizar barra de atalhos, ou botão direito numa barra). Arraste PDFs para a janela para abri-los.

## Versão web

Também dá para usar no navegador, sem instalar: **https://editpdfree.netlify.app** — o PDF é processado no seu computador e nunca é enviado a servidor nenhum. Código em [`web/`](web/).

## Instalar

Baixe o ZIP da [última versão](https://github.com/RicardoBiazin/editpdfree/releases/latest), extraia e execute `EditPDFree\EditPDFree.exe`. Não precisa instalar nada.

## Rodar do código-fonte

Requer Python 3.13.

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py [arquivo.pdf]
```

Testes (sem pytest, cada suíte num processo):

```
.venv\Scripts\python.exe tests\rodar_todos.py
```

Gerar o executável (roda os testes, empacota, faz a autoverificação do `.exe` e gera o ZIP):

```
build.bat              :: dist\EditPDFree\ + dist\EditPDFree-<versão>-win64.zip
build.bat umarquivo    :: dist\EditPDFree.exe portátil
```

## Limitações conhecidas

- Ao editar um texto existente, o texto novo usa a fonte padrão mais parecida (Helvetica, Times ou Courier). A fonte original quase sempre vem embutida só com as letras usadas e não serve para letras novas.
- Só é possível editar texto horizontal.
- Salvar um PDF assinado digitalmente invalida a assinatura (o programa avisa antes).
- A assinatura digital não consulta revogação (LCR/OCSP) nem acrescenta carimbo de tempo; para a validação jurídica completa use o [validador do ITI](https://validar.iti.gov.br). A assinatura visível não funciona em página girada (use a invisível).
- PDF para Word reconstrói parágrafos, fontes e imagens, mas não tabelas nem colunas. PDF para PowerPoint põe a página como imagem de fundo com o texto editável por cima. PDF para Excel só leva o que for reconhecido como tabela.
- PDF/A: fontes não embutidas (as 14 padrão, como Helvetica) impedem a conformidade; o programa lista essas pendências. Para certificar, use um validador como o veraPDF.
- Sem LibreOffice, DOCX/XLSX/PPTX são diagramados pelo MuPDF: tabelas complexas e fontes específicas podem mudar.
- Um PDF protegido só por senha de proprietário (abre sem senha) perde essas restrições ao ser salvo, porque a senha de proprietário não é conhecida.

## Licença

[AGPL-3.0](LICENSE). O motor de PDF é o [PyMuPDF](https://github.com/pymupdf/PyMuPDF)/MuPDF (AGPL-3.0); a interface usa [Qt for Python](https://doc.qt.io/qtforpython/) (LGPL-3.0); a assinatura, o [pyHanko](https://github.com/MatthiasValvekens/pyHanko) (MIT); o OCR, os dados do [Tesseract](https://github.com/tesseract-ocr/tessdata_fast) (Apache-2.0).
