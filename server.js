/**
 * Calculadora IRPFM 2026 — servidor Express.
 *
 * Responsabilidades:
 *   1. Servir os arquivos estáticos da calculadora a partir de ./public
 *   2. Expor POST /api/lead para captura de lead com integração Mailchimp
 *
 * Variáveis de ambiente esperadas (Railway):
 *   - MC_API_KEY   chave da API Mailchimp
 *   - MC_DC        data center da conta (ex.: "us21")
 *   - MC_LIST_ID   ID da audiência (lista) que recebe os leads
 *   - PORT         (opcional, default 3000) porta HTTP
 *
 * Em desenvolvimento local, lê do arquivo .env (dotenv). Em produção,
 * o Railway injeta diretamente — dotenv simplesmente não encontra .env
 * e segue sem erro.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
 * MIDDLEWARE
 * ============================================================ */
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
 * HELPERS
 * ============================================================ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function md5Lower(email) {
    return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
}

function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Classifica a renda em faixas — usado tanto no merge field FAIXA quanto
 * para gerar a tag dinâmica de segmentação.
 */
function faixaRenda(rendaTotal) {
    if (rendaTotal < 600000)  return '< 600k';
    if (rendaTotal < 1200000) return '600k-1.2M';
    if (rendaTotal < 3000000) return '1.2M-3M';
    return '3M+';
}

function tagFaixa(rendaTotal) {
    if (rendaTotal < 600000)  return 'faixa-renda-menor-600';
    if (rendaTotal < 1200000) return 'faixa-renda-600-1200';
    if (rendaTotal < 3000000) return 'faixa-renda-1200-3000';
    return 'faixa-renda-3000-plus';
}

/**
 * Monta os merge fields do Mailchimp a partir do objeto `calc` enviado
 * pelo frontend (state.lastResult). Estes campos precisam EXISTIR
 * previamente na Audience do Mailchimp (Audience → Settings → Audience
 * fields and *|MERGE|* tags). Sem o tag criado, o Mailchimp simplesmente
 * ignora o campo.
 */
function buildMergeFields(nome, calc) {
    const aliquota = isFiniteNumber(calc.resultado.aliquota) ? calc.resultado.aliquota : 0;
    const pagar    = isFiniteNumber(calc.resultado.pagar)    ? calc.resultado.pagar    : 0;
    const renda    = isFiniteNumber(calc.inputs.rendaTotal)  ? calc.inputs.rendaTotal  : 0;
    const div      = isFiniteNumber(calc.inputs.dividendos)  ? calc.inputs.dividendos  : 0;

    const redutorValor   = (calc.redutor && isFiniteNumber(calc.redutor.valorRedutor))
        ? calc.redutor.valorRedutor : 0;
    const regimePj       = (calc.redutor && calc.redutor.regime) || 'nao-informado';
    const diluicaoPp     = (calc.diluicao && isFiniteNumber(calc.diluicao.diluicaoPp))
        ? calc.diluicao.diluicaoPp : 0;

    return {
        FNAME:     nome,
        RENDA:     Math.round(renda),
        ALIQUOTA:  Number(aliquota.toFixed(2)),
        IRPFM:     Math.round(pagar),
        STATUS:    calc.resultado.status,           // 'isento' | 'coberto' | 'coberto-com-redutor' | 'a-pagar'
        FAIXA:     faixaRenda(renda),
        DIVIDEND:  Math.round(div),
        REGIME_PJ: regimePj,
        REDUTOR:   Math.round(redutorValor),
        DILUICAO:  Number(diluicaoPp.toFixed(2))
    };
}

/**
 * Tags dinâmicas para segmentação rápida no Mailchimp.
 */
function buildTags(calc) {
    const tags = ['calculadora-irpfm'];

    // Status (mapeia "coberto-com-redutor" para o mesmo bucket "coberto"
    // para evitar inflar a quantidade de tags semelhantes).
    if (calc.resultado.status === 'isento')        tags.push('status-isento');
    else if (calc.resultado.status === 'a-pagar')  tags.push('status-a-pagar');
    else                                            tags.push('status-coberto');

    tags.push(tagFaixa(calc.inputs.rendaTotal));

    if (calc.inputs.dividendos > 0)                tags.push('tem-dividendos');
    if (calc.redutor && calc.redutor.valorRedutor > 0) tags.push('redutor-ativado');
    if (calc.modo === 'avancado')                  tags.push('modo-avancado');

    return tags;
}

/* ============================================================
 * POST /api/lead
 * ============================================================ */
app.post('/api/lead', async (req, res) => {
    const { nome, email, consent, calc } = req.body || {};

    // ---- Validações ----
    if (typeof nome !== 'string' || nome.trim().length < 2) {
        return res.status(400).json({ error: 'Nome inválido (mínimo 2 caracteres).' });
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return res.status(400).json({ error: 'Email inválido.' });
    }
    if (consent !== true) {
        return res.status(400).json({ error: 'Consentimento obrigatório.' });
    }
    if (!calc || typeof calc !== 'object' || !calc.inputs || !calc.resultado) {
        return res.status(400).json({ error: 'Dados de simulação ausentes.' });
    }
    if (!isFiniteNumber(calc.inputs.rendaTotal) || calc.inputs.rendaTotal <= 0) {
        return res.status(400).json({ error: 'Simulação inválida (renda total <= 0).' });
    }

    // ---- Config ----
    const { MC_API_KEY, MC_DC, MC_LIST_ID } = process.env;
    if (!MC_API_KEY || !MC_DC || !MC_LIST_ID) {
        console.error('[lead] Mailchimp env vars não configuradas (MC_API_KEY / MC_DC / MC_LIST_ID).');
        return res.status(502).json({ error: 'Servidor mal configurado.' });
    }

    const cleanNome  = nome.trim();
    const cleanEmail = email.trim().toLowerCase();
    const subscriberHash = md5Lower(cleanEmail);
    const url = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${subscriberHash}`;

    const mcBody = {
        email_address:  cleanEmail,
        status_if_new:  'subscribed',
        merge_fields:   buildMergeFields(cleanNome, calc),
        tags:           buildTags(calc)
    };

    // Log "caminho 2" — rastro de curto prazo no log do Railway com o
    // payload completo enviado pelo front. Útil para auditar leads
    // recentes sem persistir em banco.
    console.log('[lead]', JSON.stringify({
        timestamp: new Date().toISOString(),
        nome: cleanNome,
        email: cleanEmail,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        mcMergeFields: mcBody.merge_fields,
        mcTags: mcBody.tags,
        calc: calc
    }));

    // ---- Chamada ao Mailchimp ----
    try {
        const authHeader = 'Basic ' + Buffer.from('anystring:' + MC_API_KEY).toString('base64');

        const mcResp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type':  'application/json'
            },
            body: JSON.stringify(mcBody)
        });

        if (mcResp.ok) {
            return res.status(200).json({ ok: true });
        }

        // Tenta extrair o payload de erro do Mailchimp.
        let errPayload = {};
        try { errPayload = await mcResp.json(); } catch (e) { /* ignore */ }

        // "Member Exists" é o erro idempotente clássico do POST de membros
        // no Mailchimp; com PUT raramente acontece, mas tratamos defensivamente.
        if (errPayload.title === 'Member Exists' ||
            (errPayload.detail && /exists/i.test(errPayload.detail))) {
            console.log('[lead] Member exists — tratando como sucesso (idempotência).');
            return res.status(200).json({ ok: true });
        }

        console.error('[lead] Mailchimp respondeu erro:', mcResp.status, errPayload);
        return res.status(502).json({ error: 'Não foi possível enviar agora.' });
    } catch (err) {
        console.error('[lead] Falha de rede ao chamar Mailchimp:', err);
        return res.status(502).json({ error: 'Não foi possível enviar agora.' });
    }
});

/* ============================================================
 * HEALTH
 * ============================================================ */
app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

/* ============================================================
 * START
 * ============================================================ */
app.listen(PORT, () => {
    console.log(`Calculadora IRPFM rodando em http://localhost:${PORT}`);
});
