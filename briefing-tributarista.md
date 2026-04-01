# Briefing — Calculadora IRPFM 2026
**Documento interno para revisão por advogado tributarista**

---

## 1. O que a calculadora faz

A calculadora simula o valor do **Imposto de Renda da Pessoa Física Mínimo (IRPFM)**, instituído pela Lei nº 15.270/2025 (Reforma da Renda), aplicável a partir do ano-calendário 2026 (exercício 2027).

### Funcionalidades atuais:

- **Modo Básico**: o usuário informa a renda total anual e o IR já pago, e a calculadora retorna o IRPFM devido.
- **Modo Avançado**: o usuário detalha os rendimentos por categoria (salários, pró-labore, dividendos, aluguéis, renda fixa, ações, outros) e o IR já pago (IRRF + IR sobre investimentos).
- **Cálculo aplicado**:
  - Renda total anual **<= R$ 600.000**: alíquota 0% (isento)
  - Renda total anual **entre R$ 600.001 e R$ 1.199.999**: alíquota progressiva linear de 0% a 10%, calculada pela fórmula `(rendaTotal / 60.000) - 10`
  - Renda total anual **>= R$ 1.200.000**: alíquota fixa de 10%
- O imposto mínimo bruto é `alíquota x renda total` (sobre a base inteira, não apenas o excedente de R$ 600 mil)
- O IRPFM a pagar é `MAX(0, imposto mínimo bruto - IR já pago)`
- Os resultados atualizam em tempo real conforme o usuário digita
- Exibe tags de status: "Isento", "IR já pago cobre o mínimo" ou valor a pagar

### Rendimentos que a calculadora EXCLUI da base (conforme informativo na tela):
- Poupança, LCI/LCA, CRI/CRA
- FIIs e Fiagro
- Heranças e doações
- Indenizações por doença grave
- Ganho de capital em venda de imóvel (fora de bolsa)
- Aluguéis atrasados via ação judicial (RRA)

---

## 2. O que a calculadora NÃO faz

- **Não calcula o IRPF comum** (tabela progressiva mensal/anual) — apenas o adicional mínimo (IRPFM)
- **Não faz a DIRPF completa** — é uma simulação isolada do IRPFM
- **Não considera deduções** do IRPF (saúde, educação, dependentes, previdência) — a Lei 15.270 não prevê deduções para o cálculo do imposto mínimo
- **Não diferencia origem dos dividendos** — não distingue dividendos de PJ no Simples, Lucro Presumido ou Lucro Real
- **Não aplica a retenção de 10% sobre dividendos > R$ 50 mil/mês** — apenas informa ao usuário que essa retenção existe e que deve ser incluída no campo "IR já pago"
- **Não simula planejamento tributário** — não sugere reorganizações societárias, distribuição de lucros otimizada, etc.
- **Não valida se o IR informado pelo usuário está correto** — aceita o valor que o usuário digita como IR já pago
- **Não considera rendimentos do exterior** ou regimes especiais
- **Não tem disclaimers dinâmicos** sobre situações específicas (ex: MEI, profissional liberal com livro-caixa, etc.)

---

## 3. Perguntas e pedidos de sugestão

Gostaríamos da sua análise sobre os seguintes pontos:

### 3.1 Correção do cálculo
- A fórmula de alíquota progressiva `(rendaTotal / 60.000) - 10` está correta conforme sua leitura da Lei 15.270/2025?
- A base de cálculo é de fato a renda total (e não apenas o excedente de R$ 600 mil)?
- Há alguma nuance na compensação do IR já pago que não estamos contemplando?

### 3.2 Categorias de rendimento
- A lista de rendimentos incluídos e excluídos está completa e correta?
- Dividendos de empresas do Simples Nacional entram ou não na base do IRPFM?
- Rendimentos de participação em fundos exclusivos/offshore devem ser incluídos?
- JCP (Juros sobre Capital Próprio) deve ser tratado como rendimento tributável ou tem tratamento específico no IRPFM?

### 3.3 Funcionalidades adicionais sugeridas
O que você acha que seria útil adicionarmos à calculadora para os clientes do escritório? Alguns pontos que pensamos:

- **Comparativo "antes vs. depois"**: mostrar quanto o contribuinte pagaria sem o IRPFM vs. com o IRPFM
- **Simulação de cenários**: permitir ao usuário testar redistribuição de rendimentos (ex: converter parte dos dividendos em pró-labore) e ver o impacto
- **Alerta de faixa de transição**: destaque especial para quem está na faixa R$ 600k–1.2M, onde pequenos ajustes na renda podem ter impacto relevante
- **Campo para rendimentos isentos**: para o usuário registrar (mesmo que não afetem o cálculo), dando visão completa do patrimônio
- **Exportação em PDF**: resumo da simulação para anexar ao dossiê do cliente

### 3.4 Riscos e disclaimers
- O disclaimer atual está adequado? Devemos adicionar algo sobre:
  - Regulamentação pendente pela Receita Federal?
  - Possibilidade de ADI ou mudanças legislativas?
  - Limitações da simulação frente à declaração real?
- Há algum risco jurídico em disponibilizar essa ferramenta publicamente (mesmo com disclaimer)?

### 3.5 Outros pontos
- Algo mais que você considere relevante para a ferramenta ou para os clientes?

---

**Agradecemos sua revisão. Favor retornar com comentários, correções e sugestões para que possamos aprimorar a calculadora antes da divulgação aos clientes.**
