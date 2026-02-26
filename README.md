# README — Uber Trance API (POC)

Base URL: http://localhost:3000
Formato: JSON (Content-Type: application/json)

==================================================

# PASSO A PASSO PARA O DEV (BACK + FRONT)

## 1) Configurar backend

1. Instalar dependências
   npm install

2. Configurar .env com:
   DATABASE_URL="postgresql://postgres:sua_senha@localhost:5432/ubertrance?schema=public"
   PORT=3000
   QR_PUBLIC_KEY_B64URL="LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQURWYkpkQldsVzVjQ0dSOGVBY01oVHRteU5ESFcyeCszMjMyb245RDNhQlk9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=" 
   QR_PRIVATE_KEY_B64URL="LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1DNENBUUF3QlFZREsyVndCQ0lFSUt5R1ZEV1pZK2hOLytILzR3WWFURGR5bDV1TGN4MUJzL3VuZmoxYzloRFoKLS0tLS1FTkQgUFJJVkFURSBLRVktLS0tLQo="

3. Rodar migrations
   npx prisma migrate dev

4. Gerar client prisma
   npx prisma generate

5. Rodar servidor
   npm run dev


==================================================

# FLUXO DO APP (FRONT)

1) Baixar chave pública:
GET /driver/qr/public-key

2) Baixar operação ativa:
GET /driver/pacotes/ativo

3) Vender pass (online):
POST /driver/vender

4) Validar QR (online):
POST /driver/scan

5) Offline:
- validar QR localmente
- salvar vendas e eventos
- enviar depois via POST /driver/sync


==================================================

# REGRAS IMPORTANTES

- QR precisa ter payload + assinatura (sig)
- assinatura é ED25519
- payload tem expiração (exp)
- vendas offline precisam de idempotencyKey
- eventos não podem duplicar (passId + tipo)


==================================================

# ROTAS ADMIN

POST /admin/eventos
POST /admin/operacoes
POST /admin/pacotes
POST /admin/saidas/confirmar
GET  /admin/operacoes/:id/resumo


==================================================

# ROTAS DRIVER

GET  /driver/qr/public-key
GET  /driver/pacotes/ativo
POST /driver/vender
POST /driver/scan
POST /driver/sync


==================================================

# ESTRUTURA DE DADOS NO FRONT (OFFLINE)

- publicKeyPem
- operacao atual
- passes (payload + sig)
- vendas pendentes (idempotencyKey)
- eventos pendentes


==================================================

# TESTES IMPORTANTES

1. criar evento
2. criar operação
3. criar pacote
4. vender pass
5. escanear QR
6. repetir scan (não duplicar)
7. sync offline
8. adulterar QR (falhar assinatura)


==================================================

# CONCLUSÃO

Backend pronto para:
- venda online
- venda offline
- antifraude por assinatura
- validação offline
- sincronização segura

Próximo passo: UI + app mobile.
