# Implementação DEV AI com Puter.js

## Funcionalidades Concluídas:
1. **Integração com Puter.js**:
   - SDK Puter.js (`@heyputer/puter.js`) integrado diretamente no cliente web e injetado via script global `https://js.puter.com/v2/`.
   - Streaming em tempo real através de `puter.ai.chat(messages, { model, stream: true })`.
   - Geração de imagens com IA com `puter.ai.txt2img(prompt, { aspect_ratio })`.
   - Respostas instantâneas com eliminação das restrições de cota do Google Free Tier (429 RESOURCE_EXHAUSTED).
   - Fallback resiliente para o backend Gemini 3 caso Puter.js esteja indisponível.

2. **Visualização de Anexos e Imagens**:
   - Arquivos e fotos anexadas são renderizados **fora e abaixo** do balão de texto do usuário, em cards de alta resolução com cantos arredondados e suporte a clique para expandir.
   - O balão de texto do usuário agora contém exclusivamente o texto digitado.
   - Extração de `rawText` para arquivos de código e texto para leitura total pela IA.

3. **Controle de Leitura de Mensagens Longas (> 10 linhas)**:
   - Verificação inteligente de quebras de linha (`lineCount > 10` ou texto extenso).
   - Botão expansível interativo de "Ver mais ▼" e "Ver menos ▲" com degradê suave.

4. **Painel de Fontes & Pesquisa (Estilo ChatGPT)**:
   - Botão de "Fontes" posicionado ao lado do menu de 3 pontinhos na resposta da IA.
   - Abre uma gaveta inferior (bottom sheet / modal) com links de pesquisa na web, domínio, título dos artigos e galeria de recursos visuais.

5. **Persistência do Input do Usuário**:
   - O texto digitado no campo de mensagem é salvo no `localStorage` em tempo real.
   - Se o usuário recarregar a página, fechar o app ou navegar entre conversas, o rascunho permanece salvo até que decida enviar ou apagar.

6. **Ajuste de Cores do Menu de Anexos (+)**:
   - Contraste corrigido tanto no tema claro quanto escuro.
   - Ícones de atalho destacados com badges coloridos para "Criar Imagem", "Anexar Mídia", "Arquivos & Código" e "Câmera HD".
   - Fechamento suave ao clicar fora do menu.
