/**
 * Calculadora IRPFM 2026 — Souto Correa
 *
 * Arquitetura:
 *   - `state.lastResult` é a fonte única de verdade do resultado calculado.
 *     Toda vez que o usuário edita um input, `recalc()` é chamado, que:
 *       1. lê inputs via `readInputs()`
 *       2. computa o resultado via `computeResult(inputs)`
 *       3. monta `state.lastResult = buildResultState(inputs, computed)`
 *       4. renderiza o DOM via `render(state.lastResult)`
 *       5. atualiza visibilidade do bloco de captura de lead
 *
 *   - O bloco de captura de lead, ao submeter, envia POST /api/lead com
 *     { nome, email, consent, calc: state.lastResult } — reaproveitando
 *     o mesmo objeto que a calculadora usa internamente.
 */
(function () {
    'use strict';

    /* =========================================================
     * STATE
     * ========================================================= */
    var state = {
        lastResult: null
    };

    var LINHAS = [
        { id: 'salarios',   label: 'Salários / CLT' },
        { id: 'prolabore',  label: 'Pró-labore' },
        { id: 'alugueis',   label: 'Aluguéis' },
        { id: 'renda-fixa', label: 'Renda fixa tributável' },
        { id: 'acoes',      label: 'Ações / Bolsa' },
        { id: 'outros',     label: 'Outros tributáveis' }
    ];

    /* =========================================================
     * HELPERS — parse / format
     * ========================================================= */
    function parseBRL(str) {
        if (!str) return 0;
        var clean = String(str).replace(/[^\d,]/g, '').replace(',', '.');
        return parseFloat(clean) || 0;
    }

    function formatBRL(value) {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function parsePct(str) {
        if (!str) return null;
        var clean = String(str).replace(/[^\d,]/g, '').replace(',', '.');
        if (clean === '' || clean === '.') return null;
        var n = parseFloat(clean);
        if (isNaN(n)) return null;
        return n;
    }

    function fmtPct(x) {
        return x.toFixed(2).replace('.', ',') + '%';
    }

    function isValidEmail(s) {
        if (!s || typeof s !== 'string') return false;
        // Regex pragmática (não RFC completa, mas suficiente para captura web).
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
    }

    /* =========================================================
     * MASKS
     * ========================================================= */
    function maskMoney(input) {
        input.addEventListener('input', function () {
            var raw = input.value.replace(/\D/g, '');
            if (raw === '') { input.value = ''; recalc(); return; }
            var num = parseInt(raw, 10) / 100;
            input.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            recalc();
        });
    }

    function maskPct(input) {
        input.addEventListener('input', function () {
            var v = input.value.replace(/[^\d,]/g, '');
            var parts = v.split(',');
            if (parts.length > 2) v = parts[0] + ',' + parts.slice(1).join('');
            var p = v.split(',');
            if (p[0].length > 3) p[0] = p[0].slice(0, 3);
            if (p[1] !== undefined && p[1].length > 2) p[1] = p[1].slice(0, 2);
            input.value = p.join(',');
            recalc();
        });
        input.addEventListener('blur', function () {
            var n = parsePct(input.value);
            if (n === null) { input.value = ''; return; }
            if (n > 100) n = 100;
            input.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
            recalc();
        });
        input.addEventListener('focus', function () {
            input.value = input.value.replace('%', '').trim();
        });
    }

    /* =========================================================
     * DOMAIN — leitura dos inputs e cálculo
     * ========================================================= */
    function getActiveMode() {
        return document.querySelector('.tab.active').dataset.mode;
    }

    function regimeTemRedutor() {
        var sel = document.getElementById('regime-pj');
        if (!sel) return false;
        return sel.value === 'lucro-real' || sel.value === 'if-nao-banco' || sel.value === 'banco';
    }

    function getRegimeData() {
        var sel = document.getElementById('regime-pj');
        if (!sel) return null;
        var base;
        switch (sel.value) {
            case 'lucro-real':    base = { tipo: 'lucro-real',    aliqNominal: 34, teto: 34, label: 'Lucro Real' }; break;
            case 'if-nao-banco':  base = { tipo: 'if-nao-banco',  aliqNominal: 40, teto: 40, label: 'Instituição financeira não bancária' }; break;
            case 'banco':         base = { tipo: 'banco',         aliqNominal: 45, teto: 45, label: 'Banco / cooperativa de crédito' }; break;
            default:              return null;
        }
        var lucro = parseBRL((document.getElementById('lucro-pj') || {}).value || '');
        var irPj  = parseBRL((document.getElementById('ir-pj')    || {}).value || '');
        var aliqEfetiva = null;
        if (lucro > 0 && irPj > 0) {
            aliqEfetiva = (irPj / lucro) * 100;
            if (aliqEfetiva > 100) aliqEfetiva = 100;
        }
        base.aliqEfetiva = aliqEfetiva;
        base.aliqPJ = aliqEfetiva !== null ? aliqEfetiva : base.aliqNominal;
        base.usouEfetiva = aliqEfetiva !== null;
        base.lucroContabil = lucro > 0 ? lucro : null;
        base.irpjCsll = irPj > 0 ? irPj : null;
        return base;
    }

    function readInputs() {
        var mode = getActiveMode();
        var rendaTotal, irPago, dividendos = 0;
        var linhas = [];

        if (mode === 'basico') {
            rendaTotal = parseBRL(document.getElementById('renda-total').value);
            irPago     = parseBRL(document.getElementById('ir-pago').value);
        } else {
            dividendos = parseBRL(document.getElementById('dividendos').value);

            var somaLinhas = 0;
            LINHAS.forEach(function (linha) {
                var valor   = parseBRL(document.getElementById(linha.id).value);
                var aliqRaw = parsePct(document.getElementById('aliq-' + linha.id).value);
                somaLinhas += valor;
                linhas.push({
                    id: linha.id,
                    label: linha.label,
                    valor: valor,
                    aliq: aliqRaw,
                    irEfetivo: (aliqRaw !== null && valor > 0) ? (valor * aliqRaw / 100) : 0,
                    aliqInformada: aliqRaw !== null
                });
            });

            rendaTotal = somaLinhas + dividendos;
            irPago =
                parseBRL(document.getElementById('irrf').value) +
                parseBRL(document.getElementById('ir-invest').value);
        }

        return {
            modo: mode,
            rendaTotal: rendaTotal,
            irPago: irPago,
            dividendos: dividendos,
            linhas: linhas
        };
    }

    function calcIRPFM(rendaTotal) {
        if (rendaTotal <= 600000) return 0;
        if (rendaTotal >= 1200000) return 10;
        return (rendaTotal / 60000) - 10;
    }

    /**
     * Cálculo puro do resultado. Não toca no DOM.
     * Recebe os inputs lidos e devolve o objeto de resultado completo,
     * pronto para alimentar `state.lastResult` e o `render()`.
     */
    function computeResult(inputs) {
        var aliquota = calcIRPFM(inputs.rendaTotal);
        var bruto    = (aliquota / 100) * inputs.rendaTotal;

        // Redutor de dupla tributação (Lei 15.270/2025): só no avançado, com regime e dividendos > 0.
        // Usa alíquota EFETIVA da PJ quando informada (lucro contábil + IRPJ/CSLL);
        // senão cai para a nominal do regime.
        // Se (aliqPJ + aliqIRPFM) > teto, redutor = excesso × dividendos,
        // limitado à parcela do IRPFM atribuível aos dividendos.
        var regime = (inputs.modo === 'avancado') ? getRegimeData() : null;
        var redutor = 0;
        var soma = 0;
        var aliqCombFinal = null;

        if (regime && inputs.dividendos > 0) {
            soma = regime.aliqPJ + aliquota;
            if (soma > regime.teto) {
                var excessoPct = soma - regime.teto;
                var maxRedutor = (aliquota / 100) * inputs.dividendos;
                redutor = Math.min(maxRedutor, (excessoPct / 100) * inputs.dividendos);
            }
            var irpfmDivLiq = (aliquota / 100) * inputs.dividendos - redutor;
            aliqCombFinal = regime.aliqPJ + (irpfmDivLiq / inputs.dividendos) * 100;
        }

        var brutoFinal = bruto - redutor;
        var pagar = Math.max(0, brutoFinal - inputs.irPago);

        // Status — classificação textual
        var status, statusLabel;
        if (inputs.rendaTotal <= 600000) {
            status = 'isento';
            statusLabel = 'ISENTO — Renda abaixo de R$ 600 mil';
        } else if (pagar === 0) {
            if (redutor > 0) {
                status = 'coberto-com-redutor';
                statusLabel = 'IR JÁ PAGO + REDUTOR COBREM O MÍNIMO';
            } else {
                status = 'coberto';
                statusLabel = 'IR JÁ PAGO COBRE O MÍNIMO';
            }
        } else {
            status = 'a-pagar';
            statusLabel = 'IRPFM A PAGAR: ' + formatBRL(pagar);
        }

        // Diluição — só faz sentido no avançado, quando ao menos uma alíquota efetiva foi informada.
        var diluicao = null;
        if (inputs.modo === 'avancado' && inputs.linhas && inputs.linhas.length > 0) {
            var temAlgumaAliq = inputs.linhas.some(function (l) { return l.aliqInformada && l.valor > 0; });
            if (temAlgumaAliq) {
                var totalRenda = 0, totalIR = 0;
                var totalRendaSemDiv = 0, totalIRSemDiv = 0;
                inputs.linhas.forEach(function (l) {
                    if (l.valor <= 0 && !l.aliqInformada) return;
                    totalRenda      += l.valor;
                    totalIR         += l.irEfetivo;
                    totalRendaSemDiv += l.valor;
                    totalIRSemDiv    += l.irEfetivo;
                });
                if (inputs.dividendos > 0) totalRenda += inputs.dividendos;

                var aliqPondCom = totalRenda > 0 ? (totalIR / totalRenda) * 100 : 0;
                var aliqPondSem = totalRendaSemDiv > 0 ? (totalIRSemDiv / totalRendaSemDiv) * 100 : 0;
                diluicao = {
                    aliqPondCom: aliqPondCom,
                    aliqPondSem: inputs.dividendos > 0 ? aliqPondSem : null,
                    diluicaoPp:  inputs.dividendos > 0 ? (aliqPondSem - aliqPondCom) : null,
                    totalRenda: totalRenda,
                    totalIR: totalIR
                };
            }
        }

        return {
            aliquota: aliquota,
            bruto: bruto,
            redutor: redutor,
            soma: soma,
            aliqCombFinal: aliqCombFinal,
            pagar: pagar,
            status: status,
            statusLabel: statusLabel,
            regime: regime,
            diluicao: diluicao
        };
    }

    /**
     * Constrói o objeto único `state.lastResult` que vai ser:
     *   - usado pelo render() para popular o DOM
     *   - enviado para o backend (POST /api/lead) como `calc` quando o
     *     usuário submete o formulário de captura de lead
     */
    function buildResultState(inputs, c) {
        return {
            modo: inputs.modo,
            inputs: {
                rendaTotal: inputs.rendaTotal,
                irPago: inputs.irPago,
                dividendos: inputs.dividendos,
                linhas: inputs.linhas
            },
            resultado: {
                aliquota: c.aliquota,
                bruto: c.bruto,
                redutor: c.redutor,
                irCompensado: inputs.irPago,
                pagar: c.pagar,
                status: c.status,
                statusLabel: c.statusLabel
            },
            redutor: c.regime && inputs.dividendos > 0 && c.aliquota > 0 ? {
                regime: c.regime.tipo,
                regimeLabel: c.regime.label,
                aliqPJ: c.regime.aliqPJ,
                aliqPJNominal: c.regime.aliqNominal,
                aliqPJEfetiva: c.regime.aliqEfetiva,
                lucroContabil: c.regime.lucroContabil,
                irpjCsll: c.regime.irpjCsll,
                teto: c.regime.teto,
                soma: c.soma,
                aliqCombinada: c.aliqCombFinal,
                valorRedutor: c.redutor,
                usouEfetiva: c.regime.usouEfetiva
            } : null,
            diluicao: c.diluicao,
            timestamp: new Date().toISOString()
        };
    }

    /* =========================================================
     * RENDER — atualiza o DOM a partir do state
     * ========================================================= */
    function syncPjEffectiveFieldsVisibility() {
        var box = document.getElementById('pj-effective-fields');
        if (!box) return;
        if (regimeTemRedutor()) box.classList.add('visible');
        else box.classList.remove('visible');
    }

    function render(s) {
        var r = s.resultado;
        var pct = Math.min(r.aliquota, 10);

        document.getElementById('gauge-fill').style.width = (pct / 10 * 100) + '%';
        document.getElementById('res-aliquota-pct').textContent = fmtPct(r.aliquota);

        document.getElementById('res-renda').textContent      = formatBRL(s.inputs.rendaTotal);
        document.getElementById('res-aliquota').textContent   = fmtPct(r.aliquota);
        document.getElementById('res-bruto').textContent      = formatBRL(r.bruto);
        document.getElementById('res-compensado').textContent = formatBRL(r.irCompensado);
        document.getElementById('res-pagar').textContent      = r.pagar > 0 ? formatBRL(r.pagar) : 'Nada a pagar';

        // Linhas do redutor
        var rowAliqPJ   = document.getElementById('row-aliq-pj');
        var rowSoma     = document.getElementById('row-soma');
        var rowRedutor  = document.getElementById('row-redutor');
        var rowAliqComb = document.getElementById('row-aliq-comb');
        var lblAliqPJ   = document.getElementById('lbl-aliq-pj');

        if (s.redutor) {
            rowAliqPJ.style.display = '';
            rowSoma.style.display = '';
            rowAliqComb.style.display = '';
            lblAliqPJ.textContent = s.redutor.usouEfetiva
                ? 'Alíquota efetiva PJ pagadora (informada)'
                : 'Alíquota nominal PJ pagadora (regime)';
            document.getElementById('res-aliq-pj').textContent   = fmtPct(s.redutor.aliqPJ);
            document.getElementById('res-soma').textContent      = fmtPct(s.redutor.soma);
            document.getElementById('res-aliq-comb').textContent = fmtPct(s.redutor.aliqCombinada);

            if (s.redutor.valorRedutor > 0) {
                rowRedutor.style.display = '';
                document.getElementById('res-redutor').textContent = '− ' + formatBRL(s.redutor.valorRedutor);
            } else {
                rowRedutor.style.display = 'none';
            }
        } else {
            rowAliqPJ.style.display = 'none';
            rowSoma.style.display = 'none';
            rowRedutor.style.display = 'none';
            rowAliqComb.style.display = 'none';
        }

        // Status tag
        var container = document.getElementById('status-container');
        container.innerHTML = '';
        var tag = document.createElement('span');
        tag.className = 'status-tag';
        if (r.status === 'isento' || r.status === 'coberto' || r.status === 'coberto-com-redutor') {
            tag.classList.add('green');
        } else {
            tag.classList.add('orange');
        }
        tag.textContent = r.statusLabel;
        container.appendChild(tag);

        // Nota explicativa do redutor (se aplicável)
        if (s.redutor && s.redutor.valorRedutor > 0) {
            var note = document.createElement('div');
            note.style.cssText = 'margin-top:10px; font-size:12px; color:#635C54; line-height:1.5;';
            var origem = s.redutor.usouEfetiva ? 'efetiva' : 'nominal';
            note.innerHTML = 'O <strong>redutor de dupla tributação</strong> reduziu o IRPFM em <strong>' +
                formatBRL(s.redutor.valorRedutor) + '</strong> para que a soma da tributação da PJ (alíquota ' + origem + ' ' +
                fmtPct(s.redutor.aliqPJ) + ') com a alíquota efetiva do IRPFM sobre os dividendos não ultrapasse o teto de ' +
                fmtPct(s.redutor.teto) + '.';
            container.appendChild(note);
        }

        // Diluição
        renderDilution(s);

        // Lead capture
        updateLeadCaptureVisibility(s);
    }

    function renderDilution(s) {
        var section = document.getElementById('dilution-section');
        var tbody = document.getElementById('dilution-tbody');
        if (!section || !tbody) return;

        if (!s.diluicao) {
            section.classList.remove('visible');
            return;
        }

        section.classList.add('visible');
        tbody.innerHTML = '';

        s.inputs.linhas.forEach(function (l) {
            if (l.valor <= 0 && !l.aliqInformada) return;
            var tr = document.createElement('tr');
            var aliqStr = l.aliqInformada ? fmtPct(l.aliq) : '—';
            tr.innerHTML =
                '<td class="line-name">' + l.label + '</td>' +
                '<td>' + formatBRL(l.valor) + '</td>' +
                '<td>' + aliqStr + '</td>' +
                '<td>' + formatBRL(l.irEfetivo) + '</td>';
            tbody.appendChild(tr);
        });

        if (s.inputs.dividendos > 0) {
            var trDiv = document.createElement('tr');
            trDiv.innerHTML =
                '<td class="line-name">Dividendos / Lucros</td>' +
                '<td>' + formatBRL(s.inputs.dividendos) + '</td>' +
                '<td>0,00%</td>' +
                '<td>' + formatBRL(0) + '</td>';
            tbody.appendChild(trDiv);
        }

        var trTotal = document.createElement('tr');
        trTotal.className = 'dilution-total';
        trTotal.innerHTML =
            '<td class="line-name">Total</td>' +
            '<td>' + formatBRL(s.diluicao.totalRenda) + '</td>' +
            '<td>' + fmtPct(s.diluicao.aliqPondCom) + '</td>' +
            '<td>' + formatBRL(s.diluicao.totalIR) + '</td>';
        tbody.appendChild(trTotal);

        document.getElementById('dilution-aliq-com').textContent = fmtPct(s.diluicao.aliqPondCom);
        document.getElementById('dilution-aliq-sem').textContent =
            s.diluicao.aliqPondSem !== null ? fmtPct(s.diluicao.aliqPondSem) : '— (sem dividendos)';
        document.getElementById('dilution-pp').textContent =
            s.diluicao.diluicaoPp !== null
                ? '−' + s.diluicao.diluicaoPp.toFixed(2).replace('.', ',') + ' p.p.'
                : '—';
    }

    /* =========================================================
     * RECALC — orquestrador
     * ========================================================= */
    function recalc() {
        syncPjEffectiveFieldsVisibility();
        var inputs = readInputs();
        var computed = computeResult(inputs);
        state.lastResult = buildResultState(inputs, computed);
        render(state.lastResult);
    }

    /* =========================================================
     * LEAD CAPTURE
     *
     * Captura de lead para o mailing do tributário.
     * Público inicial é mailing curado com opt-in prévio; ainda assim,
     * coletamos consentimento explícito (checkbox LGPD) e enviamos
     * ao backend, que valida e armazena no Mailchimp com tags.
     * ========================================================= */
    function updateLeadCaptureVisibility(s) {
        var section = document.getElementById('lead-capture');
        if (!section) return;
        if (s && s.inputs && s.inputs.rendaTotal > 0) {
            section.hidden = false;
        } else {
            section.hidden = true;
        }
    }

    function setLeadStatus(kind, text) {
        var el = document.getElementById('lead-status');
        if (!el) return;
        el.className = 'lead-status' + (kind ? ' ' + kind : '');
        el.textContent = text || '';
    }

    function setSubmitEnabled() {
        var btn = document.getElementById('lead-submit');
        var consent = document.getElementById('lead-consent');
        if (!btn || !consent) return;
        // Habilitado SOMENTE quando o checkbox está marcado.
        // Validação de nome/email/state ocorre no submit; aqui só travamos pelo consentimento.
        btn.disabled = !consent.checked || btn.dataset.sent === '1';
    }

    function onConsentChange() {
        setSubmitEnabled();
        // Se o usuário tentou enviar sem marcar antes, limpa o aviso quando ele marcar.
        var status = document.getElementById('lead-status');
        if (status && status.classList.contains('error')) {
            var msg = status.textContent || '';
            if (/consentimento|marque/i.test(msg)) setLeadStatus('', '');
        }
    }

    function onLeadSubmit(e) {
        e.preventDefault();

        var btn = document.getElementById('lead-submit');
        var nomeEl    = document.getElementById('lead-nome');
        var emailEl   = document.getElementById('lead-email');
        var consentEl = document.getElementById('lead-consent');

        var nome    = (nomeEl.value  || '').trim();
        var email   = (emailEl.value || '').trim();
        var consent = !!consentEl.checked;

        // Validações no front (o backend revalida).
        if (!consent) {
            setLeadStatus('error', 'Marque o consentimento para enviar.');
            return;
        }
        if (nome.length < 2) {
            setLeadStatus('error', 'Informe seu nome (mínimo 2 caracteres).');
            nomeEl.focus();
            return;
        }
        if (!isValidEmail(email)) {
            setLeadStatus('error', 'Informe um email válido.');
            emailEl.focus();
            return;
        }
        if (!state.lastResult || !state.lastResult.inputs || state.lastResult.inputs.rendaTotal <= 0) {
            setLeadStatus('error', 'Preencha a calculadora antes de enviar.');
            return;
        }

        btn.disabled = true;
        var originalLabel = btn.textContent;
        btn.textContent = 'Enviando…';
        setLeadStatus('info', '');

        fetch('/api/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: nome,
                email: email,
                consent: true,
                calc: state.lastResult
            })
        }).then(function (resp) {
            if (resp.ok) {
                setLeadStatus('success', 'Pronto. O relatório chega no seu email em instantes.');
                btn.textContent = 'Enviado';
                btn.dataset.sent = '1';
                btn.disabled = true;
                // Após sucesso, mantemos o botão travado para evitar duplo envio.
            } else {
                return resp.json().catch(function () { return {}; }).then(function (errData) {
                    var msg = (errData && errData.error)
                        ? errData.error
                        : 'Não foi possível enviar agora. Tente novamente em alguns minutos.';
                    setLeadStatus('error', msg);
                    btn.textContent = originalLabel;
                    setSubmitEnabled();
                });
            }
        }).catch(function (err) {
            console.error('[lead] erro de rede', err);
            setLeadStatus('error', 'Não foi possível enviar agora. Tente novamente em alguns minutos.');
            btn.textContent = originalLabel;
            setSubmitEnabled();
        });
    }

    /* =========================================================
     * DISCLAIMER MODAL
     * ========================================================= */
    function initDisclaimer() {
        var overlay   = document.getElementById('disclaimer-overlay');
        var btnAccept = document.getElementById('accept-disclaimer');
        var btnReopen = document.getElementById('reopen-disclaimer');

        function openDisclaimer() {
            if (!overlay) return;
            overlay.classList.add('visible');
            document.body.style.overflow = 'hidden';
        }
        function closeDisclaimer() {
            if (!overlay) return;
            overlay.classList.remove('visible');
            document.body.style.overflow = '';
            try { sessionStorage.setItem('irpfm-disclaimer-ack', '1'); } catch (e) {}
        }

        var alreadyAck = false;
        try { alreadyAck = sessionStorage.getItem('irpfm-disclaimer-ack') === '1'; } catch (e) {}
        if (!alreadyAck) openDisclaimer();

        if (btnAccept) btnAccept.addEventListener('click', closeDisclaimer);
        if (btnReopen) btnReopen.addEventListener('click', openDisclaimer);
        if (overlay) overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeDisclaimer();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('visible')) closeDisclaimer();
        });
    }

    /* =========================================================
     * BOOTSTRAP
     * ========================================================= */
    function init() {
        // Tabs
        var tabs = document.querySelectorAll('.tab');
        var panels = document.querySelectorAll('.mode-panel');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                tabs.forEach(function (t) { t.classList.remove('active'); });
                panels.forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.mode).classList.add('active');
                recalc();
            });
        });

        // Masks
        document.querySelectorAll('input.input-aliq').forEach(maskPct);
        document.querySelectorAll('.mode-panel input[type="text"]').forEach(function (el) {
            if (!el.classList.contains('input-aliq')) maskMoney(el);
        });

        // Regime PJ
        var regimeSel = document.getElementById('regime-pj');
        if (regimeSel) regimeSel.addEventListener('change', recalc);

        // Lead capture
        var consentEl = document.getElementById('lead-consent');
        if (consentEl) consentEl.addEventListener('change', onConsentChange);
        var leadForm = document.getElementById('lead-form');
        if (leadForm) leadForm.addEventListener('submit', onLeadSubmit);
        setSubmitEnabled();

        // Disclaimer
        initDisclaimer();

        // Primeiro cálculo
        recalc();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
