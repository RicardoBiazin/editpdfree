# EditPDFree para navegador

A versão web do [EditPDFree](https://github.com/RicardoBiazin/editpdfree): um editor de PDF gratuito e de código aberto, em português, que roda **inteiro no navegador**.

**Seus arquivos não saem do seu computador.** O PDF é aberto, editado e salvo aqui mesmo, pelo [MuPDF](https://mupdf.com) compilado para WebAssembly ([MuPDF.js](https://www.npmjs.com/package/mupdf)). Não há servidor recebendo arquivos, nem analytics, nem requisição externa: fontes, ícones e o motor `.wasm` são servidos pelo próprio site. Depois da primeira visita o app funciona sem internet (PWA instalável).

## O que faz

**Abrir e salvar**
- Abrir PDF pelo botão ou arrastando o arquivo para a janela; imagem (PNG, JPEG, GIF, BMP, TIFF, WebP) vira um PDF de uma página
- PDF com senha: pede a senha; ao salvar, continua protegido com a mesma senha (a menos que você a remova)
- Salvar baixa o PDF editado com o mesmo nome do original; opcionalmente com senha (AES-256)

**Visualizar**
- Rolagem contínua, zoom (botões, Ctrl+roda do mouse, Ctrl+/Ctrl−, ajustar à largura), indicador e salto de página, miniaturas
- Só as páginas visíveis são desenhadas, com cache limitado; o trabalho pesado roda num Web Worker e a tela não trava

**Páginas** (sobre a página atual ou as miniaturas selecionadas com Ctrl/Shift+clique)
- Girar à esquerda/direita, excluir, duplicar, inserir página em branco
- Reordenar arrastando as miniaturas (no toque: segure e arraste)
- Inserir outro PDF ou imagem (também soltando o arquivo sobre as miniaturas)
- Extrair páginas para um novo PDF; dividir a cada N páginas ou por intervalos como `1-3, 5, 8-`, baixando um `.zip`

**Anotações** — com cor, espessura e opacidade
- Caixa de texto, nota, destacar/sublinhar/tachar (arraste sobre o texto: uma marcação por linha, só nas palavras tocadas), caneta à mão livre, retângulo, elipse, linha, seta
- Selecionar uma anotação para movê-la (arrastar) ou excluí-la (Delete ou o botão “Excluir”)

**Documento**
- Assinatura desenhada com mouse, dedo ou caneta (ou a partir de uma imagem), posicionada com um clique e lembrada no navegador
- **Tarja de verdade**: arraste sobre a área e o texto e os pixels de imagem embaixo são **removidos do arquivo** — não é um retângulo preto por cima. Também “tarjar todas as ocorrências de um texto” (um CPF, por exemplo)
- Localizar (Ctrl+F) com realce dos resultados e anterior/próximo (sem diferenciar maiúsculas nem acentos)
- Preencher formulários existentes: texto, caixa de seleção, opção, lista
- Adicionar texto no conteúdo da página (Helvetica, Times ou Courier)
- **Editar uma linha de texto existente**: clique na linha, altere o texto, o tamanho e a cor
- Marca d’água e numeração de páginas; extrair o texto para `.txt`

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
                        # PDF com senha, salvar (e confere o arquivo baixado), modo offline e 390 px
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
| `test/` | Testes (`node --test`) |

Dependências: só `mupdf` (em tempo de execução), `vite` e `typescript` (desenvolvimento).

## Publicar no Netlify

O `netlify.toml` já configura: build `npm run build`, pasta `dist`, `.wasm` com `Content-Type: application/wasm`, cache longo para `/assets/*`, `sw.js` sem cache, e cabeçalhos de segurança — inclusive uma CSP que só permite script do próprio site mais `'wasm-unsafe-eval'` (necessário para o WebAssembly).

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

- Não tem (ainda): criar campos de formulário, achatar formulário, comprimir imagens, exportar páginas como PNG/JPG, editar título/autor, substituir um texto em todo o documento, escolher permissões ao proteger (com senha de proprietário informada, quem abre com a senha comum pode imprimir e copiar, mas não alterar; sem ela, a senha única libera tudo).
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

## Licença

[AGPL-3.0](../LICENSE), como o EditPDFree desktop. Código-fonte: <https://github.com/RicardoBiazin/editpdfree>. O motor de PDF é o MuPDF.js (AGPL-3.0), da Artifex Software.
