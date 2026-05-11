# Calculadora IRPFM 2026 — Souto Correa

Simulador do Imposto de Renda da Pessoa Física Mínimo (IRPFM) instituído
pela Lei nº 15.270/2025, com captura de lead integrada ao Mailchimp.

## Estrutura

```
.
├── server.js            # Express: serve estáticos + POST /api/lead
├── package.json
├── .env.example         # Modelo das variáveis de ambiente
├── .gitignore
└── public/              # Front estático
    ├── index.html
    ├── styles.css
    ├── app.js           # Lógica da calculadora + lead capture
    ├── favicon.svg
    └── logo_branco.png
```

## Rodando localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# editar .env com as credenciais reais do Mailchimp

# 3. Subir o servidor
npm start
# servidor em http://localhost:3000
```

## Variáveis de ambiente

| Variável     | O que é                                                                                          |
|--------------|--------------------------------------------------------------------------------------------------|
| `MC_API_KEY` | Chave da API Mailchimp (Account → Profile → Extras → API keys).                                  |
| `MC_DC`      | Data center da conta. Costuma ser o sufixo da API key após o `-` (ex.: `us21`).                  |
| `MC_LIST_ID` | ID da Audience que recebe os leads (Audience → Settings → Audience name and defaults).           |
| `PORT`       | Porta HTTP. Opcional em local (default 3000). Em produção, o Railway injeta automaticamente.     |

## Endpoints

- `GET /` — serve a calculadora (`public/index.html`).
- `POST /api/lead` — recebe `{ nome, email, consent, calc }`, valida e
  envia ao Mailchimp via PUT no membro identificado por `MD5(email)`.
  Tags dinâmicas (`status-*`, `faixa-renda-*`, `tem-dividendos`,
  `redutor-ativado`, `modo-avancado`) e merge fields (`FNAME`, `RENDA`,
  `ALIQUOTA`, `IRPFM`, `STATUS`, `FAIXA`, `DIVIDEND`, `REGIME_PJ`,
  `REDUTOR`, `DILUICAO`) são derivados do `calc`.
- `GET /health` — health check.

## Mailchimp — pré-requisitos

Os 10 merge fields acima precisam existir na Audience **antes** do
primeiro lead, com exatamente esses tags (sem isso o Mailchimp aceita
o request mas descarta o campo).

| Merge tag    | Tipo                | Exemplo                |
|--------------|---------------------|------------------------|
| `FNAME`      | text                | "Paulo"                |
| `RENDA`      | number              | 850000                 |
| `ALIQUOTA`   | number (2 decimais) | 4.17                   |
| `IRPFM`      | number              | 0                      |
| `STATUS`     | text                | "a-pagar"              |
| `FAIXA`      | text                | "1.2M-3M"              |
| `DIVIDEND`   | number              | 500000                 |
| `REGIME_PJ`  | text                | "lucro-real"           |
| `REDUTOR`    | number              | 0                      |
| `DILUICAO`   | number (2 decimais) | 8.63                   |

## Testando o POST /api/lead localmente

```bash
curl -X POST http://localhost:3000/api/lead \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Paulo Teste",
    "email": "paulo+teste@example.com",
    "consent": true,
    "calc": {
      "modo": "avancado",
      "inputs": { "rendaTotal": 1500000, "irPago": 50000, "dividendos": 800000, "linhas": [] },
      "resultado": { "aliquota": 10, "bruto": 150000, "redutor": 0, "irCompensado": 50000, "pagar": 100000, "status": "a-pagar", "statusLabel": "IRPFM A PAGAR: R$ 100.000,00" },
      "redutor": null,
      "diluicao": null,
      "timestamp": "2026-05-08T13:00:00.000Z"
    }
  }'
```

Resposta esperada: `200 { "ok": true }` em sucesso, `400` em validação
inválida, `502` se o Mailchimp falhar.

## LGPD

A captura de lead exige consentimento explícito por checkbox no
formulário, com link para `/politica-de-privacidade`. O backend
revalida o consentimento e rejeita (`400`) se ausente. O `calc`
completo, IP e user agent são logados em `console.log` para rastro de
curto prazo (retenção curta no Railway). Para uso público da
calculadora, ver comentário no `public/index.html` sobre persistência
de consentimento e double opt-in.

## Deploy

Railway, branch `main`. Build automático na push. Variáveis de
ambiente configuradas no dashboard do serviço.
