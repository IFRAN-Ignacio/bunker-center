document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const esc = B.esc;

    const session = await B.requireLogin();
    B.renderSessionMenu();
    const root = $('#pay-root');

    const id = new URLSearchParams(location.search).get('id');
    if (!/^\d{1,10}$/.test(id || '')) { root.innerHTML = '<div class="panel empty-mini">Pago no encontrado.</div>'; return; }
    if (session.user.role === 'admin' || session.user.role === 'profe') { root.innerHTML = '<div class="panel empty-mini">Los pagos se hacen desde una cuenta de socio.</div>'; return; }

    let data;
    async function load() {
        try { data = await B.api('GET', `/account/payments/${id}`); }
        catch (err) { root.innerHTML = `<div class="panel empty-mini">${esc(err.message)}</div>`; return; }
        render();
    }
    load();

    const ICON = {
        transferencia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18M5 10V20M19 10V20M9 10v10M15 10v10M2 20h20M12 2l10 6H2z"/></svg>',
        efectivo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
    };

    function summary(p) {
        return `
            <aside class="panel">
                <h2 class="panel__title">Resumen</h2>
                <div class="summary__row"><span>Concepto</span><strong style="text-align:right">${esc(p.description)}</strong></div>
                <div class="summary__row"><span>Estado</span>${B.statusPill(p.status)}</div>
                <div class="summary__row"><span>Total</span><span class="summary__total">${B.money(p.amount)}</span></div>
            </aside>`;
    }

    function render() {
        const p = data.payment;
        if (p.status !== 'pendiente') return renderResult(p);
        root.innerHTML = `
            <div class="checkout">
                <div class="panel">
                    <h2 class="panel__title">Medio de pago</h2>
                    <p class="panel__sub">Pago #${Number(p.id)}</p>
                    <div class="methods" role="tablist">
                        <button type="button" class="method is-active" data-method="transferencia">${ICON.transferencia}Transferencia</button>
                        <button type="button" class="method" data-method="efectivo">${ICON.efectivo}Efectivo en el box</button>
                    </div>
                    <div id="method-body"></div>
                    <button class="btn btn--ghost btn--sm" id="cancel-pay" type="button" style="margin-top:18px">Cancelar este pago</button>
                </div>
                ${summary(p)}
            </div>`;
        root.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => {
            root.querySelectorAll('[data-method]').forEach(x => x.classList.toggle('is-active', x === b));
            renderMethod(b.dataset.method);
        }));
        $('#cancel-pay').addEventListener('click', cancelPay);
        renderMethod('transferencia');
    }

    function renderMethod(m) {
        const body = $('#method-body');
        if (m === 'transferencia') {
            const t = data.transfer;
            body.innerHTML = `
                <p class="panel__sub">Transferí <strong>${B.money(data.payment.amount)}</strong> a esta cuenta y después cargá el número de operación del comprobante.</p>
                <div class="copy-row"><div><span>Alias</span><strong>${esc(t.alias)}</strong></div><button class="btn btn--ghost btn--sm" type="button" data-copy="${esc(t.alias)}">Copiar</button></div>
                <div class="copy-row"><div><span>CBU / CVU</span><strong>${esc(t.cbu)}</strong></div><button class="btn btn--ghost btn--sm" type="button" data-copy="${esc(t.cbu)}">Copiar</button></div>
                <div class="copy-row"><div><span>Titular</span><strong>${esc(t.holder)}</strong></div></div>
                <form id="transfer-form" novalidate style="margin-top:16px">
                    <div class="field"><label for="t-ref">Número de operación / comprobante</label><input id="t-ref" name="reference" maxlength="60"></div>
                    <button class="btn btn--primary btn--block" type="submit">Ya transferí</button>
                    <p class="field__hint" style="margin-top:10px">El gimnasio verifica la transferencia y activa tu plan.</p>
                </form>`;
            body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(b.dataset.copy); B.toast('Copiado.', 'ok'); } catch (e) { B.toast('No se pudo copiar.', 'error'); }
            }));
            $('#transfer-form').addEventListener('submit', payTransfer);
        } else {
            body.innerHTML = `
                <p class="panel__sub">Pagá <strong>${B.money(data.payment.amount)}</strong> en efectivo en la recepción del box la próxima vez que vengas. Cuando el personal registre el cobro, tu plan se activa.</p>
                <button class="btn btn--primary btn--block" id="cash-btn" type="button">Voy a pagar en el box</button>`;
            $('#cash-btn').addEventListener('click', payCash);
        }
    }

    async function payTransfer(e) {
        e.preventDefault();
        const f = e.target;
        B.clearFieldErrors(f);
        try {
            const r = await B.api('POST', `/account/payments/${id}/transfer`, { reference: $('#t-ref').value });
            data.payment = r.payment;
            renderResult(r.payment);
        } catch (err) { B.handleError(err, f); }
    }

    async function payCash() {
        try {
            const r = await B.api('POST', `/account/payments/${id}/cash`);
            data.payment = r.payment;
            renderResult(r.payment);
        } catch (err) { B.toast(err.message, 'error'); }
    }

    async function cancelPay() {
        if (!await B.confirmDialog('Se va a cancelar este pago y el plan no se activa.', { okText: 'Cancelar pago', danger: true })) return;
        try {
            const r = await B.api('POST', `/account/payments/${id}/cancel`);
            data.payment = r.payment;
            renderResult(r.payment);
        } catch (err) { B.toast(err.message, 'error'); }
    }

    function renderResult(p) {
        const map = {
            aprobado: ['ok', '✓', '¡Pago aprobado!', 'Tu plan ya está activo. Ya podés reservar tus clases.'],
            en_revision: ['warn', '⏳', 'Pago en revisión', p.method === 'efectivo'
                ? 'Acercate a la recepción para pagar. Cuando registren el cobro, tu plan se activa.'
                : 'Recibimos el aviso de tu transferencia. Cuando el gimnasio la confirme, tu plan se activa.'],
            rechazado: ['error', '✕', 'Pago rechazado', p.admin_note || 'El gimnasio no pudo confirmar el pago.'],
            cancelado: ['error', '✕', 'Pago cancelado', 'Este pago fue cancelado.'],
        };
        const [cls, ic, title, text] = map[p.status] || ['warn', '…', 'Pago', ''];
        root.innerHTML = `
            <div class="checkout">
                <div class="panel result">
                    <div class="result__icon result__icon--${cls}">${ic}</div>
                    <h2 class="panel__title">${esc(title)}</h2>
                    <p class="panel__sub">${esc(text)}</p>
                    <div class="modal__actions">
                        ${p.status === 'aprobado' ? '<a class="btn btn--primary" href="reserva.html">Reservar clase</a>' : ''}
                        ${p.status === 'rechazado' || p.status === 'cancelado' ? '<a class="btn btn--primary" href="cuenta.html#planes">Elegir un plan</a>' : ''}
                        <a class="btn btn--ghost" href="cuenta.html">Ir a mi cuenta</a>
                    </div>
                </div>
                ${summary(p)}
            </div>`;
    }
});
