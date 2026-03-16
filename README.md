# Uber Trance API — POC MVP

> **Base URL:** `http://localhost:3000`
> **Formato:** `application/json`

---

## Visão Geral

Esta API implementa a POC do **Uber Trance** com:

- Autenticação real do motorista via **JWT HS256** (14 dias de expiração)
- Hashing de senha com **scrypt** nativo do Node.js
- Operação do dia (`OperacaoDia`)
- Produtos: `IDA`, `VOLTA`, `COMBO`, `EM_PE`
- Pacotes de passes por motorista
- QR assinado com **Ed25519**
- **Assento por pass** (`assentoId`) para futura exibição de mapa visual
- **Fila de IDA** separada da fila de VOLTA
- Venda online e offline
- Validação de QR com antifraude
- Sincronização idempotente
- Fluxo de cliente para compra e emissão posterior

A arquitetura do MVP usa um único servidor **Fastify**, com separação lógica por prefixo de rota: `/auth`, `/admin`, `/driver`, `/cliente`.

---

## Stack

- Fastify 5
- Prisma 7 + PostgreSQL
- TypeScript
- Zod
- Ed25519 (assinatura dos QRs)
- `crypto` nativo do Node.js (scrypt para senha, HS256 para JWT)

---

## Estrutura de Arquivos

```
src/
  server.ts
  prisma.ts
  seed.ts
  lib/
    auth.ts       ← hashing scrypt + JWT HS256 manual (sem deps externas)
    qr.ts
    validate.ts
  routes/
    auth.ts       ← POST /auth/login
    admin.ts
    driver.ts
    cliente.ts
prisma/
  schema.prisma
  migrations/
```

---

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL="postgresql://postgres:sua_senha@localhost:5432/ubertrance?schema=public"
PORT=3000

# JWT — troque por um segredo forte em produção
JWT_SECRET="dev-jwt-secret-troque-em-producao"

QR_PUBLIC_KEY_B64="COLE_AQUI_A_CHAVE_PUBLICA_EM_BASE64"
QR_PRIVATE_KEY_B64="COLE_AQUI_A_CHAVE_PRIVADA_EM_BASE64"
```

> ⚠️ **Atenção:** Use exatamente `QR_PUBLIC_KEY_B64` e `QR_PRIVATE_KEY_B64`. Não use `QR_PUBLIC_KEY_B64URL` nem `QR_PRIVATE_KEY_B64URL`.

---

## Instalação e Execução

```bash
npm install
npx prisma generate
npx prisma migrate deploy   # ou: npx prisma migrate dev
npm run dev
```

Para popular o banco com dados de teste (incluindo motorista com email/senha):

```bash
npx tsx src/seed.ts
```

O seed cria um motorista com:
- Email: `motorista@teste.com`
- Senha: `senha123`

---

## Healthcheck

```
GET /health
GET /debug/db
```

---

## Conceitos do Sistema

| Conceito | Descrição |
|---|---|
| `OperacaoDia` | Representa a operação ativa do dia. Quase todo o fluxo depende de existir uma operação com status `ATIVA`. |
| `Produto` | Tipos suportados: `IDA`, `VOLTA`, `COMBO`, `EM_PE`. |
| `PacotePasses` | Lote de passes gerado para um motorista específico. Cada pass pertence a apenas um pacote. |
| `Pass` | Estados: `DISPONIVEL`, `VENDIDO`, `USADO_IDA`, `NA_FILA_IDA`, `NA_FILA`, `EMBARCOU`. Cada pass possui um `assentoId` único na operação. |
| `EventoScanner` | Eventos registrados no scan: `CHECKIN_IDA`, `CHECKIN_IDA_FILA`, `CHECKIN_VOLTA_FILA`, `EMBARQUE_VOLTA`. |
| `VendaLocal` | Venda armazenada no app para sincronização posterior. |
| `SyncCursor` | Controle do último sync realizado por motorista. |

---

## Autenticação

Todas as rotas `/driver/*` exigem autenticação. O token é obtido via `POST /auth/login`.

**Header obrigatório em todas as rotas `/driver/*`:**
```
Authorization: Bearer <token>
```

> **Retrocompatibilidade:** O header legado `x-motorista-id` ainda é aceito enquanto o app não for totalmente migrado. Após a migração, ele será removido.

---

## Máquina de Estados do Pass

```
DISPONIVEL
    │
    ▼ (vender / sync venda)
VENDIDO
    │
    ├─► [CHECKIN_IDA_FILA] ──► NA_FILA_IDA ──► [CHECKIN_IDA] ──► USADO_IDA
    │                                                                    │
    └─► [CHECKIN_IDA] ─────────────────────────────────────────► USADO_IDA
                                                                         │
    ┌────────────────────────────────────────────────────────────────────┘
    │   (ou direto de VENDIDO para VOLTA)
    ▼
[CHECKIN_VOLTA_FILA] ──► NA_FILA ──► [EMBARQUE_VOLTA] ──► EMBARCOU
```

**Resumo das transições:**

| Evento | Estados de entrada válidos | Estado de saída |
|---|---|---|
| `CHECKIN_IDA_FILA` | `VENDIDO` | `NA_FILA_IDA` |
| `CHECKIN_IDA` | `VENDIDO`, `NA_FILA_IDA` | `USADO_IDA` |
| `CHECKIN_VOLTA_FILA` | `VENDIDO`, `USADO_IDA` | `NA_FILA` |
| `EMBARQUE_VOLTA` | `NA_FILA` | `EMBARCOU` |

---

## Formato do QR

Cada pass possui um `payload` (JSON stringificado) e uma `sig` (assinatura Ed25519 em base64url). O payload inclui:

```json
{
  "v": 1,
  "passId": "uuid",
  "operacaoDiaId": "uuid",
  "eventoId": "uuid",
  "produto": "IDA|VOLTA|COMBO|EM_PE",
  "produtoTipo": "IDA|VOLTA|COMBO|EM_PE",
  "motoristaId": "uuid",
  "assentoId": 7,
  "nonce": "randomBase64url",
  "iat": 1770000000000,
  "exp": 1770000000000
}
```

**Regras do QR:**
- A assinatura é feita via Ed25519 (backend ao gerar o pacote).
- O app do motorista valida a assinatura localmente usando a `publicKeyPem`.
- O QR precisa pertencer ao mesmo `motoristaId` do aparelho logado.
- QR adulterado ou expirado retorna erro.
- O `assentoId` no payload identifica o assento para o mapa visual.

---

## Rotas AUTH

### `POST /auth/login`

Autentica o motorista e retorna um JWT com expiração de 14 dias.

**Body:**
```json
{
  "email": "motorista@teste.com",
  "senha": "senha123"
}
```

**Resposta (200):**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "14d",
  "motorista": {
    "id": "uuid",
    "nome": "Motorista Teste",
    "email": "motorista@teste.com"
  }
}
```

**Erros:**
- `401` — email não encontrado, motorista inativo ou senha incorreta (mesma mensagem genérica para não revelar qual campo falhou)

> O JWT é HS256 assinado com `JWT_SECRET`. O `motoristaId` fica no payload do token — não é mais necessário enviar nenhum header separado de identificação.

---

## Rotas ADMIN

### `POST /admin/eventos`

Cria um evento.

```json
{
  "titulo": "Rave Teste",
  "localTitulo": "Arena X",
  "localDetalhe": "Ponto Y",
  "inicioIdas": "2026-03-20T12:00:00.000Z",
  "fimIdas": "2026-03-21T00:00:00.000Z",
  "tempoRotaMin": 90,
  "minPagantesPorSaida": 10,
  "capacidadeSentado": 30,
  "capacidadeEmPe": 10,
  "ativo": true
}
```

---

### `POST /admin/operacoes`

Cria uma `OperacaoDia`.

```json
{
  "eventoId": "uuid",
  "dataISO": "2026-03-20T00:00:00.000Z"
}
```

---

### `POST /admin/pacotes`

Gera um pacote de passes para um motorista. Cada pass recebe um `assentoId` único e sequencial dentro da operação, e sai com `payload` e `sig` prontos.

**Body:**
```json
{
  "operacaoDiaId": "uuid",
  "motoristaId": "uuid",
  "produtoTipo": "VOLTA",
  "quantidade": 3
}
```

**Retorno:**
```json
{
  "ok": true,
  "pacote": {
    "id": "uuid",
    "operacaoDiaId": "uuid",
    "motoristaId": "uuid",
    "produtoTipo": "VOLTA",
    "quantidade": 3
  },
  "publicKeyPem": "-----BEGIN PUBLIC KEY----- ...",
  "passes": [
    {
      "id": "uuid",
      "assentoId": 1,
      "payload": "{...}",
      "sig": "base64url"
    },
    {
      "id": "uuid",
      "assentoId": 2,
      "payload": "{...}",
      "sig": "base64url"
    }
  ]
}
```

> Os `assentoId` são globais por operação: o primeiro pacote recebe 1..N, o segundo pacote recebe N+1..M, e assim por diante — sem sobreposição entre motoristas.

---

### `POST /admin/confirmar-pagamento`

Confirma uma compra pendente criada pelo cliente e emite os passes no backend. Os passes também recebem `assentoId` sequencial.

**Body:**
```json
{
  "pendenciaToken": "base64-json",
  "motoristaId": "uuid"
}
```

**Retorno:**
```json
{
  "ok": true,
  "pagamento": "CONFIRMADO",
  "pacoteId": "uuid",
  "totalEmitido": 2,
  "passes": [
    {
      "id": "uuid",
      "assentoId": 5,
      "estado": "VENDIDO",
      "produtoTipo": "VOLTA",
      "payload": "{...}",
      "sig": "base64url",
      "vendidoNome": "Gustavo",
      "vendidoTel": "11999999999",
      "vendidoEm": "2026-03-11T15:00:00.000Z"
    }
  ]
}
```

---

### `POST /admin/saidas/confirmar`

Confirma uma saída de IDA ou VOLTA.

```json
{
  "operacaoDiaId": "uuid",
  "tipo": "IDA"
}
```

---

### `GET /admin/operacoes/:id/resumo`

Retorna resumo da operação: evento, quantidade vendida, capacidade restante e próxima saída estimada.

---

## Rotas DRIVER

Todas as rotas `/driver/*` exigem `Authorization: Bearer <token>`.

---

### `GET /driver/qr/public-key`

Retorna a chave pública PEM usada na verificação offline do QR. Não requer autenticação.

```json
{
  "ok": true,
  "publicKeyPem": "-----BEGIN PUBLIC KEY----- ..."
}
```

---

### `GET /driver/pacotes/ativo`

Baixa a operação ativa do motorista, sua chave pública e os pacotes disponíveis.

**Resposta:**
```json
{
  "ok": true,
  "publicKeyPem": "-----BEGIN PUBLIC KEY----- ...",
  "operacao": {
    "id": "uuid",
    "status": "ATIVA",
    "data": "2026-03-20T00:00:00.000Z"
  },
  "evento": {
    "id": "uuid",
    "titulo": "Rave Teste",
    "localTitulo": "Arena X",
    "localDetalhe": "Ponto Y",
    "inicioIdas": "2026-03-20T12:00:00.000Z",
    "fimIdas": "2026-03-21T00:00:00.000Z",
    "tempoRotaMin": 90,
    "minPagantesPorSaida": 10,
    "capacidadeSentado": 30,
    "capacidadeEmPe": 10,
    "capacidadeTotal": 40
  },
  "capacidadeRestante": {
    "sentado": 28,
    "emPe": 9,
    "total": 37
  },
  "proximaSaidaEstimada": "2026-03-20T12:40:00.000Z",
  "pacotes": [
    {
      "id": "uuid",
      "passes": [
        {
          "id": "uuid",
          "assentoId": 1,
          "estado": "DISPONIVEL",
          "produtoTipo": "VOLTA",
          "payload": "{...}",
          "sig": "base64url"
        }
      ]
    }
  ]
}
```

> `capacidadeTotal` = `capacidadeSentado` + `capacidadeEmPe`.
> `capacidadeRestante.total` = passes ainda não vendidos/usados somando sentado e em pé.
> Esses campos cobrem o requisito de exibir a ocupação da van no header do app.

---

### `POST /driver/vender`

Venda online de um pass que ainda está `DISPONIVEL`.

**Body:**
```json
{
  "passId": "uuid",
  "nome": "Henrique",
  "telefone": "11888888888"
}
```

> **Regras:** Pass precisa pertencer ao motorista, estar `DISPONIVEL`, respeitar capacidade e janela de venda.

---

### `POST /driver/scan`

Valida QR e registra evento de scanner com transição de estado automática.

**Body:**
```json
{
  "tipo": "CHECKIN_VOLTA_FILA",
  "qrPayload": "{...}",
  "qrSig": "base64url"
}
```

**Tipos permitidos:**

| `tipo` | Descrição | Estado antes | Estado depois |
|---|---|---|---|
| `CHECKIN_IDA` | Embarque na ida | `VENDIDO` ou `NA_FILA_IDA` | `USADO_IDA` |
| `CHECKIN_IDA_FILA` | Entrada na fila de ida | `VENDIDO` | `NA_FILA_IDA` |
| `CHECKIN_VOLTA_FILA` | Entrada na fila de volta | `VENDIDO` ou `USADO_IDA` | `NA_FILA` |
| `EMBARQUE_VOLTA` | Embarque na volta | `NA_FILA` | `EMBARCOU` |

> **Regras:** Assinatura Ed25519 válida, QR não expirado, `motoristaId` igual ao do token JWT, payload corresponde ao banco, transição de estado válida, sem replay (idempotência por `@@unique([passId, tipo])`).

---

### `POST /driver/sync`

Sincroniza vendas offline e eventos offline capturados sem internet.

**Body:**
```json
{
  "vendas": [
    {
      "idempotencyKey": "sale-001",
      "passId": "uuid",
      "nome": "Carlos",
      "telefone": "11777777777",
      "tsLocalISO": "2026-03-11T15:00:00.000Z"
    }
  ],
  "eventos": [
    {
      "passId": "uuid",
      "tipo": "CHECKIN_IDA_FILA",
      "tsLocalISO": "2026-03-11T15:10:00.000Z"
    }
  ]
}
```

**Tipos de evento aceitos no sync:** `CHECKIN_IDA`, `CHECKIN_IDA_FILA`, `CHECKIN_VOLTA_FILA`, `EMBARQUE_VOLTA`.

**Resposta:**
```json
{
  "ok": true,
  "vendas_ok": 1,
  "vendas_skip": 0,
  "eventos_ok": 1,
  "eventos_skip": 0
}
```

> **Regras:** Totalmente idempotente. Re-envio de venda com mesma `idempotencyKey` é ignorado silenciosamente. Re-envio de evento duplicado também é ignorado. Atualiza o `SyncCursor` do motorista.

---

## Rotas CLIENTE

### `GET /cliente/operacao/ativa`

Retorna operação ativa, dados do evento e produtos disponíveis.

---

### `POST /cliente/compra`

Cria uma compra pendente (não emite pass ainda).

**Body:**
```json
{
  "nome": "Gustavo",
  "telefone": "11999999999",
  "produtoTipo": "VOLTA",
  "quantidade": 2
}
```

**Resposta:**
```json
{
  "ok": true,
  "compra": {
    "status": "PENDENTE",
    "operacaoDiaId": "uuid",
    "eventoId": "uuid",
    "nome": "Gustavo",
    "telefone": "11999999999",
    "produtoTipo": "VOLTA",
    "quantidade": 2,
    "precoUnitCent": 5000,
    "precoTotalCent": 10000,
    "pendenciaToken": "base64-json"
  }
}
```

---

### `GET /cliente/passes?telefone=11999999999`

Lista os passes já emitidos para o telefone informado.

**Resposta:**
```json
{
  "ok": true,
  "telefone": "11999999999",
  "total": 2,
  "passes": [
    {
      "id": "uuid",
      "operacaoDiaId": "uuid",
      "produtoTipo": "VOLTA",
      "estado": "VENDIDO",
      "payload": "{...}",
      "sig": "base64url",
      "vendidoNome": "Gustavo",
      "vendidoTel": "11999999999",
      "vendidoEm": "2026-03-11T15:00:00.000Z"
    }
  ]
}
```

---

## Fluxos do Sistema

### Admin → Driver (venda direta)

1. Criar evento
2. Criar operação
3. Gerar pacote para motorista (`POST /admin/pacotes`)
4. Motorista faz login (`POST /auth/login`) e obtém JWT
5. Motorista baixa pacote ativo (`GET /driver/pacotes/ativo`)
6. Motorista vende ou escaneia
7. Sincroniza quando necessário (`POST /driver/sync`)

### Cliente → Admin (venda pelo app do cliente)

1. Cliente consulta operação ativa (`GET /cliente/operacao/ativa`)
2. Cliente cria compra pendente (`POST /cliente/compra`)
3. Admin confirma pagamento (`POST /admin/confirmar-pagamento`)
4. Backend emite os passes com `assentoId`
5. Cliente consulta seus passes (`GET /cliente/passes`)

### Offline do Motorista

1. Motorista baixa pacote e chave pública antes de perder internet
2. Valida QR localmente (verifica assinatura Ed25519 + expiração + motoristaId)
3. Salva vendas e eventos localmente (incluindo `CHECKIN_IDA_FILA` e `CHECKIN_IDA`)
4. Envia tudo depois via `POST /driver/sync`

### Fluxo de Fila de IDA

1. Passageiro chega à van de ida → motorista escaneia → `CHECKIN_IDA_FILA` → pass vai para `NA_FILA_IDA`
2. Van está pronta → motorista confirma embarque → `CHECKIN_IDA` → pass vai para `USADO_IDA`

### Fluxo de Fila de VOLTA

1. Passageiro chega ao ponto de volta → motorista escaneia → `CHECKIN_VOLTA_FILA` → pass vai para `NA_FILA`
2. Van está pronta → motorista confirma embarque → `EMBARQUE_VOLTA` → pass vai para `EMBARCOU`

---

## Regras de Negócio

- Cada pass pertence a um único pacote e a um único motorista.
- `motoristaId` no QR deve corresponder ao motorista autenticado (via JWT).
- `assentoId` é atribuído sequencialmente por operação ao gerar o pacote (global entre motoristas).
- `EM_PE` tem limite de capacidade próprio (`capacidadeEmPe`).
- Venda online e offline respeitam a capacidade total da van.
- As filas de IDA e VOLTA são separadas por tipo de evento (`CHECKIN_IDA_FILA` vs `CHECKIN_VOLTA_FILA`).
- Reuso de QR é bloqueado pela constraint `@@unique([passId, tipo])` em `EventoScanner`.
- Sync precisa ser idempotente.
- A operação precisa estar `ATIVA` para quase todo o fluxo.

---

## Testes via cURL

### 0. Subir Servidor

```bash
npm run dev
curl http://localhost:3000/health
curl http://localhost:3000/debug/db
```

### 1. Criar Evento

```bash
curl -X POST http://localhost:3000/admin/eventos \
  -H "Content-Type: application/json" \
  -d '{
    "titulo":"Rave Teste",
    "localTitulo":"Arena X",
    "localDetalhe":"Ponto Y",
    "inicioIdas":"2026-03-20T12:00:00.000Z",
    "fimIdas":"2026-03-21T00:00:00.000Z",
    "tempoRotaMin":90,
    "minPagantesPorSaida":10,
    "capacidadeSentado":30,
    "capacidadeEmPe":10
  }'
```

### 2. Criar Operação

```bash
curl -X POST http://localhost:3000/admin/operacoes \
  -H "Content-Type: application/json" \
  -d '{
    "eventoId":"COLOQUE_EVENTO_ID",
    "dataISO":"2026-03-20T00:00:00.000Z"
  }'
```

### 3. Login do Motorista

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email":"motorista@teste.com",
    "senha":"senha123"
  }'
```

> Guarde o `token` retornado. Use-o no header `Authorization: Bearer <token>` em todas as rotas `/driver/*`.

### 4. Gerar Pacote Admin Direto

```bash
curl -X POST http://localhost:3000/admin/pacotes \
  -H "Content-Type: application/json" \
  -d '{
    "operacaoDiaId":"COLOQUE_OPERACAO_ID",
    "motoristaId":"COLOQUE_MOTORISTA_ID",
    "produtoTipo":"VOLTA",
    "quantidade":3
  }'
```

> Os passes retornados já trazem `assentoId` (1, 2, 3...).

### 5. Baixar Pacote Ativo do Motorista

```bash
curl http://localhost:3000/driver/pacotes/ativo \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT"
```

### 6. Vender Pass Online

```bash
curl -X POST http://localhost:3000/driver/vender \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "passId":"COLOQUE_PASS_ID",
    "nome":"Henrique",
    "telefone":"11888888888"
  }'
```

### 7. Scan — Entrada na Fila de IDA

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "tipo":"CHECKIN_IDA_FILA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 8. Scan — Embarque na Ida

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "tipo":"CHECKIN_IDA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 9. Scan — Entrada na Fila de Volta

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "tipo":"CHECKIN_VOLTA_FILA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 10. Scan — Embarque na Volta

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "tipo":"EMBARQUE_VOLTA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 11. Sync Offline

```bash
curl -X POST http://localhost:3000/driver/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "vendas":[
      {
        "idempotencyKey":"sale-001",
        "passId":"COLOQUE_PASS_ID",
        "nome":"Carlos",
        "telefone":"11777777777",
        "tsLocalISO":"2026-03-11T15:00:00.000Z"
      }
    ],
    "eventos":[
      {
        "passId":"COLOQUE_PASS_ID",
        "tipo":"CHECKIN_IDA_FILA",
        "tsLocalISO":"2026-03-11T15:10:00.000Z"
      }
    ]
  }'
```

### 12. Consultar Operação Ativa no Cliente

```bash
curl http://localhost:3000/cliente/operacao/ativa
```

### 13. Criar Compra Pendente do Cliente

```bash
curl -X POST http://localhost:3000/cliente/compra \
  -H "Content-Type: application/json" \
  -d '{
    "nome":"Gustavo",
    "telefone":"11999999999",
    "produtoTipo":"VOLTA",
    "quantidade":2
  }'
```

### 14. Confirmar Pagamento

```bash
curl -X POST http://localhost:3000/admin/confirmar-pagamento \
  -H "Content-Type: application/json" \
  -d '{
    "pendenciaToken":"COLE_AQUI_O_TOKEN",
    "motoristaId":"COLOQUE_MOTORISTA_ID"
  }'
```

### 15. Listar Passes do Cliente

```bash
curl "http://localhost:3000/cliente/passes?telefone=11999999999"
```

### 16. Re-scan do mesmo Pass (idempotência)

Repita qualquer scan anterior. O esperado é erro de estado inválido (transição impossível) ou resposta com `alreadyRecorded: true` — sem duplicação no banco.

### 17. QR Adulterado

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLOQUE_TOKEN_JWT" \
  -d '{
    "tipo":"CHECKIN_VOLTA_FILA",
    "qrPayload":"PAYLOAD_ADULTERADO",
    "qrSig":"SIG_ORIGINAL"
  }'
```

> Esperado: `400 { "ok": false, "message": "QR inválido: INVALID_SIGNATURE" }`.

### 18. Motorista Errado

Use um QR válido mas um token JWT de outro motorista. Esperado: `403`.

---

## Erros Mais Comuns

| Erro | Causa |
|---|---|
| `401 Autenticação necessária` | Token JWT ausente, inválido ou expirado. Refaça o login. |
| `401 Credenciais inválidas` | Email não cadastrado, motorista inativo ou senha errada. |
| `Operação não está ativa` | A `OperacaoDia` precisa ter status `ATIVA`. |
| `QR inválido: INVALID_SIGNATURE` | Payload adulterado ou chave pública incorreta. |
| `QR inválido: EXPIRED` | O QR passou do `exp` (fim das idas + 24h). |
| `Transição de estado inválida` | Ex: tentar `EMBARQUE_VOLTA` num pass `VENDIDO` (precisa ir para `NA_FILA` antes). |
| Variável de ambiente errada | Usar `QR_PUBLIC_KEY_B64URL` ao invés de `QR_PUBLIC_KEY_B64` faz o backend não encontrar a chave. |
| `pendenciaToken` quebrado | Token base64 incompleto em `POST /admin/confirmar-pagamento`. |

---

## Status do MVP

- ✅ Auth real do motorista (JWT HS256, scrypt nativo, 14 dias de expiração)
- ✅ Fila de IDA separada da fila de VOLTA
- ✅ Assento por pass (`assentoId`) para mapa visual futuro
- ✅ Capacidade da van por operação (sentado + em pé + total)
- ✅ Venda online e offline
- ✅ Emissão de QR assinado (Ed25519)
- ✅ Validação offline
- ✅ Antifraude por assinatura e motorista
- ✅ Sincronização idempotente (vendas + todos os tipos de evento)
- ✅ Fluxo cliente com compra pendente e emissão posterior

---

## Próximos Passos

- Mapa visual de assentos no app (frontend, usa `assentoId` já disponível)
- Painel admin web
- App motorista offline-first
- Tela cliente para compra e consulta de passes
- Gerenciamento de senha via painel (endpoint para definir/trocar senha do motorista)
