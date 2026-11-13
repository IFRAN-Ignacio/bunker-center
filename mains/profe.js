/* =========================================================
   PANEL DE PROFES
   El servidor decide qué ve cada profe (solo sus clases asignadas); esto solo muestra.
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const esc = B.esc;

    const session = await B.requireLogin();
    if (session.user.role !== 'profe') { location.replace(session.user.role === 'admin' ? 'admin.html' : 'cuenta.html'); return; }
    $('#teacher-root').hidden = false;
    B.renderSessionMenu();
    const user = session.user;
    $('#hello-name').textContent = user.name;

    const monthKey = (d) => d.slice(0, 7);
    const addDays = (ds, n) => { const d = B.parseDate(ds); d.setDate(d.getDate() + n); return B.toDateStr(d); };
    const cache = {};
    async function month(key, force) {
        if (!cache[key] || force) cache[key] = await B.api('GET', `/teacher/calendar?month=${key}`);
        return cache[key];
    }
    const resetCache = () => Object.keys(cache).forEach(k => delete cache[k]);

    /* ---------- Estado de profes de una clase (pastilla) ---------- */
    function statusPill(c) {
        if (c.blocked) return `<span class="pill pill--muted">Sin clase: ${esc(c.blocked)}</span>`;
        const st = c.status.state;
        if (c.myAbsence) return `<span class="pill pill--error">Avisaste que faltás</span>`;
        if (st === 'menos') return `<span class="pill pill--warn">${esc(c.status.label.split(' · ')[0])}</span>`;
        if (st === 'sin_profe') return `<span class="pill pill--error">Sin profe</span>`;
        return `<span class="pill pill--ok">Profe confirmado</span>`;
    }
    const started = (c) => {
        const now = new Date();
        const [h, m] = c.start_time.split(':').map(Number);
        const d = B.parseDate(c.date); d.setHours(h, m, 0, 0);
        return d <= now;
    };

    /* ---------- Tarjeta de una clase (con alumnos) ---------- */
    function classCard(c) {
        const pct = Math.min(100, Math.round(c.count / c.capacity * 100));
        const color = B.safeColor(c.color);
        const co = c.coTeachers.length
            ? `<div class="t-class__co">Con: ${c.coTeachers.map(t => `${esc(t.name)}${t.absent ? ' <em>(avisó que falta)</em>' : ''}`).join(', ')}</div>` : '';
        const canEdit = !started(c) && !c.blocked;
        const action = !canEdit ? '' : c.myAbsence
            ? `<button class="btn btn--ghost btn--sm" type="button" data-undo="${Number(c.myAbsence.id)}">Retirar aviso (voy a ir)</button>`
            : `<button class="btn btn--danger btn--sm" type="button" data-absent="${Number(c.slotId)}" data-date="${esc(c.date)}">Avisar que falto</button>`;
        return `
            <article class="t-class" style="--c:${color}">
                <header class="t-class__head">
                    <div>
                        <div class="t-class__time">${esc(c.start_time)} – ${esc(c.end_time)}</div>
                        <h3 class="t-class__name">${esc(c.activity)}${c.location ? ` <small>· ${esc(c.location)}</small>` : ''}</h3>
                    </div>
                    ${statusPill(c)}
                </header>
                <div class="t-class__count">
                    <strong>${Number(c.count)}</strong> de ${Number(c.capacity)} alumnos
                    <div class="t-bar"><span style="width:${pct}%"></span></div>
                </div>
                ${co}
                ${c.myAbsence ? `<div class="t-class__reason">Tu motivo: ${esc(c.myAbsence.reason)}</div>` : ''}
                ${c.students.length ? `
                    <details class="t-students" ${c.students.length <= 6 ? 'open' : ''}>
                        <summary>Ver alumnos (${c.students.length})</summary>
                        <ol>${c.students.map(s => `<li><span class="ticket-badge">#${Number(s.ticket)}</span> ${esc(s.name)}</li>`).join('')}</ol>
                    </details>` : '<div class="empty-mini">Todavía no hay alumnos anotados.</div>'}
                ${action ? `<div class="t-class__actions">${action}</div>` : ''}
            </article>`;
    }

    /* ---------- Próximos 7 días ---------- */
    async function loadAgenda(force) {
        const box = $('#agenda');
        const today = B.todayStr();
        const end = addDays(today, 6);
        try {
            const keys = [...new Set([monthKey(today), monthKey(end)])];
            const data = await Promise.all(keys.map(k => month(k, force)));
            // En la agenda no se muestran las clases de hoy que ya terminaron (siguen en el calendario).
            const ended = (c, date) => { const [h, m] = c.end_time.split(':').map(Number); const d = B.parseDate(date); d.setHours(h, m, 0, 0); return d <= new Date(); };
            const days = data.flatMap(d => d.days).filter(d => d.date >= today && d.date <= end)
                .map(d => ({ ...d, classes: d.classes.filter(c => !ended(c, d.date)) })).filter(d => d.classes.length);
            const all = days.flatMap(d => d.classes);
            const upcoming = all.filter(c => !started(c));
            $('#t-stats').innerHTML = `
                <div class="t-stat"><strong>${upcoming.length}</strong><span>clases en 7 días</span></div>
                <div class="t-stat"><strong>${upcoming.reduce((n, c) => n + c.count, 0)}</strong><span>alumnos anotados</span></div>
                <div class="t-stat ${all.some(c => c.myAbsence) ? 't-stat--warn' : ''}"><strong>${all.filter(c => c.myAbsence).length}</strong><span>avisos de ausencia</span></div>`;
            if (!days.length) { box.innerHTML = '<div class="empty">No tenés clases asignadas en los próximos 7 días.</div>'; return; }
            box.innerHTML = days.map(d => `
                <section class="t-day">
                    <h2 class="t-day__title">${d.date === today ? 'Hoy · ' : d.date === addDays(today, 1) ? 'Mañana · ' : ''}${esc(B.dateLong(d.date))}</h2>
                    <div class="t-classes">${d.classes.map(c => classCard({ ...c, date: d.date })).join('')}</div>
                </section>`).join('');
        } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    }

    /* ---------- Calendario mensual ---------- */
    const cal = { el: $('#t-calendar'), y: new Date().getFullYear(), m: new Date().getMonth(), selected: B.todayStr() };
    const calKey = () => `${cal.y}-${String(cal.m + 1).padStart(2, '0')}`;
    async function renderCalendar(force) {
        let data;
        try { data = await month(calKey(), force); } catch (err) { cal.el.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
        const byDate = Object.fromEntries(data.days.map(d => [d.date, d.classes]));
        const today = B.todayStr();
        const first = new Date(cal.y, cal.m, 1);
        const offset = (first.getDay() + 6) % 7;
        const dim = new Date(cal.y, cal.m + 1, 0).getDate();
        const cells = [];
        for (let i = 0; i < offset; i++) cells.push('<div class="cal__day cal__day--out"></div>');
        for (let day = 1; day <= dim; day++) {
            const ds = `${calKey()}-${String(day).padStart(2, '0')}`;
            const cls = byDate[ds] || [];
            const k = ['cal__day'];
            if (ds === today) k.push('cal__day--today');
            if (ds === cal.selected) k.push('cal__day--selected');
            if (cls.some(c => c.myAbsence)) k.push('cal__day--absent');
            const ev = cls.slice(0, 3).map(c => {
                const col = B.safeColor(c.color);
                const warn = c.myAbsence || c.status.state === 'sin_profe' ? ' cal__ev--bad' : c.status.state === 'menos' ? ' cal__ev--warn' : '';
                return `<span class="cal__ev${warn}" style="border-left-color:${col};background:${col}22">${esc(c.start_time)} ${esc(c.activity)} · ${Number(c.count)}/${Number(c.capacity)}</span>`;
            }).join('');
            const more = cls.length > 3 ? `<span class="cal__more">+${cls.length - 3} más</span>` : '';
            cells.push(`<button type="button" class="${k.join(' ')}" data-day="${ds}" aria-label="${esc(B.dateLong(ds))}: ${cls.length} clase(s)"><span class="cal__num">${day}</span>${ev}${more}</button>`);
        }
        const total = data.days.reduce((n, d) => n + d.classes.length, 0);
        const sel = cal.selected && cal.selected.startsWith(calKey()) ? (byDate[cal.selected] || []) : null;
        cal.el.innerHTML = `
            <div class="cal">
                <div class="cal__head">
                    <div><div class="cal__title">${B.MONTHS[cal.m]} ${cal.y}</div><small style="color:var(--text-muted)">${total} clase${total === 1 ? '' : 's'} para dar</small></div>
                    <div class="cal__nav">
                        <button class="cal__btn" type="button" data-cal="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
                        <button class="cal__btn cal__today" type="button" data-cal="0">Hoy</button>
                        <button class="cal__btn" type="button" data-cal="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                    </div>
                </div>
                <div class="cal__grid">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<div class="cal__dow">${x}</div>`).join('')}${cells.join('')}</div>
                <div class="cal__legend">
                    <span><i style="background:var(--primary-soft);border-left:3px solid var(--primary)"></i>Clase (alumnos/cupo)</span>
                    <span><i style="background:rgba(251,191,36,.35)"></i>Falta un profe</span>
                    <span><i style="background:rgba(255,91,110,.35)"></i>Sin profe o avisaste que faltás</span>
                </div>
                ${sel ? `<div class="cal__detail"><h4>${esc(B.dateLong(cal.selected))}</h4>
                    ${sel.length ? `<div class="t-classes">${sel.map(c => classCard({ ...c, date: cal.selected })).join('')}</div>` : '<div class="empty-mini">No das clases este día.</div>'}</div>` : ''}
            </div>`;
    }
    cal.el.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-cal]');
        if (nav) {
            const n = Number(nav.dataset.cal);
            if (n === 0) { const d = new Date(); cal.y = d.getFullYear(); cal.m = d.getMonth(); cal.selected = B.todayStr(); }
            else { cal.m += n; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } cal.selected = null; }
            return renderCalendar();
        }
        const day = e.target.closest('[data-day]');
        if (day) { cal.selected = day.dataset.day; renderCalendar(); }
    });

    /* ---------- Mis horarios fijos ---------- */
    async function loadWeek() {
        try {
            const { slots } = await B.api('GET', '/teacher/me');
            if (!slots.length) { $('#t-week').innerHTML = '<div class="empty-mini">Todavía no tenés horarios asignados.</div>'; return; }
            const order = [1, 2, 3, 4, 5, 6, 0];
            $('#t-week').innerHTML = `<div class="t-week">${order.filter(d => slots.some(s => s.weekday === d)).map(d => `
                <div class="t-week__day"><h4>${B.DAYS[d]}</h4>${slots.filter(s => s.weekday === d).map(s => `
                    <div class="t-week__slot ${s.active && s.activity_active ? '' : 'is-off'}" style="border-left-color:${B.safeColor(s.color)}">
                        <strong>${esc(s.start_time)}–${esc(s.end_time)}</strong> ${esc(s.activity_name)}${s.location ? ` · ${esc(s.location)}` : ''}
                        <small>Cupo ${Number(s.capacity)}${s.active && s.activity_active ? '' : ' · inactivo'}</small>
                    </div>`).join('')}</div>`).join('')}</div>`;
        } catch (err) { $('#t-week').innerHTML = `<div class="empty-mini">${esc(err.message)}</div>`; }
    }

    /* ---------- Avisar ausencia (modal con motivo) ---------- */
    function askReason(title) {
        return new Promise((resolve) => {
            const wrap = document.createElement('div');
            wrap.className = 'modal';
            wrap.innerHTML = `
                <div class="modal__backdrop" data-close></div>
                <div class="modal__card" role="dialog" aria-modal="true">
                    <h3>Avisar que faltás</h3>
                    <p>${esc(title)}</p>
                    <form novalidate>
                        <div class="field"><label for="abs-reason">Motivo (solo lo ve la administración)</label>
                            <input id="abs-reason" name="reason" maxlength="120" placeholder="Ej: turno médico, viaje, enfermedad" required></div>
                        <div class="modal__actions">
                            <button class="btn btn--ghost" type="button" data-close>Cancelar</button>
                            <button class="btn btn--danger" type="submit">Avisar</button>
                        </div>
                    </form>
                </div>`;
            const done = (v) => { wrap.remove(); resolve(v); };
            wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => done(null)));
            wrap.querySelector('form').addEventListener('submit', (e) => {
                e.preventDefault();
                const v = wrap.querySelector('#abs-reason').value.trim();
                if (v.length < 3) return B.showFieldError(e.target, 'reason', 'Escribí un motivo (mínimo 3 letras).');
                done(v);
            });
            document.body.appendChild(wrap);
            wrap.querySelector('#abs-reason').focus();
        });
    }

    async function refreshAll() {
        resetCache();
        await Promise.all([loadAgenda(true), renderCalendar(true)]);
    }

    document.addEventListener('click', async (e) => {
        const ab = e.target.closest('[data-absent]');
        if (ab) {
            const card = ab.closest('.t-class');
            const title = `${card.querySelector('.t-class__name').textContent} · ${B.dateLong(ab.dataset.date)} ${card.querySelector('.t-class__time').textContent}`;
            const reason = await askReason(title);
            if (!reason) return;
            try {
                await B.api('POST', '/teacher/absences', { slotId: Number(ab.dataset.absent), date: ab.dataset.date, reason });
                B.toast('Listo: la clase ahora muestra que falta profe.', 'ok');
                refreshAll();
            } catch (err) { B.toast(err.message, 'error'); }
            return;
        }
        const un = e.target.closest('[data-undo]');
        if (un) {
            if (!await B.confirmDialog('¿Retirás el aviso? La clase vuelve a mostrar que vas.', { okText: 'Sí, voy a ir' })) return;
            try { await B.api('DELETE', `/teacher/absences/${un.dataset.undo}`); B.toast('Aviso retirado.', 'ok'); refreshAll(); }
            catch (err) { B.toast(err.message, 'error'); }
        }
    });

    /* ---------- Tabs ---------- */
    const loaded = {};
    function switchTab(name) {
        if (!$(`.tab-panel[data-panel="${name}"]`)) name = 'agenda';
        $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
        $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
        history.replaceState(null, '', '#' + name);
        if (name === 'calendario' && !loaded.cal) { loaded.cal = true; renderCalendar(); }
        if (name === 'horarios' && !loaded.week) { loaded.week = true; loadWeek(); }
    }
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    switchTab(location.hash.slice(1) || 'agenda');
    window.addEventListener('hashchange', () => switchTab(location.hash.slice(1) || 'agenda')); // atajos del menú
    loadAgenda();

    /* ---------- Mi cuenta ---------- */
    $('#p-name').value = user.name;
    $('#p-lastname').value = user.lastname;
    $('#p-phone').value = user.phone || '';
    $('#profile-email').textContent = 'Correo: ' + user.email;
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
});
