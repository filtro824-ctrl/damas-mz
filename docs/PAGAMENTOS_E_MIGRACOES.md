# Pagamentos, permissões e migração

## Estado inicial

A aplicação não contém uma integração de pagamento real. Por omissão, os planos pagos não podem ser ativados: uma tentativa fica registada como `not_configured`, sem cobrança e sem alteração da subscrição. A confirmação só ocorre depois de o backend validar uma assinatura HMAC-SHA256 do payload do provedor, associar uma referência externa única e encontrar uma tentativa pendente. O adaptador de checkout M-Pesa/e-Mola ainda precisa ser implementado com a documentação e credenciais oficiais do comerciante; o servidor não simula checkout ou pagamento.

## Configuração necessária para uma futura integração

Definir em ambiente protegido, nunca no frontend nem no repositório: `PAYMENT_PROVIDER=mpesa` ou `emola`, `PAYMENT_API_URL`, `PAYMENT_API_TOKEN`, `PAYMENT_CHECKOUT_URL` e `PAYMENT_WEBHOOK_SECRET`. O endpoint de callback esperado é `POST /api/payments/webhook/:provider`, com header `X-Damas-Signature: sha256=<hex>` e JSON `{ "status":"paid", "paymentId":"...", "providerRef":"..." }`. A assinatura atual é um contrato de integração genérico; adaptar a verificação ao algoritmo e à assinatura oficial do provedor antes de produção. Não publicar credenciais ou permitir confirmação manual pelo painel.

## Acesso e expiração

O nível de plano é derivado no servidor de uma subscrição com estado `active` e `expires_at` futuro. Qualquer função premium consulta o serviço de planos no backend; estado, preço ou feature flag enviados pelo navegador nunca autorizam acesso. O agendador de um segundo expira registos vencidos, e `subscriptionFor` já os considera Free mesmo antes desse tick.

## Migração de SQLite

`server/db.js` cria o esquema atual e regista a migração `1` em `schema_migrations`. A migração remove as colunas legadas de entrada de pontos em `rooms` e `games`, adiciona visibilidade/códigos às salas, streaks às classificações e campos de personalização, e substitui o livro-razão de entradas/prémios por uma linha neutra de XP inicial equivalente ao saldo virtual líquido anterior. O histórico de jogos e contas permanece. A migração é testada apenas com bases temporárias/de teste; não se executou nem se deve executar contra uma base de produção durante o desenvolvimento. Antes de uma implantação, fazer cópia de segurança e validar o esquema num clone da base.
