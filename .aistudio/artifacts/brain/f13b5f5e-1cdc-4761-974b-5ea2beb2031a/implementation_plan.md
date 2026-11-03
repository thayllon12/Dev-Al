# Plano de Correção: Menus de Contexto

O objetivo é garantir que os menus de três pontinhos das mensagens (IA e Usuário) abram sempre de forma visível e sobreponham qualquer outro elemento, independentemente do dispositivo ou posição da mensagem.

## Diagnóstico
Atualmente, o `z-index` e o posicionamento estão restritos pelo container pai (`relative` ou `overflow`), fazendo com que o menu seja cortado ou fique atrás de outras mensagens.

## Plano de Ação
1. **Z-Index e Estilização:** Aumentar o `z-index` de todos os menus contextuais para um valor significativamente alto (ex: `z-[100]`) para garantir sobreposição.
2. **Correção de Posicionamento:** Ajustar as classes do container do menu para garantir que ele flutue fora do container da mensagem, usando `absolute` e ajustando os offsets (`top` ou `bottom`) baseados na posição da mensagem.
3. **Portal (Opcional):** Se o overflow da lista de mensagens persistir, aplicar `fixed` no menu com cálculo de posição via JavaScript, ou usar um portal.
4. **Verificação:** Validar o comportamento em desktop e mobile.

---
[Solicitação de feedback para executar as correções no App.tsx]
