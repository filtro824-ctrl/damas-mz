# Relatório de implementação — DAMAS MZ

## Resumo

O projeto recebido foi atualizado mantendo a arquitetura Node.js, SQLite, JavaScript nativo, motor de Damas Portuguesas, autenticação, sessões, WebSocket, reconexão, torneios gratuitos, painel existente e identidade DAMAS MZ. A aplicação utiliza agora XP virtual apenas para progressão e classificação; não há custo/entrada por partida, transferência de XP entre adversários, reembolso de entrada ou saldo mínimo.

## Alterações entregues

- **Partidas e XP:** criação de partidas e torneios desacoplada de entradas e prémios; resultados válidos atribuem XP no backend (vitória 25, empate 10 a cada jogador, participação em derrota 5). Partidas canceladas antes de começar não alteram XP. Não existe conversão, resgate ou transferência de XP.
- **Matchmaking e salas:** fila aleatória e salas públicas sem requisito de saldo; intervalos de rating e pesquisa por nome são Premium/VIP; salas públicas personalizadas são Premium; salas privadas/códigos de convite são VIP e não aparecem na lista pública. Permissões verificadas no servidor.
- **Perfis e progressão:** nível (250 XP por nível), rating, vitórias, derrotas, empates, streak, conquistas, ajustes administrativos auditados e temas de perfil condicionados ao plano. Premium pode manter biografia de até 160 caracteres; VIP recebe resumo de vitórias/derrotas/empates e média de lances por categoria, calculado a partir de partidas terminadas. Inclui emblema VIP apenas enquanto existir subscrição VIP válida.
- **Rankings e histórico:** rating geral e classificação por XP semanal/mensal; estatísticas de perfil; histórico recente disponível no plano Gratuito e histórico integral condicionado a VIP, com regra aplicada no backend.
- **Planos:** Gratuito (0 MT), Premium (99 MT/mês) e VIP (199 MT/mês), com preços/estado configuráveis no painel. Consulta de subscrição, cancelamento administrativo auditado e expiração com downgrade para Gratuito.
- **Administração:** painel expandido para planos, subscrições, salas abertas (cancelamento auditado por moderador), pagamentos, rankings por período e gestão de rating justificada, preservando operações existentes. Configurações de ambiente permanecem só de leitura; não há confirmação manual de pagamento. A gestão completa de configurações de runtime permanece por variáveis de ambiente.
- **Migração/documentação:** migração SQLite versionada; conversão do saldo líquido legado para XP inicial neutro; removidas colunas antigas de entrada em partidas/salas. README contém instalação, configuração, permissões e limites. Ver também [`PAGAMENTOS_E_MIGRACOES.md`](PAGAMENTOS_E_MIGRACOES.md).
- **Interface:** metadados, ajuda, perfil, páginas e mensagens atualizados; planos pagos mostram indisponibilidade do checkout em vez de oferecer uma ação que não funcionaria. O smoke test revelou e levou à correção de uma palavra literal `null` no estado inicial do dashboard. O ZIP fonte já desregistava service workers e não ativava modo PWA/manifest pelo cliente; este comportamento de abertura em navegador normal foi preservado, sem apresentar o projeto como PWA instalável.

## Limitação em pagamentos e renovação real

O checkout e a renovação cobrados ainda **não estão implementados**. Este pacote não inclui adaptador M-Pesa/e-Mola, conta de comerciante, API de checkout nem credenciais. Também não se validou o contrato genérico de callback com a sandbox/documentação oficial de qualquer provedor. Sem esses elementos não é possível criar, cobrar ou renovar uma assinatura real com segurança.

O backend documenta o ponto de extensão e valida HMAC-SHA256 de um callback genérico associado a uma tentativa pendente; a tentativa `not_configured` não representa uma cobrança e não concede plano. A interface desativa “Assinar” e “Renovar” e informa que estão indisponíveis. Antes de habilitar o recurso, é necessário implementar e testar o adaptador oficial, confirmar a transação junto do provedor, verificar correspondência de valor, moeda, beneficiário/conta de comerciante e referência, seguir o contrato oficial de assinatura, garantir idempotência e testar casos aprovados/rejeitados numa sandbox; obter e proteger as credenciais do comerciante; e só então executar uma cobrança de teste autorizada. Nenhum pagamento foi simulado ou confirmado neste trabalho.

## Outros limites conhecidos

O XP e o rating são atualizados por resultados concluídos; o sistema regista alguns sinais de segurança para revisão humana, mas não implementa deteção automática abrangente de contas alternadas ou partidas combinadas para farming de XP/rating. Antes de competição de alto risco, adicione monitorização e critérios de integridade/recursos de moderação adequados. Os ajustes gerais de configuração continuam no ambiente do servidor e o painel mostra esses valores apenas para leitura. O comportamento PWA/standalone não está ativo na versão-fonte original recebida.

## Verificações executadas

- **Testes automatizados:** `npm test` — **55/55 passam**, sem falhas, cancelamentos ou testes omitidos. A suíte inclui motor/regras, partidas HTTP/WebSocket, fila, salas privadas, resultados/XP, rankings, acesso por plano, expiração, administração, recusa de callback inválido e migração de esquema legado em base de teste; inclui também as regressões de consulta a perfis de terceiros, biografia Premium, agregados VIP, título personalizado e cancelamento administrativo de sala.
- **Sintaxe:** `node --check` em módulos do servidor, frontend, páginas, testes e motor compartilhado; a execução final dos testes ocorreu depois das alterações funcionais.
- **Inicialização/smoke backend:** instância final iniciou com SQLite numa pasta `/tmp` isolada e `GET /api/config` retornou HTTP 200, incluindo cabeçalhos de segurança. A base temporária não pertence ao projeto e nenhuma base de produção foi usada ou migrada.
- **Smoke browser:** registo/onboarding com nome que contém hífen, dashboard Free, perfil com biografia editável bloqueada para Free, acesso administrativo, dashboard admin e tela de salas foram carregados na instância final; console sem mensagens. O checkout não foi testado com transação real, pois não existe adaptador. A conta/senha de smoke eram temporárias e a base fica fora do ZIP.
- **Responsividade física:** as regras responsivas existentes foram preservadas; não houve validação em aparelhos físicos Android/iPhone/tablet. A verificação visual no browser foi feita em viewport de desktop.

## Estado de implantação

Entregue como projeto-fonte comprimido, não publicado nem ligado a domínio. Antes de produção: escolher ambiente de hospedagem persistente para SQLite, definir `DATA_DIR`, TLS/HTTPS, `COOKIE_SECURE`, senha administrativa forte e cópias de segurança; testar a migração num clone de dados; validar concorrência/múltiplas instâncias e os termos de uso/privacidade; concluir e testar a integração de pagamentos antes de oferecer planos pagos.
