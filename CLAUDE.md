# CLAUDE.md — convenções do EditPDFree

Vale para pessoas e para agentes. Cada regra existe porque a alternativa já
produziu um defeito aqui ou no projeto irmão (TextForgeEdit).

## As regras que não se negociam

**1. Três espaços de coordenadas, uma conversão.** Tela (pixels × zoom),
página girada (`page.rect`) e PDF sem rotação (`page.mediabox`). Anotações,
busca e `get_text` usam o espaço PDF; o render desenha o girado. Toda conversão
passa por `editpdfree/coordenadas.py`. `teste_base.py` confere as quatro
rotações pelo pixel renderizado, e `teste_interface.py` arrasta o mouse numa
página girada.

**2. Tarja é redação de verdade.** `apply_redactions`, nunca um retângulo preto
por cima. O teste confere que o texto sumiu de `get_text` e que os pixels da
imagem sob a tarja mudaram no arquivo salvo.

**3. Renderização preguiçosa.** Nada renderiza todas as páginas. Visualizador e
miniaturas renderizam só o visível; o cache é limitado (`MAX_EM_CACHE`).

**4. PDF aberto é dado.** Nada de `eval`/`exec`/`subprocess(shell=True)`. O
MuPDF não executa o JavaScript embutido.

**5. Gravar é temporário na mesma pasta + `os.replace`.** O original nunca fica
meio escrito. Salvar sem alteração é no-op (não mexe na data do arquivo).

## Armadilhas específicas deste código

| Onde | O quê |
|---|---|
| todo lugar | **`d.doc[i].add_*_annot(...)` numa linha só dá "annotation not bound to any page"** (ou falha de acesso) no próximo uso: a anotação guarda só uma referência FRACA à página, e a página temporária é coletada na hora. Sempre `p = d.doc[i]` numa variável enquanto usar a anotação. Vale para `load_annot`, `first_annot`, `annots()`. |
| `visualizador.py` | `QImage(pix.samples, ...)`: o QImage NÃO copia o buffer. Guardar `pix.samples` numa variável até o `copy()`; senão é lixo na tela ou falha de acesso. |
| `documento.py` | O documento é aberto de **bytes** (`stream=`), não do caminho: pelo caminho o MuPDF segura o arquivo e o `os.replace` do salvar falha no Windows. |
| `documento.py` | Depois de autenticar, o MuPDF grava **sem criptografia** (`PDF_ENCRYPT_KEEP` não adianta). Editar um PDF protegido e salvar tirava a senha em silêncio. Por isso `_protecao` guarda a criptografia original e `_opcoes_gravar` a reaplica. |
| `documento.py` | Desfazer guarda **instantâneos em bytes** (sem criptografia, só na memória), limitados a `NIVEIS_DESFAZER`. Operação inversa de uma redação não existe. Operação que levanta exceção volta ao estado anterior e não entra na pilha. |
| `anotacoes.py` | Mover anotação mexe direto em `/Rect` (e `/L`, `/Vertices`, `/InkList`, `/CL`) e **não** chama `update()`: a aparência é mapeada sobre o `/Rect`, então ela se move intacta. O arquivo guarda y de baixo para cima — o `dy` entra com sinal trocado. O PyMuPDF não tem `set_ink_list`. |
| `anotacoes.py` | `insert_image` em página girada usa `rotate=page.rotation` (conferido renderizando: com `-rotation` a imagem sai de cabeça para baixo numa página a 90°). |
| `extras.py` | Marca d'água: `morph=(ponto, Matrix(angulo))` com ângulo POSITIVO sobe para a direita na tela. O sinal foi conferido renderizando. |
| `texto.py` | Editar redige a caixa da linha **encolhida 20% na vertical**: as caixas de linhas vizinhas se sobrepõem, e a caixa inteira arrancava pedaço da linha de cima. |
| `aba.py` | Pedidos ao usuário passam pelas funções `pedir_*`/`avisar`/`confirmar` do módulo — os testes as trocam. Um diálogo modal em modo offscreen trava a suíte para sempre. |
| `aba.py` | `_executar` devolve `FALHOU` (não `None`) quando a operação dá erro: `None` é retorno normal do núcleo. |
| `aba.py` | Ao fechar a aba, parar os temporizadores e soltar o documento **antes** de fechá-lo; senão um render agendado dispara num PDF fechado. |
| `miniaturas.py` | `ListMode`, não `IconMode`: no `IconMode` arrastar só muda a posição desenhada, não a ordem das linhas. |
| `app.py` | A autoverificação usa `exigir()`, não `assert`: o `.spec` empacota com `optimize=1`, que remove os asserts. |
| `idioma.py` | Os `QTranslator` ficam em `app._tradutores`; numa variável local o coletor os destrói e os botões voltam ao inglês. O `.spec` inclui os `.qm`. |
| testes | `drenar_eventos()` e `encerrar()` (zera o modificado antes de fechar). `preparar_qt()` isola `%APPDATA%` para o processo inteiro. |
| textos de tela | **Acentuados**, sempre. Comentário e docstring podem ser ASCII. `teste_base.py` varre o fonte. |

## Ao alterar

1. Rodar `tests\rodar_todos.py`.
2. Incrementar a versão em **dois** lugares: `editpdfree/__init__.py` (`VERSAO`)
   e `versao.txt` (`filevers`/`prodvers` e `FileVersion`/`ProductVersion`).
   `teste_base.py` confere que batem.
3. `build.bat` (gera e autoverifica o `.exe`), commit, push, release com o ZIP.
