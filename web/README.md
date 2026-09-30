# EditPDFree para navegador

A versão web do [EditPDFree](https://github.com/RicardoBiazin/editpdfree): um editor de PDF gratuito e de código aberto, em português, que roda **inteiro no navegador**.

**Seus arquivos não saem do seu computador.** O PDF é aberto, editado e salvo aqui mesmo, pelo [MuPDF](https://mupdf.com) compilado para WebAssembly ([MuPDF.js](https://www.npmjs.com/package/mupdf)). Não há servidor recebendo arquivos, nem analytics, nem requisição externa: fontes, ícones, o motor `.wasm` e o OCR são servidos pelo próprio site. Depois da primeira visita o app funciona sem internet (PWA instalável).

Versão **0.3.0**.

## O que faz

**Abrir e salvar**
- Abrir PDF pelo botão ou arrastando o arquivo para a janela; imagem (PNG, JPEG, GIF, BMP, TIFF, WebP) vira um PDF de uma página
- **Word, Excel, PowerPoint (DOCX/XLSX/PPTX), HTML, EPUB, TXT, XPS, FB2, CBZ e SVG** também abrem: o MuPDF diagrama o documento e ele vira PDF
- Arquivo danificado é reparado ao abrir (o app avisa); “Reparar um PDF danificado” grava uma cópia limpa e diz quantas páginas foram recuperadas
- **Digitalizar com a câmera** (celular/tablet: câmera traseira): captura várias páginas, recorta as bordas da folha, realça o contraste (cinza, preto e branco ou cor), deixa reordenar/excluir e monta o PDF
- PDF com senha: pede a senha; ao salvar, continua protegido com a mesma senha (a menos que você a remova)
- Salvar baixa o PDF editado com o mesmo nome do original; opcionalmente com senha (AES-256)

**Visualizar**
- Rolagem contínua, zoom (botões, Ctrl+roda do mouse, Ctrl+/Ctrl−, ajustar à largura), indicador e salto de página, miniaturas
- Painel de **marcadores** (índice do PDF) e **links** clicáveis (internos vão para a página; externos pedem confirmação)
- Só as páginas visíveis são desenhadas, com cache limitado; o trabalho pesado roda num Web Worker e a tela não trava

**Páginas** (sobre a página atual ou as miniaturas selecionadas com Ctrl/Shift+clique)
- Girar à esquerda/direita, excluir, duplicar, inserir página em branco
- Reordenar arrastando as miniaturas (no toque: segure e arraste)
- Inserir outro PDF ou imagem (também soltando o arquivo sobre as miniaturas)
- Extrair páginas para um novo PDF; dividir a cada N páginas ou por intervalos como `1-3, 5, 8-`, baixando um `.zip`
- **Recortar**: arrastando a área que fica visível (ferramenta) ou por margens em milímetros, na página atual ou em todas — as margens valem como a página aparece na tela, mesmo girada

**Anotações** — com cor, espessura e opacidade
- Caixa de texto, nota, destacar/sublinhar/tachar (arraste sobre o texto: uma marcação por linha, só nas palavras tocadas), caneta à mão livre, retângulo, elipse, linha, seta
- **Carimbos** (APROVADO, PAGO, CÓPIA, CONFIDENCIAL… ou um texto seu), de pé em qualquer rotação da página
- Selecionar uma anotação para movê-la (arrastar) ou excluí-la (Delete ou o botão “Excluir”)

**Documento**
- Assinatura desenhada com mouse, dedo ou caneta (ou a partir de uma imagem), posicionada com um clique e lembrada no navegador
- **Tarja de verdade**: arraste sobre a área e o texto e os pixels de imagem embaixo são **removidos do arquivo** — não é um retângulo preto por cima. Também “tarjar todas as ocorrências de um texto” (um CPF, por exemplo)
- Localizar (Ctrl+F) com realce dos resultados e anterior/próximo (sem diferenciar maiúsculas nem acentos)
- Preencher formulários existentes: texto, caixa de seleção, opção, lista
- **Criar campos** de texto e caixas de seleção arrastando na página, e **detectar campos** automaticamente (sequências de `____`, rótulos terminados em “:” com espaço livre depois, quadradinhos vazios): as sugestões aparecem na página para você desmarcar o que não quiser antes de criar
- Adicionar texto no conteúdo da página (Helvetica, Times ou Courier)
- **Editar uma linha de texto existente**: clique na linha, altere o texto, o tamanho e a cor
- **Substituir um texto em todo o documento** (cada ocorrência é apagada de verdade e reescrita no mesmo lugar)
- Marca d’água de texto e **de imagem** (opacidade, centralizada ou em mosaico, por cima ou por baixo do conteúdo)
- Numeração, **cabeçalho e rodapé** com `{n}`, `{total}`, `{arquivo}` e `{data}`
- **Propriedades** (título, autor, assunto, palavras-chave)

**Ferramentas**
- **Juntar PDFs** (tela de início, menu Páginas ou Ferramentas; funciona sem documento aberto): adicione vários arquivos (botão ou arrastando para a janela do Juntar) — PDF, imagens e documentos (Word, Excel, PowerPoint, HTML, EPUB, TXT). Cada item mostra a miniatura da primeira página, o nome, o número de páginas e o tamanho, e aceita um intervalo próprio (`1-3, 5, 8-`; vazio = todas), validado na hora. A ordem se muda arrastando (no toque: segure e arraste), pelos botões ↑/↓, por Alt+↑/↓, “Ordenar por nome” (ordem natural: `doc2` antes de `doc10`, sem diferenciar acentos), “Ordenar por data” ou “Inverter ordem”. PDF com senha pede a senha no próprio item. Se houver um documento aberto, ele entra como primeiro item (com as alterações ainda não salvas). Opção de criar um marcador para cada arquivo. O resultado abre no editor como `juntado.pdf`, ainda não salvo — ou “Baixar direto”
- **Comprimir** em 3 níveis — Leve (150 dpi), Recomendada (110 dpi) e Máxima (72 dpi), os mesmos do desktop — com o **tamanho estimado de cada opção** antes de escolher: reamostra as imagens maiores que o necessário, regrava como JPEG só quando fica menor, enxuga fontes e objetos repetidos; mostra o tamanho antes → depois
- **Reconhecer texto (OCR)** em PDF escaneado, com o [tesseract.js](https://github.com/naptha/tesseract.js) (português e/ou inglês): o texto entra **invisível** na posição de cada palavra, então buscar, selecionar, copiar e tarjar passam a funcionar. Carregado só quando usado
- **Comparar dois PDFs** palavra a palavra, no documento inteiro (não página contra página): os dois lado a lado, removido em vermelho, inserido em verde, e a lista clicável das diferenças
- **Converter**: para Word (`.docx`), Markdown (`.md`, com títulos pelo tamanho da fonte, negrito/itálico, listas e separador de página), texto (`.txt`), páginas como JPG/PNG na resolução escolhida (`.zip`) e extrair as imagens embutidas no formato original (`.zip`)

Desfazer/refazer (Ctrl+Z / Ctrl+Y) vale para todas as operações.

## Rodar

Requer Node.js 22 ou mais novo (testado com o 24).

```
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm test           # testes das operações de PDF (node --test, sem navegador)
npm run build      # gera dist/ (site estático)
npm run preview    # serve dist/ com a mesma CSP do netlify.toml
```

Opcionais, se houver Chrome ou Edge instalado (sem janela, via DevTools Protocol, sem dependências):

```
npm run fumaca          # abre o app de verdade e exercita abrir, anotar, mover, desfazer, girar,
                        # buscar, tarjar, editar texto, assinar, reordenar, dividir, formulário,
                        # PDF com senha, salvar (e confere o arquivo baixado), TXT->PDF, comprimir,
                        # exportar imagens, Word, Markdown, recortar, carimbo, propriedades,
                        # substituir, comparar, reparar, detectar/criar campos, marca d'água de
                        # imagem, OCR, câmera (câmera falsa do Chrome), juntar PDFs (3 arquivos +
                        # o aberto, arrastar, Alt+seta, ordenar por nome, intervalo), modo
                        # offline e 390 px;
                        # e confere que nenhuma requisição saiu para outro site
npm run fumaca:portao   # o mesmo, passando antes pelo portão anti-robô
npm run fumaca -- --dev # contra o `vite dev`
```

Os testes geram os PDFs de teste na hora — não há arquivo binário de teste no repositório.

## Organização

| Caminho | O quê |
|---|---|
| `src/core/` | As operações de PDF, puras, usadas pelo worker **e** pelos testes no Node |
| `src/core/coordenadas.ts` | A única conversão tela ↔ página ↔ PDF (testada nas rotações 0/90/180/270) |
| `src/worker.ts` | O Web Worker que segura o documento e atende os pedidos da interface |
| `src/main.ts`, `src/ui/` | A interface (TypeScript puro, sem framework) |
| `src/sw-modelo.js` | Modelo do service worker; o build gera `dist/sw.js` com a lista exata dos arquivos |
| `src/portao/`, `netlify/edge-functions/portao.ts` | O portão anti-robô |
| `scripts/icones.mjs` | Gera os ícones (SVG, PNG e `favicon.ico`) sem dependência; roda em todo build |
| `scripts/ocr-arquivos.mjs` | Copia o worker, o núcleo WASM e os idiomas do tesseract.js para `public/ocr/` (gerado, fora do git) |
| `test/` | Testes (`node --test`) |

Dependências em tempo de execução: `mupdf` (AGPL-3.0), `tesseract.js` (Apache-2.0, carregado só no OCR) e os idiomas `@tesseract.js-data/por` e `@tesseract.js-data/eng` (MIT; modelos do Tesseract, Apache-2.0). Desenvolvimento: `vite` e `typescript`.

## Publicar no Netlify

O `netlify.toml` já configura: build `npm run build`, pasta `dist`, `.wasm` com `Content-Type: application/wasm`, cache longo para `/assets/*`, `sw.js` sem cache, e cabeçalhos de segurança — inclusive uma CSP que só permite script do próprio site mais `'wasm-unsafe-eval'` (necessário para o WebAssembly).

**Mudanças de cabeçalho na 0.2:**
- A **CSP não mudou.** O tesseract.js é criado com `workerBlobURL: false` (o worker vem de `/ocr/worker.min.js`, não de um `blob:`), o núcleo tem o `.wasm` embutido e roda com o `'wasm-unsafe-eval'` que já existia, e os idiomas vêm de `/ocr/lang/` (`connect-src 'self'`).
- `Permissions-Policy`: `camera=()` passou a `camera=(self)` — necessário para “Digitalizar com a câmera”. Só o próprio site pode pedir a câmera, e o navegador ainda pergunta ao usuário.
- `/ocr/*` com cache de 7 dias e `/ocr/lang/*` como `application/octet-stream` (os idiomas já são `.gz` e o tesseract os descompacta; não pode haver `Content-Encoding` por cima).

**Tamanho:** o app em si tem ~75 KB de JS principal + ~145 KB do worker + o motor `.wasm` de ~10 MB (~3,6 MB comprimido). O OCR fica em `dist/ocr/` (~15 MB no disco, com 3 variantes do núcleo), mas só é baixado quando alguém usa o OCR: o worker (~27 KB comprimido), **uma** variante do núcleo (~1,1 MB comprimido) e o idioma (português ~1,4 MB; inglês ~2,9 MB). Não entra no pré-cache do service worker; fica guardado para uso offline depois do primeiro uso.

### Portão anti-robô

Para que robôs não usem a versão online, uma **Edge Function** (`netlify/edge-functions/portao.ts`) fica na frente de tudo, **sem serviço de terceiros** (nada de reCAPTCHA ou Cloudflare):

1. Quem chega sem o cookie `epf_passe` válido recebe a página “Verificando que você não é um robô…”. O navegador resolve uma prova de trabalho (achar um número que faça o SHA-256 começar com 21 bits zero — cerca de 1 s num PC, alguns segundos num celular) e envia a resposta para `/__portao/verificar`.
2. A função confere a assinatura e a validade do desafio (5 minutos) e o trabalho, e grava o cookie `epf_passe` (`HttpOnly; Secure; SameSite=Lax`), válido por **7 dias** e só para aquele navegador (vai amarrado a um hash do User-Agent). A página recarrega o endereço original.
3. Pedidos de arquivos (JS, wasm…) sem o cookie levam **403**. Ficam livres só `robots.txt`, `favicon.ico`, `manifest.webmanifest` e `/icons/*` (o navegador pede o ícone e o manifesto sem cookie).
4. Sem JavaScript, a página explica que ele é necessário.

Depois da primeira passagem, o service worker serve o app do cache: **offline continua funcionando**, mesmo com o cookie vencido.

**Configurar o segredo** (32 bytes aleatórios ou mais; gere um e guarde só no Netlify):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
netlify env:set PORTAO_SEGREDO <valor gerado>
```

Sem `PORTAO_SEGREDO`, o portão **fecha** (erro 500 com mensagem clara) em produção, deploy preview e branch deploy — falhar aberto deixaria robôs passarem sem ninguém notar. Só no `netlify dev` (contexto `dev`) ele fica aberto, para desenvolver.

**Limitações conhecidas do portão:**
- Não há estado no servidor, então não há proteção contra reuso: um desafio resolvido pode ser trocado por cookies várias vezes dentro dos seus 5 minutos.
- Trocar de navegador ou atualizar o navegador (muda o User-Agent) pede a verificação de novo.
- É uma barreira de custo, não um bloqueio absoluto: um robô disposto a gastar CPU passa.
- **O portão também impede a indexação por buscadores**: além do desafio, há `robots.txt` com `Disallow: /`, o cabeçalho `X-Robots-Tag: noindex, nofollow` e a meta tag `robots`. O site não aparece no Google — de propósito.

Para testar o portão localmente sem publicar: `npm run build && npm run portao:local` (serve `dist/` atrás da Edge Function, com um segredo de teste fixo).

## Limitações em relação ao desktop

- Não tem (ainda): achatar formulário, criar campos de lista/opção, editar marcadores, escolher permissões ao proteger (com senha de proprietário informada, quem abre com a senha comum pode imprimir e copiar, mas não alterar; sem ela, a senha única libera tudo).
- **Assinatura digital com certificado não existe**: o MuPDF.js 1.28 não tem API de assinatura (conferido no `mupdf.d.ts`). A “Assinatura” do app é a imagem da sua assinatura.
- **PDF → Word** é reconstrução aproximada (o MuPDF.js do npm vem sem o escritor DOCX, então o `.docx` é montado pelo app): parágrafos com fonte, tamanho, negrito/itálico e cor, imagens na ordem e quebra de página. Não reconstrói tabelas nem colunas.
- **Office → PDF** tem a fidelidade de um leitor, não a do Word: tabelas complexas e fontes específicas podem mudar (sem LibreOffice no navegador).
- **Comprimir** não mexe em imagens JPEG que já estão na resolução certa (regravar só perderia qualidade) e só troca uma imagem se o resultado ficar menor. Máscaras de transparência ficam como estavam.
- **OCR**: só português e inglês; a qualidade depende da digitalização (~250 dpi internamente). Letras fora do Latin-1 viram “?” na camada de texto. Páginas que já têm texto são puladas.
- **Detectar campos** é heurística: confira as sugestões antes de criar.
- **Câmera**: recorte simples pelas bordas claras da folha sobre fundo mais escuro; não corrige perspectiva (fotografe de cima). Só em HTTPS/localhost.
- **Comparar** compara o texto (palavras), não o desenho: imagens e formatação não entram na comparação.
- **Juntar PDFs**: anotações, campos de formulário e marcadores de cada arquivo vêm junto. Campo em hierarquia (`pai.filho`) vira um campo de primeiro nível com o nome completo (`pai_filho`); nome que já existe no resultado ganha sufixo (`nome_2`), para que dois arquivos com o mesmo campo não passem a ser preenchidos juntos (grupos de botões de opção continuam agrupados). Links internos (de uma página para outra) não vêm junto, e o resultado sai sem senha e sem assinatura digital.
- **Carimbo**: a aparência é desenhada pelo app; outros leitores a mostram igual, mas se alguém “regenerar” a anotação noutro programa ela pode virar o carimbo padrão dele.
- Salvar é **baixar**: o navegador não sobrescreve o arquivo original.
- Texto novo e texto editado usam as fontes padrão do PDF (Helvetica, Times, Courier), com os caracteres do Latin-1 (acentos do português, aspas, travessão e euro funcionam; letras de outros alfabetos viram “?”). Só dá para editar texto horizontal. A fonte original quase sempre vem embutida só com as letras usadas e não serve para letras novas — a mesma limitação do desktop.
- Duplicar uma página ou inserir outro PDF leva as anotações, mas **não** os campos de formulário nem os links internos da página copiada (dependem do documento de origem). Extrair e dividir preservam tudo.
- Desfazer guarda uma cópia do PDF inteiro na memória a cada operação (até 30 níveis ou 600 MB): num PDF muito grande cada operação fica mais lenta, e o celular pode ficar sem memória.
- A busca devolve no máximo 500 resultados por página.
- Um PDF aberto com senha é salvo com essa mesma senha para abrir e como senha de proprietário. Um PDF protegido só por senha de proprietário (abre sem senha) perde essas restrições ao ser salvo — como no desktop.
- Salvar um PDF assinado digitalmente invalida a assinatura (o app avisa antes).
- O motor `.wasm` tem ~10 MB (~3,6 MB comprimido); a primeira visita demora um pouco mais, as seguintes vêm do cache.

## Notas técnicas (MuPDF.js 1.28)

Coisas que custaram um experimento e estão comentadas no código:

- **Coordenadas:** no MuPDF.js a API de anotações (`setRect`, `setLine`, `setInkList`, `setQuadPoints`), o texto estruturado, a busca e o render usam **o mesmo espaço**: a página como o leitor a vê (já girada, y para baixo). Diferente do PyMuPDF do desktop, em que anotações usam o espaço sem rotação. O espaço PDF do arquivo só aparece ao escrever no conteúdo da página ou ao mexer direto em `/Rect`, `/L`, `/InkList` — e aí passa por `page.getTransform()`.
- **Senha:** o padrão do MuPDF.js é **manter** a criptografia de um documento autenticado ao gravar (o PyMuPDF fazia o contrário). Os instantâneos do desfazer e o “remover senha” precisam pedir `encrypt=none`. Senha com vírgula é recusada: as opções de gravação são `chave=valor,chave=valor` sem escape.
- `rearrangePages([0, 0])` aceita página repetida, mas as “cópias” são o mesmo objeto; por isso duplicar enxerta de uma cópia do documento.
- `graftPage` não copia as anotações; `enxertarPagina` (em `paginas.ts`) as copia.
- `getRect()` levanta exceção em anotação sem `/Rect` próprio (tinta, linha); use `getBounds()`.
- A busca diferencia maiúsculas por padrão (`ignore-case` e `ignore-diacritics` são opções).
- `Buffer.asUint8Array()` e `Pixmap.getPixels()` são vistas da memória do WASM: copiar antes de guardar ou transferir.
- A tarja usa `applyRedactions` com `REDACT_IMAGE_PIXELS` e `REDACT_LINE_ART_REMOVE_IF_TOUCHED` (como o desktop); editar texto redige só o texto da linha, com a caixa encolhida 20% na vertical para não morder as linhas vizinhas.
- **Gravar com `garbage=` renumera os objetos do documento aberto** e deixa inválidas as referências (`PDFObject`) guardadas antes (“object is not a stream” no Comprimir). O arquivo final é gravado a partir de uma cópia (`Sessao.gravarCopia`); o documento aberto nunca passa por coleta de lixo.
- O stream de um objeto é do objeto **indireto**: `readRawStream`/`writeRawStream` pela referência, não pelo `resolve()`.
- Depois de pôr um widget direto no `/Annots`, a página já carregada não o enxerga: é preciso regravar e reabrir o documento (`Sessao.recarregar`).
- `setPageBox("CropBox", r)` recebe o retângulo no espaço da página como o leitor vê e o converte sozinho.
- Carimbo com aparência própria: `setContents` **antes** de `setAppearance` e nada de `update()` depois — senão o MuPDF redesenha o carimbo padrão (“DRAFT”) por cima.
- O `.wasm` do npm abre DOCX/XLSX/PPTX/HTML/EPUB/TXT, mas não tem escritor DOCX nem OCR (“DOCX/ODT writer not enabled”, “No OCR support in this build”).
- `page.search(texto, opções)` devolve no máximo 500 quads por página; “tarjar todas as ocorrências” repete a busca até não sobrar nenhuma.

## Licença

[AGPL-3.0](../LICENSE), como o EditPDFree desktop. Código-fonte: <https://github.com/RicardoBiazin/editpdfree>. O motor de PDF é o MuPDF.js (AGPL-3.0), da Artifex Software. O OCR usa o tesseract.js e o tesseract.js-core (Apache-2.0) e os modelos de idioma do Tesseract (Apache-2.0, empacotados pelo projeto tesseract.js-data sob MIT).
