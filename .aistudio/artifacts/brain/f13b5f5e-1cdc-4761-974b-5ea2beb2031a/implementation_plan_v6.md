# Plano de Ação: Correções e Refinamentos DEV AI V6

Este plano aborda as correções críticas solicitadas para garantir o funcionamento correto do modelo padrão, menus contextuais e a experiência do Dev Live.

## 1. Correção dos Modelos e Persistência
- **Modelo Padrão:** Forçar a inicialização e persistência do `gemini-3.8-flash` no estado global e `localStorage` para evitar o fallback indesejado para modelos antigos.
- **Auditoria de Lista:** Limpar o seletor de modelos no frontend e backend, garantindo que apenas modelos funcionais sejam exibidos.

## 2. Redesign do Dev Live (Ligação)
- **Nova Interface:** Criar um layout premium para o *Dev Live*.
- **Controles:** Adicionar botões funcionais para:
  - Câmera (Toggle/Virar).
  - Microfone (Mudo/Desmudo).
  - Compartilhamento de Tela.
- **Animações:** Implementar animações de detecção de voz e estado de processamento da IA.
- **Experiência:** Mover o botão de encerramento para a parte inferior e remover o 'X' superior.

## 3. Correção dos Menus Contextuais
- **Posicionamento:** Implementar uma solução baseada em `fixed` com cálculo de coordenadas (`getBoundingClientRect`) para garantir que os menus flutuem acima de todos os elementos e não sejam cortados pelo overflow dos containers de chat.

## 4. Ajustes no Footer da Sidebar
- **ID do Usuário:** Exibir o UID do usuário autenticado via Firebase.
- **Contador Online:** Implementar lógica para exibir o número real de usuários conectados com base na sessão ativa do Firebase/Firestore.

---
[Aguardando aprovação para proceder com as alterações no código]
