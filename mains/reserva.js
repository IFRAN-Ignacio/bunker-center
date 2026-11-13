document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const esc = B.esc;

    /* =========================================================
       SESIÓN (obligatoria para reservar)
       ========================================================= */
    const session = await B.requireLogin();
    if (session.user.role === 'admin') { location.replace('admin.html'); return; }
    if (session.user.role === 'profe') { location.replace('profe.html'); return; }
    B.renderSessionMenu();

    const state = { step: 1, activity: null, date: null, slot: null, ticket: null };
    let activities = [];
    let status = null;

    /* =========================================================
       CARGA INICIAL
       ========================================================= */
    try {
        const [site, st] = await Promise.all([B.api('GET', '/public/site'), B.api('GET', '/reservations/status')]);
        activities = site.activities;
        status = st;
    } catch (err) {
        B.toast(err.message, 'error');
        return;
    }
    renderPlanNotice();
    renderActivities();
    updateMineCount();

    function covers(actId) {
        return status.subscriptions.some(s => s.kind === 'membresia' || s.activity_id === actId);
    }

    function renderPlanNotice() {
        const box = $('#plan-notice');
        const subs = status.subscriptions;
        if (subs.length) {
            const names = subs.map(s => `<strong>${esc(s.plan_name)}</strong> (hasta el ${esc(B.dateShort(s.end_date))})`).join(', ');
            box.innerHTML = `<div class="notice notice--ok"><span class="notice__icon">✅</span><div>Plan vigente: ${names}. <a href="cuenta.html">Ver mi cuenta</a></div></div>`;
        } else if (status.requirePlan) {
            box.innerHTML = `<div class="notice notice--warn"><span class="notice__icon">⚠️</span>
                <div>Para reservar necesitás un plan activo. Elegí tu mensualidad o actividad y pagala online en un minuto.
                <br><a class="btn btn--primary btn--sm" href="cuenta.html#planes">Ver planes</a></div></div>`;
        }
    }

    /* =========================================================
       NAVEGACIÓN DE PASOS
       ========================================================= */
    function goToStep(n) {
        state.step = n;
        $$('.step').forEach(el => {
            const s = Number(el.dataset.stepNav);
            el.classList.toggle('is-active', s === n);
            el.classList.toggle('is-done', s < n);
            el.disabled = s > n;
        });
        $$('.step-panel').forEach(p => p.classList.toggle('is-active', Number(p.dataset.stepPanel) === n));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    $$('.step').forEach(btn => btn.addEventListener('click', () => { if (!btn.disabled) goToStep(Number(btn.dataset.stepNav)); }));
    $$('[data-back]').forEach(btn => btn.addEventListener('click', () => goToStep(Number(btn.dataset.back))));

    /* =========================================================
       PASO 1: ACTIVIDAD
       ========================================================= */
    function renderActivities() {
        const box = $('#class-options');
        if (!activities.length) { box.innerHTML = '<p class="empty-mini">No hay clases disponibles por ahora.</p>'; return; }
        box.innerHTML = activities.map(a => {
            const days = [...new Set(a.slots.map(s => s.weekday))].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
            const ok = !status.requirePlan || covers(a.id);
            return `
                <button class="class-option" data-activity="${Number(a.id)}" type="button">
                    <div class="class-option__icon" style="color:${B.safeColor(a.color)}">${B.icon(a.icon)}</div>
                    <h3>${esc(a.name)}</h3>
                    ${a.location ? `<span class="pill pill--primary" style="margin-bottom:10px">📍 ${esc(a.location)}</span>` : ''}
                    <p>${esc(a.description)}</p>
                    <span class="class-option__hint">${esc(days.map(d => B.DAYS_SHORT[d]).join(' · ') || 'Sin horarios')}</span>
                    ${ok ? '' : '<span class="pill pill--warn" style="margin-left:6px">Tu plan no la incluye</span>'}
                </button>`;
        }).join('');
    }

    $('#class-options').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-activity]');
        if (!btn) return;
        state.activity = activities.find(a => a.id === Number(btn.dataset.activity));
        state.date = state.slot = state.ticket = null;
        renderDates();
        goToStep(2);
    });

    /* =========================================================
       PASO 2: FECHA
       ========================================================= */
    async function renderDates() {
        const box = $('#date-options');
        box.innerHTML = '<div class="loading">Cargando días…</div>';
        $('#date-sub').innerHTML = `Clase: <strong>${esc(state.activity.name + (state.activity.location ? ' · ' + state.activity.location : ''))}</strong> · podés reservar con hasta <strong>${status.bookingDaysAhead} días</strong> de anticipación.`;
        let data;
        try { data = await B.api('GET', `/reservations/dates?activity=${state.activity.id}`); }
        catch (err) { box.innerHTML = `<p class="empty-mini">${esc(err.message)}</p>`; return; }
        const today = B.todayStr();
        box.innerHTML = data.days.map(d => {
            const head = `<span class="date-option__day">${B.DAYS[d.weekday]}</span><span class="date-option__date">${esc(B.dateLabel(d.date))}</span>`;
            if (!d.hasSchedule) return `<div class="date-option is-empty">${head}<span class="date-option__tag">Sin clase</span></div>`;
            if (d.blocked) return `<div class="date-option is-empty" title="${esc(d.reason)}">${head}<span class="date-option__tag" style="background:rgba(251,191,36,.18);color:#fbbf24">Cerrado</span></div>`;
            const tag = d.date === today ? '<span class="date-option__tag">Hoy</span>'
                : (status.requirePlan && !d.covered ? '<span class="date-option__tag" style="background:rgba(251,191,36,.18);color:#fbbf24">Sin plan</span>' : '');
            return `<button class="date-option ${d.date === today ? 'is-today' : ''}" type="button" data-date="${esc(d.date)}">${head}${tag}</button>`;
        }).join('');
    }

    $('#date-options').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-date]');
        if (!btn) return;
        state.date = btn.dataset.date;
        state.slot = state.ticket = null;
        renderTimes();
        goToStep(3);
    });

    /* =========================================================
       PASO 3: HORARIO
       ========================================================= */
    // Estado de los profes de esa clase: "Profe: Ana P." · "Falta 1 profe" · "Sin profe"
    function teacherLine(t) {
        if (!t || t.state === 'sin_asignar' || !t.label) return '';
        const cls = t.state === 'ok' ? 'time-option__teacher' : t.state === 'menos' ? 'time-option__teacher is-warn' : 'time-option__teacher is-bad';
        return `<span class="${cls}">${t.state === 'ok' ? '' : '⚠ '}${esc(t.label)}</span>`;
    }

    async function renderTimes() {
        const box = $('#time-options');
        $('#time-sub').innerHTML = `Clase: <strong>${esc(state.activity.name + (state.activity.location ? ' · ' + state.activity.location : ''))}</strong> · ${esc(B.dateLong(state.date))}`;
        box.innerHTML = '<div class="loading">Cargando horarios…</div>';
        let data;
        try { data = await B.api('GET', `/reservations/slots?activity=${state.activity.id}&date=${state.date}`); }
        catch (err) { box.innerHTML = `<p class="empty-mini">${esc(err.message)}</p>`; return; }
        if (!data.slots.length) { box.innerHTML = '<p class="empty-mini">No hay horarios ese día.</p>'; return; }
        box.innerHTML = data.slots.map(s => {
            const label = `${esc(s.start_time)} - ${esc(s.end_time)} HS`;
            const free = s.capacity - s.taken;
            if (s.blocked || s.started) {
                return `<div class="time-option" style="opacity:.4;cursor:not-allowed">${label}<small style="color:var(--error)">${s.blocked ? 'No disponible' : 'Ya empezó'}</small></div>`;
            }
            if (s.myTicket) {
                return `<div class="time-option" style="border-color:var(--ok)">${label}<small style="color:var(--ok)">Ya reservaste · boleto #${Number(s.myTicket)}</small>${teacherLine(s.teachers)}</div>`;
            }
            if (free <= 0) return `<div class="time-option" style="opacity:.5;cursor:not-allowed">${label}<small>Completo</small></div>`;
            return `<button class="time-option" type="button" data-slot="${Number(s.id)}">${label}<small>${free} de ${Number(s.capacity)} libres</small>${teacherLine(s.teachers)}</button>`;
        }).join('');
    }

    $('#time-options').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-slot]');
        if (!btn) return;
        state.slot = Number(btn.dataset.slot);
        state.ticket = null;
        renderTickets();
        goToStep(4);
    });

    /* =========================================================
       PASO 4: BOLETO
       ========================================================= */
    let slotData = null;
    async function renderTickets() {
        const box = $('#ticket-grid');
        $('#confirm-bar').hidden = true;
        state.ticket = null;
        box.innerHTML = '<div class="loading">Cargando boletos…</div>';
        try { slotData = await B.api('GET', `/reservations/tickets?slot=${state.slot}&date=${state.date}`); }
        catch (err) { box.innerHTML = `<p class="empty-mini">${esc(err.message)}</p>`; return; }
        const s = slotData.slot;
        $('#ticket-sub').innerHTML = `<strong>${esc(s.activity_name)}</strong> · ${esc(B.dateLong(state.date))} · ${esc(s.start_time)} - ${esc(s.end_time)} HS`;
        box.innerHTML = slotData.tickets.map(t => {
            if (t.status === 'mine') return `<button class="ticket ticket--mine" type="button" disabled><span class="ticket__num">${t.n}</span><span class="ticket__name">Vos</span><span class="ticket__status">Tu reserva</span></button>`;
            if (t.status === 'taken') return `<button class="ticket ticket--taken" type="button" disabled><span class="ticket__num">${t.n}</span><span class="ticket__name">—</span><span class="ticket__status">Ocupado</span></button>`;
            return `<button class="ticket ticket--free" type="button" data-ticket="${t.n}"><span class="ticket__num">${t.n}</span><span class="ticket__name">Libre</span><span class="ticket__status">Disponible</span></button>`;
        }).join('');
    }

    $('#ticket-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ticket]');
        if (!btn) return;
        $$('.ticket--selected').forEach(el => { el.classList.remove('ticket--selected'); el.classList.add('ticket--free'); });
        btn.classList.remove('ticket--free');
        btn.classList.add('ticket--selected');
        state.ticket = Number(btn.dataset.ticket);
        $('#confirm-summary').textContent = `Boleto #${state.ticket} · ${slotData.slot.activity_name}`;
        $('#confirm-details').textContent = `${B.dateLong(state.date)} · ${slotData.slot.start_time} - ${slotData.slot.end_time} HS`;
        $('#confirm-bar').hidden = false;
    });

    /* =========================================================
       CONFIRMAR
       ========================================================= */
    $('#confirm-btn').addEventListener('click', async () => {
        if (!state.slot || !state.date || !state.ticket) return B.toast('Faltan datos para confirmar.', 'error');
        const btn = $('#confirm-btn');
        btn.disabled = true;
        try {
            const { reservation: r } = await B.api('POST', '/reservations', { slotId: state.slot, date: state.date, ticket: state.ticket });
            $('#success-text').textContent = `${r.activity_name} · ${B.dateLong(r.date)} a las ${r.start_time} HS. Boleto #${r.ticket}.`;
            $('#modal-success').hidden = false;
            updateMineCount();
            state.activity = state.date = state.slot = state.ticket = null;
            goToStep(1);
        } catch (err) {
            B.toast(err.message, 'error');
            if (err.data.needsPlan) setTimeout(() => { location.href = 'cuenta.html#planes'; }, 1800);
            if (err.data.refresh) renderTickets();
        } finally { btn.disabled = false; }
    });

    $$('[data-close-modal]').forEach(el => el.addEventListener('click', () => { $('#modal-success').hidden = true; }));
    $$('[data-go-mine]').forEach(el => el.addEventListener('click', () => { $('#modal-success').hidden = true; switchTab('mine'); }));
    $$('[data-go-new]').forEach(el => el.addEventListener('click', () => { switchTab('new'); goToStep(1); }));

    /* =========================================================
       TABS
       ========================================================= */
    function switchTab(name) {
        $$('.reserve__tab').forEach(t => {
            const on = t.dataset.tab === name;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        $$('.reserve__panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
        if (name === 'mine') renderMine();
    }
    $$('.reserve__tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    /* =========================================================
       MIS RESERVAS
       ========================================================= */
    let mine = [];
    async function loadMine() {
        const r = await B.api('GET', '/reservations/mine');
        mine = r.reservations;
        return r.today;
    }
    async function updateMineCount() {
        try {
            const today = await loadMine();
            const n = mine.filter(r => r.status === 'activa' && r.date >= today).length;
            const badge = $('#mine-count');
            badge.textContent = n;
            badge.hidden = n === 0;
        } catch (e) { }
    }

    function daysLabel(date, today) {
        const diff = Math.round((B.parseDate(date) - B.parseDate(today)) / 86400000);
        if (diff === 0) return 'Hoy';
        if (diff === 1) return 'Mañana';
        if (diff > 0) return `En ${diff} días`;
        return `Hace ${-diff} día${diff === -1 ? '' : 's'}`;
    }

    async function renderMine() {
        let today;
        try { today = await loadMine(); } catch (err) { B.toast(err.message, 'error'); return; }
        const future = mine.filter(r => r.status === 'activa' && r.date >= today)
            .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
        const past = mine.filter(r => !(r.status === 'activa' && r.date >= today));

        $('#mine-sub').textContent = `${future.length} próxima${future.length === 1 ? '' : 's'} · ${past.length} pasada${past.length === 1 ? '' : 's'} o cancelada${past.length === 1 ? '' : 's'}`;
        $('#mine-future-title').hidden = !future.length;
        $('#mine-future').innerHTML = future.map(r => card(r, false, today)).join('');
        $('#mine-past-title').hidden = !past.length;
        $('#mine-past').innerHTML = past.map(r => card(r, true, today)).join('');
        $('#clear-past-btn').hidden = !past.length;
        $('#mine-empty').hidden = mine.length > 0;
    }

    function card(r, isPast, today) {
        const cancelled = r.status === 'cancelada';
        return `
            <article class="reservation ${isPast ? 'reservation--past' : ''}" style="border-left-color:${B.safeColor(r.color)}">
                <div class="reservation__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>
                </div>
                <div class="reservation__body">
                    <div class="reservation__class">${esc(r.activity_name)} ${cancelled ? '<span class="pill pill--error">Cancelada</span>' : ''}</div>
                    <div class="reservation__meta">
                        <span>${esc(B.dateLong(r.date))}</span>
                        <span>${esc(r.start_time)} - ${esc(r.end_time)} HS</span>
                        <span>${cancelled ? esc(r.cancel_reason || '') : daysLabel(r.date, today)}</span>
                    </div>
                </div>
                <div class="reservation__ticket"><strong>${Number(r.ticket)}</strong><small>Boleto</small></div>
                ${!isPast ? `<div class="reservation__actions">
                    <button class="btn btn--danger btn--sm" data-cancel="${Number(r.id)}" type="button">Cancelar</button>
                </div>` : ''}
            </article>`;
    }

    $('#mine-future').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cancel]');
        if (!btn) return;
        const ok = await B.confirmDialog(`Vas a liberar tu boleto. Recordá que solo se puede cancelar hasta ${status.cancelMinHours} h antes.`, { okText: 'Cancelar reserva', danger: true });
        if (!ok) return;
        try {
            await B.api('POST', `/reservations/${btn.dataset.cancel}/cancel`);
            B.toast('Reserva cancelada. El boleto quedó libre.', 'ok');
            renderMine(); updateMineCount();
        } catch (err) { B.toast(err.message, 'error'); }
    });

    $('#clear-past-btn').addEventListener('click', async () => {
        try {
            await B.api('POST', '/reservations/hide-past');
            B.toast('Listo, se ocultaron las reservas pasadas.', 'ok');
            renderMine();
        } catch (err) { B.toast(err.message, 'error'); }
    });

    if (location.hash === '#mis-reservas') switchTab('mine');
    window.addEventListener('hashchange', () => switchTab(location.hash === '#mis-reservas' ? 'mine' : 'new')); // atajos del menú
});
