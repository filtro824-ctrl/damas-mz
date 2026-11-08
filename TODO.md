# TODO — Transformação DAMAS MZ

## Remoção integral da economia de apostas
- [x] Remover funcionalidades e referências a apostas em dinheiro, depósitos para entrar em partidas, levantamentos, carteiras de apostas, pagamentos entre adversários, distribuição de prémios monetários, comissões, salas com entradas em dinheiro e qualquer lógica que transforme vitórias em ganhos monetários.
- [x] Remover referências visuais, textos, botões, menus, configurações, APIs, tabelas e componentes relacionados com apostas; não deixar funcionalidades antigas escondidas ou parcialmente ativas.
- [x] Remover a mecânica de entrada/prémio em pontos entre adversários, incluindo débitos, reembolsos por cancelamento/empate e exigência de saldo; os pontos serão exclusivamente virtuais, sem valor monetário, levantamento, conversão em dinheiro ou troca por prémios económicos.

## Jogo online, salas e contas
- [x] Preservar o jogo de Damas funcional, motor/regras originais, autenticação, segurança, reconnect, histórico útil, torneios gratuitos e implantação existente; não recriar o projeto do zero nem eliminar funcionalidades úteis.
- [x] Implementar salas públicas, salas aleatórias, emparelhamento automático, salas privadas, convites para amigos, pesquisa de adversários e partidas online em tempo real.
- [x] Implementar vitória, derrota e empate; conceder pontos virtuais conforme os resultados das partidas, destinados apenas a classificação, progressão e reconhecimento.
- [x] Disponibilizar histórico de partidas, perfis de jogadores e estatísticas individuais.

## Rankings e progressão
- [x] Disponibilizar ranking geral, semanal, mensal e dos melhores jogadores.
- [x] Disponibilizar níveis de experiência, pontuação acumulada, registos de vitórias e derrotas, sequência de vitórias, medalhas e conquistas.

## Planos, subscrições e pagamentos
- [x] Disponibilizar os planos e preços configuráveis pelo administrador: Gratuito — 0 MT (partidas normais, adversários aleatórios, pontos, ranking básico, perfil e funcionalidades essenciais); Premium — 99 MT/mês (pesquisa avançada, intervalo de pontuação, salas personalizadas, personalização do perfil, estatísticas avançadas e temas especiais); VIP — 199 MT/mês (todas as funcionalidades Premium, salas privadas avançadas, personalização exclusiva, histórico completo, estatísticas detalhadas, emblemas especiais e temas exclusivos).
- [ ] Permitir consultar o plano atual, validade, renovar a subscrição e consultar histórico de pagamentos; bloquear automaticamente funcionalidades pagas quando a subscrição expirar e atualizar o plano apenas após confirmação válida. A consulta, histórico, expiração e bloqueio server-side estão implementados. Checkout/renovação e ciclo completo de confirmação real continuam indisponíveis até existir um adaptador de gateway; a interface indica isso e não ativa planos.
- [ ] Preparar integração com provedor compatível com Moçambique, como M-Pesa/e-Mola. Sem credenciais, documentar a configuração e não simular nem inventar transações ou pagamentos confirmados. A arquitetura, registo de tentativas, contrato HMAC e documentação estão preparados; falta adaptar e validar contra documentação, sandbox e credenciais reais do provedor.

## Administração e requisitos técnicos
- [ ] Preservar e ampliar o painel para gerir utilizadores, planos, subscrições, salas, partidas, rankings, estatísticas da plataforma, pagamentos/confirmações e configurações gerais. A gestão existente e a nova gestão de planos, subscrições, salas abertas, partidas, rankings e métricas estão no painel; as configurações de ambiente são apenas de leitura e os pagamentos reais dependem da adaptação do provedor/callback — não existe botão de confirmação manual.
- [x] Adaptar a base de dados; validar permissões no backend e impedir que planos Premium/VIP sejam contornados por alterações no frontend.
- [x] Não executar migrações numa base de produção durante o desenvolvimento; não introduzir dependências desnecessárias.
- [ ] Preservar identidade visual e melhorar experiência responsiva em Android, iPhone, tablet e computador, sem substituir o design por template genérico. Tokens, componentes existentes e breakpoints responsivos foram preservados; a validação manual foi feita em browser de desktop, não em dispositivos físicos Android/iPhone/tablet.

## Verificação e entrega
- [x] Executar e relatar testes de partidas entre dois jogadores, emparelhamento aleatório, salas privadas, atribuição de pontos, rankings, permissões Free/Premium/VIP, expiração de subscrições, isolamento das antigas funções de apostas, erros de consola/backend e inicialização da aplicação. A suíte automatizada final (55/55) também cobre bypass de estatísticas por perfil de terceiros, biografia Premium, métricas VIP, salas Premium só com título e cancelamento de sala por moderador. Sintaxe verificada com `node --check`; HTTP/config e smoke browser do registo, dashboard, perfil e painel foram validados em base temporária; console do browser sem mensagens.
- [x] Entregar o projeto atualizado e ZIP final, esquema/migrações, instruções de instalação e de configuração de pagamentos, relatório de mudanças, relatório de testes e lista das funcionalidades ainda dependentes de credenciais externas. O ZIP inclui migrações, instruções, relatório e lista de limitações; checkout real, configurações gerais editáveis e validação em dispositivos físicos permanecem identificados como pendências.
- [x] Se qualquer funcionalidade não puder ser implementada, documentar exatamente o motivo e não a apresentar como concluída.
