document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const esc = B.esc;

    const session = await B.requireLogin();
    if (session.user.role === 'admin') { location.replace('admin.html'); return; }
    if (session.user.role === 'profe') { location.replace('profe.html'); return; }
    B.renderSessionMenu();
    const user = session.user;
    $('#hello-name').textContent = user.name;

    /* ---------- Tabs (con #hash para poder linkear) ---------- */
    let calendar = null;
    function switchTab(name) {
        if (!$(`.tab-panel[data-panel="${name}"]`)) name = 'plan';
        $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
        $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
        if (name === 'calendario' && !calendar) {
            calendar = new window.BunkerCalendar($('#calendar'), (month) => B.api('GET', `/account/calendar?month=${month}`));
        }
        history.replaceState(null, '', '#' + name);
    }
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    function goToHash() {
        const hash = location.hash.slice(1);
        if (hash === 'planes') { switchTab('plan'); history.replaceState(null, '', '#planes'); setTimeout(() => $('#planes').scrollIntoView({ behavior: 'smooth' }), 300); }
        else if (hash) switchTab(hash);
    }
    goToHash();
    window.addEventListener('hashchange', goToHash); // el menú "Contratar o renovar plan" funciona aunque ya estés en Mi cuenta

    /* ---------- Datos ---------- */
    async function load() {
        try {
            const [ov, site] = await Promise.all([B.api('GET', '/account/overview'), B.api('GET', '/public/site')]);
            renderSubs(ov.subscriptions);
            renderPayments(ov.payments);
            renderPlans(site.plans, B.openPlansMap(ov.openPlans));
            fillProfile(ov.user);
        } catch (err) { B.toast(err.message, 'error'); }
    }
    load();

    function renderSubs(subs) {
        const today = B.todayStr();
        const box = $('#subs-list');
        const visible = subs.filter(s => s.status === 'activa' && s.end_date >= today);
        if (!visible.length) {
            box.innerHTML = '<div class="empty-mini">Todavía no tenés un plan activo. Elegí uno abajo 👇</div>';
            return;
        }
        box.innerHTML = visible.map(s => {
            const upcoming = s.start_date > today;
            const daysLeft = Math.round((B.parseDate(s.end_date) - B.parseDate(today)) / 86400000) + 1;
            return `
                <div class="list-item">
                    <div class="list-item__body">
                        <div class="list-item__title">${esc(s.plan_name)}</div>
                        <div class="list-item__meta">
                            <span>${s.kind === 'membresia' ? 'Todas las actividades' : esc(s.activity_name || 'Actividad')}</span>
                            <span>${s.weekly_limit ? `${Number(s.weekly_limit)} clase(s) por semana` : 'Sin límite semanal'}</span>
                            <span>Del ${esc(B.dateShort(s.start_date))} al ${esc(B.dateShort(s.end_date))}</span>
                        </div>
                    </div>
                    ${upcoming ? '<span class="pill pill--info">Empieza pronto</span>'
                        : `<span class="pill ${daysLeft <= 5 ? 'pill--warn' : 'pill--ok'}">${daysLeft} día${daysLeft === 1 ? '' : 's'} restante${daysLeft === 1 ? '' : 's'}</span>`}
                </div>`;
        }).join('');
    }

    function renderPayments(pays) {
        const box = $('#payments-list');
        const open = pays.filter(p => p.status === 'pendiente');
        $('#pending-notice').innerHTML = open.length ? `
            <div class="notice notice--warn"><span class="notice__icon">💳</span>
                <div>Tenés ${open.length} pago${open.length > 1 ? 's' : ''} sin completar: <strong>${esc(open[0].description)}</strong>.
                <br><a class="btn btn--primary btn--sm" href="pago.html?id=${Number(open[0].id)}">Completar pago</a></div>
            </div>` : '';
        if (!pays.length) { box.innerHTML = '<div class="empty-mini">Todavía no hiciste pagos.</div>'; return; }
        box.innerHTML = pays.map(p => `
            <div class="list-item">
                <div class="list-item__body">
                    <div class="list-item__title">${esc(p.description)}</div>
                    <div class="list-item__meta">
                        <span>${esc(B.dateTime(p.created_at))}</span>
                        ${p.method ? `<span>${esc(B.PAY_METHOD[p.method] || p.method)}</span>` : ''}
                        ${p.admin_note && p.status !== 'aprobado' ? `<span>${esc(p.admin_note)}</span>` : ''}
                    </div>
                </div>
                <span class="list-item__amount">${B.money(p.amount)}</span>
                ${B.statusPill(p.status)}
                ${p.status === 'pendiente' ? `<a class="btn btn--primary btn--sm" href="pago.html?id=${Number(p.id)}">Pagar</a>` : ''}
            </div>`).join('');
    }

    function renderPlans(plans, open = new Map()) {
        const box = $('#plans-grid');
        if (!plans.length) { box.innerHTML = '<div class="empty-mini">No hay planes publicados.</div>'; return; }
        const period = (d) => d === 30 || d === 31 ? '/ mes' : d === 1 ? '/ día' : `/ ${d} días`;
        box.innerHTML = plans.map(p => `
            <article class="plan ${p.featured ? 'plan--featured' : ''} ${p.promo_until ? 'plan--promo' : ''}">
                ${p.featured ? '<span class="plan__badge">Más elegido</span>' : ''}
                ${p.promo_until ? `<span class="plan__promo">🎁 Promo hasta el ${esc(B.dateLabel(p.promo_until))}</span>` : ''}
                <span class="plan__kind">${p.kind === 'membresia' ? 'Mensualidad' : 'Actividad · ' + esc(p.activity_name)}</span>
                <h3>${esc(p.name)}</h3>
                <div class="plan__price">${B.money(p.price)}<small>${period(p.duration_days)}</small></div>
                <p class="plan__desc">${esc(p.description)}</p>
                <div class="plan__tags">${p.weekly_limit ? `<span class="pill pill--primary">${Number(p.weekly_limit)} por semana</span>` : '<span class="pill pill--primary">Sin límite</span>'}</div>
                ${B.planAction(p, open.get(p.id))}
            </article>`).join('');
    }
    $('#plans-grid').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-plan]');
        if (!btn) return;
        btn.disabled = true;
        try {
            const r = await B.api('POST', `/account/plans/${btn.dataset.plan}/purchase`);
            location.href = 'pago.html?id=' + r.payment.id;
        } catch (err) { B.toast(err.message, 'error'); btn.disabled = false; }
    });

    /* ---------- Perfil ---------- */
    function fillProfile(u) {
        $('#p-name').value = u.name;
        $('#p-lastname').value = u.lastname;
        $('#p-phone').value = u.phone || '';
        $('#profile-email').textContent = 'Correo: ' + u.email;
    }
    $('#form-profile').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        B.clearFieldErrors(f);
        try {
            await B.api('PATCH', '/account/profile', { name: $('#p-name').value, lastname: $('#p-lastname').value, phone: $('#p-phone').value });
            B.toast('Datos actualizados.', 'ok');
            $('#hello-name').textContent = $('#p-name').value.trim();
            B.renderSessionMenu();
        } catch (err) { B.handleError(err, f); }
    });

    $('#form-password').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        B.clearFieldErrors(f);
        if ($('#pw-new').value !== $('#pw-new2').value) return B.showFieldError(f, 'password2', 'Las contraseñas no coinciden.');
        try {
            await B.api('POST', '/auth/change-password', { current: $('#pw-current').value, password: $('#pw-new').value });
            f.reset();
            B.toast('Contraseña actualizada.', 'ok');
        } catch (err) { B.handleError(err, f); }
    });

    $('#logout-all').addEventListener('click', async () => {
        if (!await B.confirmDialog('Se va a cerrar tu sesión en todos los dispositivos, incluido este.', { okText: 'Cerrar todas', danger: true })) return;
        try { await B.api('POST', '/auth/logout-all'); } catch (e) { }
        location.replace('login.html');
    });
});
