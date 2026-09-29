# EditPDFree

Editor de PDF gratuito e de código aberto para Windows, em português.

![versão](https://img.shields.io/badge/vers%C3%A3o-0.1.0-blue) ![licença](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-green)

## O que faz

**Páginas**
- Girar, excluir, duplicar, mover e reordenar (arrastando as miniaturas)
- Inserir página em branco, outro PDF ou uma imagem como página
- Extrair páginas para um novo PDF, dividir o documento (a cada N páginas ou por intervalos como `1-3, 5, 8-`)
- Juntar vários PDFs e imagens num só

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

**Documento**
- Preencher formulários, criar campos de texto e caixas de seleção, achatar
- **Tarjar de verdade**: remove o texto e os pixels de imagem da área, não é um retângulo preto por cima
- Tarjar todas as ocorrências de um texto (um CPF, por exemplo)
- Proteger com senha (AES-256) e permissões, ou remover a senha
- Marca d'água, numeração de páginas, compressão de imagens
- Exportar páginas como PNG ou JPG, editar título/autor/assunto

Desfazer/refazer (Ctrl+Z / Ctrl+Y) vale para todas as operações. Arraste PDFs para a janela para abri-los.

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
- Um PDF protegido só por senha de proprietário (abre sem senha) perde essas restrições ao ser salvo, porque a senha de proprietário não é conhecida.

## Licença

[AGPL-3.0](LICENSE). O motor de PDF é o [PyMuPDF](https://github.com/pymupdf/PyMuPDF)/MuPDF (AGPL-3.0); a interface usa [Qt for Python](https://doc.qt.io/qtforpython/) (LGPL-3.0).
