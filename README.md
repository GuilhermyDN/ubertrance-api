# Uber Trance API — POC MVP

> **Base URL:** `http://localhost:3000`  
> **Formato:** `application/json`

---

## Visão Geral

Esta API implementa a POC do **Uber Trance** com:

- Operação do dia (`OperacaoDia`)
- Produtos: `IDA`, `VOLTA`, `COMBO`, `EM_PE`
- Pacotes de passes por motorista
- QR assinado com **Ed25519**
- Venda online e offline
- Validação de QR com antifraude
- Sincronização idempotente
- Fluxo de cliente para compra e emissão posterior

A arquitetura do MVP usa um único servidor **Fastify**, com separação lógica por prefixo de rota: `/admin`, `/driver`, `/cliente`.

---

## Stack

- Fastify
- Prisma
- PostgreSQL
- TypeScript
- Zod
- Ed25519 (assinatura dos QRs)

---

## Estrutura de Arquivos

```
src/
  server.ts
  prisma.ts
  routes/
    admin.ts
    driver.ts
    client.ts
  seed.ts
```

---

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL="postgresql://postgres:sua_senha@localhost:5432/ubertrance?schema=public"
PORT=3000

QR_PUBLIC_KEY_B64="COLE_AQUI_A_CHAVE_PUBLICA_EM_BASE64"
QR_PRIVATE_KEY_B64="COLE_AQUI_A_CHAVE_PRIVADA_EM_BASE64"
```

> ⚠️ **Atenção:** Use exatamente `QR_PUBLIC_KEY_B64` e `QR_PRIVATE_KEY_B64`. Não use `QR_PUBLIC_KEY_B64URL` nem `QR_PRIVATE_KEY_B64URL`.

---

## Instalação e Execução

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

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
| `Pass` | Estados principais: `DISPONIVEL`, `VENDIDO`, `USADO_IDA`, `NA_FILA`, `EMBARCOU`. |
| `EventoScanner` | Eventos registrados no scan: `CHECKIN_IDA`, `CHECKIN_VOLTA_FILA`, `EMBARQUE_VOLTA`. |
| `VendaLocal` | Venda armazenada no app para sincronização posterior. |
| `SyncCursor` | Controle do último sync realizado por motorista. |

---

## Formato do QR

Cada pass possui um `payload` e uma `sig` (assinatura). O payload assinado contém, no mínimo:

```json
{
  "v": 1,
  "passId": "uuid",
  "operacaoDiaId": "uuid",
  "eventoId": "uuid",
  "produto": "IDA|VOLTA|COMBO|EM_PE",
  "produtoTipo": "IDA|VOLTA|COMBO|EM_PE",
  "motoristaId": "uuid",
  "nonce": "random",
  "iat": 1770000000000,
  "exp": 1770000000000
}
```

**Regras do QR:**
- A assinatura é feita via Ed25519.
- O app do motorista valida a assinatura localmente.
- O QR precisa pertencer ao mesmo `motoristaId` do aparelho logado.
- QR adulterado ou expirado deve falhar.

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

Gera pacote de passes para um motorista. Cada pass já sai com `payload` e `sig`.

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
      "payload": "{...}",
      "sig": "base64url"
    }
  ]
}
```

---

### `POST /admin/confirmar-pagamento`

Confirma uma compra pendente criada pelo cliente e emite os passes no backend.

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

### `GET /driver/qr/public-key`

Retorna a chave pública PEM usada na verificação do QR.

```json
{
  "ok": true,
  "publicKeyPem": "-----BEGIN PUBLIC KEY----- ..."
}
```

---

### `GET /driver/pacotes/ativo`

Baixa a operação ativa do motorista, sua chave pública e os pacotes disponíveis.

**Header obrigatório:** `x-motorista-id: uuid`

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
    "titulo": "Rave Teste"
  },
  "capacidadeRestante": {
    "sentado": 30,
    "emPe": 10
  },
  "proximaSaidaEstimada": "2026-03-20T12:40:00.000Z",
  "pacotes": [
    {
      "id": "uuid",
      "passes": [
        {
          "id": "uuid",
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

---

### `POST /driver/vender`

Venda online de um pass que ainda está `DISPONIVEL`.

**Header obrigatório:** `x-motorista-id: uuid`

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

Valida QR e registra evento de scanner.

**Header obrigatório:** `x-motorista-id: uuid`

**Body:**
```json
{
  "tipo": "CHECKIN_VOLTA_FILA",
  "qrPayload": "{...}",
  "qrSig": "base64url"
}
```

**Tipos permitidos:** `CHECKIN_IDA`, `CHECKIN_VOLTA_FILA`, `EMBARQUE_VOLTA`

> **Regras:** Assinatura válida, não expirado, `motoristaId` igual ao logado, compatível com banco, sem replay inválido, transição de estado correta.

---

### `POST /driver/sync`

Sincroniza vendas offline e eventos offline.

**Header obrigatório:** `x-motorista-id: uuid`

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
      "tipo": "CHECKIN_VOLTA_FILA",
      "tsLocalISO": "2026-03-11T15:10:00.000Z"
    }
  ]
}
```

> **Regras:** Idempotente (não duplica venda ou evento), atualiza `SyncCursor`.

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

### Admin → Driver

1. Criar evento
2. Criar operação
3. Gerar pacote para motorista
4. Motorista baixa pacote ativo
5. Motorista vende ou escaneia
6. Sincroniza quando necessário

### Cliente → Admin

1. Cliente consulta operação ativa
2. Cliente cria compra pendente
3. Admin confirma pagamento
4. Backend emite os passes
5. Cliente consulta seus passes

### Offline do Motorista

1. Baixa pacote e chave pública antes de perder internet
2. Valida QR localmente
3. Salva vendas e eventos localmente
4. Envia tudo depois via `POST /driver/sync`

---

## Regras de Negócio

- Cada pass pertence a um único pacote.
- Cada pacote pertence a um único motorista.
- `motoristaId` precisa existir no QR.
- `EM_PE` tem limite próprio.
- Venda online e offline precisam respeitar a capacidade.
- A fila da volta usa `CHECKIN_VOLTA_FILA`.
- Reuso de QR deve ser bloqueado.
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

### 3. Consultar Operação Ativa no Cliente

```bash
curl http://localhost:3000/cliente/operacao/ativa
```

### 4. Criar Compra Pendente do Cliente

> Guarde o `pendenciaToken` retornado.

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

### 5. Confirmar Pagamento

```bash
curl -X POST http://localhost:3000/admin/confirmar-pagamento \
  -H "Content-Type: application/json" \
  -d '{
    "pendenciaToken":"COLE_AQUI_O_TOKEN",
    "motoristaId":"COLOQUE_MOTORISTA_ID"
  }'
```

### 6. Listar Passes do Cliente

```bash
curl "http://localhost:3000/cliente/passes?telefone=11999999999"
```

### 7. Gerar Pacote Admin Direto

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

### 8. Baixar Pacote Ativo do Motorista

```bash
curl http://localhost:3000/driver/pacotes/ativo \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID"
```

### 9. Vender Pass Online

```bash
curl -X POST http://localhost:3000/driver/vender \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
  -d '{
    "passId":"COLOQUE_PASS_ID",
    "nome":"Henrique",
    "telefone":"11888888888"
  }'
```

### 10. Scan de Ida

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
  -d '{
    "tipo":"CHECKIN_IDA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 11. Scan para Fila da Volta

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
  -d '{
    "tipo":"CHECKIN_VOLTA_FILA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 12. Embarque da Volta

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
  -d '{
    "tipo":"EMBARQUE_VOLTA",
    "qrPayload":"COLE_O_PAYLOAD",
    "qrSig":"COLE_A_SIG"
  }'
```

### 13. Re-scan do mesmo Pass

Repita o mesmo scan anterior. O esperado é erro de estado inválido ou marcação idempotente sem duplicação.

### 14. QR Adulterado

```bash
curl -X POST http://localhost:3000/driver/scan \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
  -d '{
    "tipo":"CHECKIN_VOLTA_FILA",
    "qrPayload":"PAYLOAD_ADULTERADO",
    "qrSig":"SIG_ORIGINAL"
  }'
```

> Esperado: falha de assinatura.

### 15. Motorista Errado

Use um QR válido, mas envie outro `x-motorista-id`. Esperado: `403`.

### 16. Sync Idempotente

Rode duas vezes. Não pode duplicar nada.

```bash
curl -X POST http://localhost:3000/driver/sync \
  -H "Content-Type: application/json" \
  -H "x-motorista-id: COLOQUE_MOTORISTA_ID" \
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
        "tipo":"CHECKIN_VOLTA_FILA",
        "tsLocalISO":"2026-03-11T15:10:00.000Z"
      }
    ]
  }'
```

### 17. Cliente sem passes

```bash
curl "http://localhost:3000/cliente/passes?telefone=11000000000"
```

> Esperado: `total: 0`.

---

## Erros Mais Comuns

| Erro | Causa |
|---|---|
| Operação não está ativa | Se a `OperacaoDia` não estiver `ATIVA`, várias rotas falham. |
| Rotas `/cliente/*` retornam 404 | `clientRoutes` não foi registrado no `server.ts`. |
| Variável de ambiente errada | Usar `QR_PUBLIC_KEY_B64URL` no `.env` fará o backend não encontrar a chave. |
| `pendenciaToken` quebrado | Se o token base64 vier incompleto, `POST /admin/confirmar-pagamento` falha. |
| Scan com motorista errado | O QR precisa pertencer ao mesmo `motoristaId` do motorista logado. |

---

## Status do MVP

Este MVP cobre:

- ✅ Venda online e offline
- ✅ Emissão de QR assinado
- ✅ Validação offline
- ✅ Antifraude básica por assinatura e motorista
- ✅ Sincronização segura
- ✅ Fluxo cliente com compra pendente e emissão posterior

---

## Próximos Passos

- Painel admin web
- App motorista offline-first
- Tela cliente para compra e consulta de passes