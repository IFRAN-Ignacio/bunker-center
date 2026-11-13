document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const esc = B.esc;
    const api = B.api;

    /* =========================================================
       ACCESO: el servidor es quien decide; esto solo redirige.
       ========================================================= */
    const s = await B.me();
    if (!s.user || s.user.role !== 'admin' || !s.adminVerified) { location.replace('login.html'); return; }
    $('#admin-root').hidden = false;
    $('#admin-logout').addEventListener('click', B.logout);

    // Si la sesión vence en el medio, cualquier 401 manda al login.
    async function call(method, url, body) {
        try { return await api(method, url, body); }
        catch (err) {
            if (err.status === 401) { B.toast('Tu sesión expiró. Ingresá de nuevo.', 'error'); setTimeout(() => location.replace('login.html'), 1200); }
            throw err;
        }
    }

    const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    const emptyRow = (cols, text) => `<tr class="empty-row"><td colspan="${cols}">${esc(text)}</td></tr>`;
    const yesNo = (v, yes = 'Sí', no = 'No') => v ? `<span class="pill pill--ok">${yes}</span>` : `<span class="pill pill--muted">${no}</span>`;

    /* =========================================================
       FORMULARIO EN MODAL (genérico para todos los CRUD)
       ========================================================= */
    function fieldHtml(f) {
        const id = 'mf-' + f.name;
        const val = f.value ?? '';
        const wrapCls = 'field' + (f.full ? ' field--full' : '');
        const hint = f.hint ? `<span class="field__hint">${esc(f.hint)}</span>` : '';
        switch (f.type) {
            case 'checkbox':
                return `<label class="check ${f.full ? 'field--full' : ''}"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
            case 'textarea':
                return `<div class="${wrapCls}"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" maxlength="${f.max || 500}">${esc(val)}</textarea>${hint}</div>`;
            case 'select':
                return `<div class="${wrapCls}"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}">${f.options.map(o =>
                    `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</div>`;
            case 'file':
                return `<div class="${wrapCls}"><label for="${id}">${esc(f.label)}</label><input type="file" id="${id}" name="${f.name}" accept="image/jpeg,image/png,image/webp">${hint}</div>`;
            default:
                return `<div class="${wrapCls}"><label for="${id}">${esc(f.label)}</label><input type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(val)}"
                    ${f.max ? `maxlength="${f.max}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.maxNum !== undefined ? `max="${f.maxNum}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${hint}</div>`;
        }
    }

    function openForm({ title, subtitle = '', fields, submitText = 'Guardar', multipart = false, onSubmit, extraHtml = '' }) {
        const wrap = document.createElement('div');
        wrap.className = 'modal';
        wrap.innerHTML = `
            <div class="modal__backdrop" data-close></div>
            <div class="modal__card modal__card--wide" role="dialog" aria-modal="true" style="max-width:640px">
                <button class="modal__close" type="button" data-close aria-label="Cerrar">${ICON_X}</button>
                <h3>${esc(title)}</h3>
                ${subtitle ? `<p>${esc(subtitle)}</p>` : '<div style="height:12px"></div>'}
                <form novalidate>
                    <div class="form-grid">${fields.map(fieldHtml).join('')}</div>
                    ${extraHtml}
                    <div class="modal__actions" style="justify-content:flex-start;margin-top:6px">
                        <button class="btn btn--primary" type="submit">${esc(submitText)}</button>
                        <button class="btn btn--ghost" type="button" data-close>Cancelar</button>
                    </div>
                </form>
            </div>`;
        const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        const form = wrap.querySelector('form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            B.clearFieldErrors(form);
            let payload;
            if (multipart) {
                payload = new FormData();
                fields.forEach(f => {
                    const el = form.elements.namedItem(f.name);
                    if (f.type === 'file') { if (el.files[0]) payload.append(f.name, el.files[0]); }
                    else if (f.type === 'checkbox') payload.append(f.name, el.checked ? '1' : '0');
                    else payload.append(f.name, el.value);
                });
            } else {
                payload = {};
                fields.forEach(f => {
                    const el = form.elements.namedItem(f.name);
                    payload[f.name] = f.type === 'checkbox' ? el.checked : el.value;
                });
            }
            const btn = form.querySelector('[type="submit"]');
            btn.disabled = true;
            try { await onSubmit(payload, form); close(); }
            catch (err) { if (err.status !== 401) B.handleError(err, form); }
            finally { btn.disabled = false; }
        });
        document.body.appendChild(wrap);
        const first = form.querySelector('input:not([type=checkbox]),select,textarea');
        if (first) first.focus();
        return { wrap, form, close };
    }

    async function confirmDelete(msg, fn) {
        if (!await B.confirmDialog(msg, { okText: 'Sí, borrar', danger: true })) return;
        try { await fn(); } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }

    /* =========================================================
       ESTADÍSTICAS
       ========================================================= */
    async function loadStats() {
        try {
            const st = await call('GET', '/admin/stats');
            const card = (num, label, icon, alert) => `
                <div class="stat ${alert ? 'stat--alert' : ''}"><span class="stat__icon">${icon}</span>
                <span class="stat__num">${esc(num)}</span><span class="stat__label">${esc(label)}</span></div>`;
            const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
            $('#stats').innerHTML =
                card(st.reservationsToday, 'Reservas hoy', I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')) +
                card(st.reservationsWeek, 'Próximos 7 días', I('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')) +
                card(st.activeMembers + ' / ' + st.users, 'Socios con plan', I('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>')) +
                card(B.money(st.incomeMonth), 'Cobrado este mes', I('<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')) +
                card(st.paymentsToReview, 'Pagos a revisar', I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'), st.paymentsToReview > 0) +
                card(st.activeBlocks, 'Bloqueos activos', I('<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/>'));
            const c = $('#count-pagos');
            c.textContent = st.paymentsToReview;
            c.hidden = !st.paymentsToReview;
        } catch (e) { }
    }

    /* =========================================================
       TABS
       ========================================================= */
    const loaders = {
        reservas: loadReservations, usuarios: loadUsers, pagos: loadPayments, clases: loadActivities,
        apertura: loadHours, planes: loadPlans, productos: loadProducts, asistente: loadAssistant, profes: loadTeachers,
        bloqueos: loadBlocks, avisos: loadNotifs, config: loadSettings, auditoria: loadAudit,
    };
    function switchTab(name) {
        if (!loaders[name]) name = 'reservas';
        $$('#admin-tabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
        $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
        history.replaceState(null, '', '#' + name);
        loaders[name]();
    }
    $$('#admin-tabs .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // Actividades (se usan en varios selects)
    let activities = [];
    async function refreshActivities() {
        const r = await call('GET', '/admin/activities');
        activities = r.activities;
        const opts = activities.map(a => `<option value="${a.id}">${esc(a.name + (a.location ? ' · ' + a.location : ''))}</option>`).join('');
        $('#rf-activity').innerHTML = '<option value="">Todas</option>' + opts;
        $('#bs-activity').innerHTML = '<option value="">Elegí una clase</option>' + opts;
        return r;
    }

    /* =========================================================
       RESERVAS
       ========================================================= */
    const resFilters = $('#res-filters');
    let resTimer;
    resFilters.addEventListener('input', () => { clearTimeout(resTimer); resTimer = setTimeout(loadReservations, 250); });
    resFilters.addEventListener('reset', () => setTimeout(loadReservations, 0));

    async function loadReservations() {
        const p = new URLSearchParams();
        ['scope', 'date', 'activity', 'status', 'q'].forEach(k => {
            const v = resFilters.elements.namedItem(k).value.trim();
            if (v) p.set(k, v);
        });
        try {
            const { reservations } = await call('GET', '/admin/reservations?' + p);
            const today = B.todayStr();
            $('#res-body').innerHTML = reservations.length ? reservations.map(r => `
                <tr class="${r.date < today || r.status === 'cancelada' ? 'is-muted' : ''}">
                    <td><strong>${esc(B.dateShort(r.date))}</strong><br><small>${B.DAYS[B.weekday(r.date)]}</small></td>
                    <td>${esc(r.start_time)} - ${esc(r.end_time)}</td>
                    <td><span class="color-dot" style="background:${B.safeColor(r.color)}"></span>${esc(r.activity_name)}</td>
                    <td><span class="ticket-badge">#${Number(r.ticket)}</span></td>
                    <td><button class="link-btn" type="button" data-user="${Number(r.user_id)}">${esc(r.user_name)}</button><br><small>${esc(r.email)}</small></td>
                    <td>${r.status === 'activa' ? '<span class="pill pill--ok">Activa</span>' : `<span class="pill pill--error" title="${esc(r.cancel_reason || '')}">Cancelada</span>`}</td>
                    <td><div class="row-actions">${r.status === 'activa' && r.date >= today
                        ? `<button class="btn btn--danger btn--sm" type="button" data-cancel-res="${Number(r.id)}">Cancelar</button>` : ''}</div></td>
                </tr>`).join('') : emptyRow(7, 'No hay reservas con esos filtros.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#res-body').addEventListener('click', async (e) => {
        const c = e.target.closest('[data-cancel-res]');
        if (c) {
            if (!await B.confirmDialog('Se cancela la reserva y el boleto queda libre. El socio lo verá en su cuenta.', { okText: 'Cancelar reserva', danger: true })) return;
            try { await call('POST', `/admin/reservations/${c.dataset.cancelRes}/cancel`, { reason: 'Cancelada por el gimnasio' }); B.toast('Reserva cancelada.', 'ok'); loadReservations(); loadStats(); }
            catch (err) { B.toast(err.message, 'error'); }
        }
        const u = e.target.closest('[data-user]');
        if (u) openUser(Number(u.dataset.user));
    });

    /* =========================================================
       SOCIOS
       ========================================================= */
    let userTimer;
    $('#users-q').addEventListener('input', () => { clearTimeout(userTimer); userTimer = setTimeout(loadUsers, 250); });
    async function loadUsers() {
        try {
            const { users } = await call('GET', '/admin/users?q=' + encodeURIComponent($('#users-q').value.trim()));
            $('#users-body').innerHTML = users.length ? users.map(u => `
                <tr class="${u.active ? '' : 'is-muted'}">
                    <td><button class="link-btn" type="button" data-user="${u.id}">${esc(u.name + ' ' + u.lastname)}</button>
                        ${u.role === 'admin' ? ' <span class="pill pill--primary">Admin</span>' : u.role === 'profe' ? ' <span class="pill pill--warn">Profe</span>' : ''}</td>
                    <td>${esc(u.email)}</td>
                    <td>${u.plans ? esc(u.plans) : '<span class="pill pill--muted">Sin plan</span>'}</td>
                    <td class="num">${Number(u.upcoming)}</td>
                    <td>${esc(new Date(u.created_at).toLocaleDateString('es-AR'))}</td>
                    <td>${yesNo(u.active, 'Activo', 'Desactivado')}</td>
                    <td><div class="row-actions"><button class="btn btn--ghost btn--sm" type="button" data-user="${u.id}">Ver ficha</button></div></td>
                </tr>`).join('') : emptyRow(7, 'No se encontraron socios.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#users-body').addEventListener('click', (e) => {
        const u = e.target.closest('[data-user]');
        if (u) openUser(Number(u.dataset.user));
    });

    async function openUser(id) {
        let d;
        try { d = await call('GET', `/admin/users/${id}`); } catch (err) { return B.toast(err.message, 'error'); }
        const u = d.user;
        const today = B.todayStr();
        const wrap = document.createElement('div');
        wrap.className = 'modal';
        wrap.innerHTML = `
            <div class="modal__backdrop" data-close></div>
            <div class="modal__card modal__card--wide" role="dialog" aria-modal="true">
                <button class="modal__close" type="button" data-close aria-label="Cerrar">${ICON_X}</button>
                <h3>${esc(u.name + ' ' + u.lastname)} ${u.active ? '' : '<span class="pill pill--error">Desactivado</span>'}</h3>
                <div class="user-detail">
                    <div>
                        <h4>Datos</h4>
                        <dl class="kv">
                            <dt>Correo</dt><dd>${esc(u.email)}</dd>
                            <dt>Teléfono</dt><dd>${esc(u.phone || '—')}</dd>
                            <dt>Alta</dt><dd>${esc(B.dateTime(u.created_at))}</dd>
                            <dt>Reservas</dt><dd>${Number(d.stats.upcoming)} próximas · ${Number(d.stats.total)} en total</dd>
                        </dl>
                        <div class="modal__actions" style="justify-content:flex-start;margin-top:16px">
                            ${u.role === 'user' ? '<button class="btn btn--primary btn--sm" type="button" data-grant>Registrar plan cobrado en el box</button>' : ''}
                            ${u.id !== s.user.id ? `<button class="btn ${u.active ? 'btn--danger' : 'btn--ghost'} btn--sm" type="button" data-toggle>${u.active ? 'Desactivar cuenta' : 'Reactivar cuenta'}</button>` : ''}
                        </div>
                    </div>
                    <div>
                        <h4>Planes</h4>
                        <div class="mini-list">${d.subscriptions.length ? d.subscriptions.map(sb => `
                            <div class="mini-item"><div><strong>${esc(sb.plan_name)}</strong><br><small>${esc(B.dateShort(sb.start_date))} al ${esc(B.dateShort(sb.end_date))}</small></div>
                            ${sb.status === 'activa' && sb.end_date >= today ? '<span class="pill pill--ok">Vigente</span>'
                                : sb.status === 'pendiente' ? '<span class="pill pill--warn">Sin pagar</span>'
                                : sb.status === 'cancelada' ? '<span class="pill pill--muted">Cancelado</span>' : '<span class="pill pill--muted">Vencido</span>'}</div>`).join('')
                            : '<div class="empty-mini">Sin planes.</div>'}</div>
                    </div>
                    <div class="full">
                        <h4>Pagos</h4>
                        <div class="mini-list">${d.payments.length ? d.payments.map(p => `
                            <div class="mini-item"><div><strong>${esc(p.description)}</strong><br><small>${esc(B.dateTime(p.created_at))} · ${esc(B.PAY_METHOD[p.method] || 'Sin medio')}</small></div>
                            <span>${B.money(p.amount)}</span>${B.statusPill(p.status)}</div>`).join('')
                            : '<div class="empty-mini">Sin pagos.</div>'}</div>
                    </div>
                    <div class="full">
                        <h4>Calendario de actividades</h4>
                        <div id="user-cal"></div>
                    </div>
                </div>
            </div>`;
        const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape' && !$('.modal .modal__card:not(.modal__card--wide)')) close(); };
        document.addEventListener('keydown', onKey);
        wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        document.body.appendChild(wrap);
        new window.BunkerCalendar(wrap.querySelector('#user-cal'), (m) => call('GET', `/admin/users/${id}/calendar?month=${m}`));

        wrap.querySelector('[data-toggle]')?.addEventListener('click', async () => {
            const msg = u.active ? 'El socio no va a poder iniciar sesión y se cierran sus sesiones abiertas.' : 'El socio va a poder volver a ingresar.';
            if (!await B.confirmDialog(msg, { okText: u.active ? 'Desactivar' : 'Reactivar', danger: u.active })) return;
            try {
                await call('PATCH', `/admin/users/${id}`, { active: !u.active });
                B.toast('Listo.', 'ok'); close(); loadUsers();
            } catch (err) { B.toast(err.message, 'error'); }
        });
        wrap.querySelector('[data-grant]')?.addEventListener('click', async () => {
            const { plans } = await call('GET', '/admin/plans');
            openForm({
                title: 'Registrar plan cobrado',
                subtitle: `Para ${u.name} ${u.lastname}. Queda aprobado y activo al instante.`,
                fields: [
                    { name: 'planId', label: 'Plan', type: 'select', full: true, options: plans.map(p => ({ value: p.id, label: `${p.name} — ${B.money(p.price)}${p.active ? '' : ' (inactivo)'}` })) },
                    { name: 'method', label: 'Cómo pagó', type: 'select', full: true, options: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'transferencia', label: 'Transferencia' }] },
                ],
                submitText: 'Registrar',
                onSubmit: async (v) => {
                    await call('POST', `/admin/users/${id}/grant-plan`, { planId: Number(v.planId), method: v.method });
                    B.toast('Plan registrado y activo.', 'ok');
                    close(); openUser(id); loadStats();
                },
            });
        });
    }

    /* =========================================================
       PAGOS
       ========================================================= */
    $('#pay-status').addEventListener('change', loadPayments);
    async function loadPayments() {
        try {
            const { payments } = await call('GET', '/admin/payments?status=' + $('#pay-status').value);
            $('#pay-body').innerHTML = payments.length ? payments.map(p => `
                <tr>
                    <td class="num">${p.id}</td>
                    <td>${esc(B.dateTime(p.created_at))}</td>
                    <td><button class="link-btn" type="button" data-user="${Number(p.user_id)}">${esc(p.user_name)}</button><br><small>${esc(p.email)}</small></td>
                    <td>${esc(p.description)}${p.transfer_ref ? `<br><small>Operación: <strong>${esc(p.transfer_ref)}</strong></small>` : ''}</td>
                    <td class="num">${B.money(p.amount)}</td>
                    <td>${esc(B.PAY_METHOD[p.method] || '—')}</td>
                    <td>${B.statusPill(p.status)}</td>
                    <td><div class="row-actions">${['pendiente', 'en_revision'].includes(p.status) ? `
                        <button class="btn btn--primary btn--sm" type="button" data-approve="${p.id}">Aprobar</button>
                        <button class="btn btn--danger btn--sm" type="button" data-reject="${p.id}">Rechazar</button>` : ''}</div></td>
                </tr>`).join('') : emptyRow(8, 'No hay pagos en este estado.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#pay-body').addEventListener('click', async (e) => {
        const u = e.target.closest('[data-user]');
        if (u) return openUser(Number(u.dataset.user));
        const a = e.target.closest('[data-approve]');
        const r = e.target.closest('[data-reject]');
        if (!a && !r) return;
        const ok = await B.confirmDialog(a ? 'Confirmás que el pago se recibió. El plan del socio se activa.' : 'El pago se rechaza y el plan no se activa.',
            { okText: a ? 'Aprobar pago' : 'Rechazar pago', danger: !!r });
        if (!ok) return;
        try {
            await call('POST', `/admin/payments/${(a || r).dataset[a ? 'approve' : 'reject']}/${a ? 'approve' : 'reject'}`, {});
            B.toast(a ? 'Pago aprobado. Plan activado.' : 'Pago rechazado.', 'ok');
            loadPayments(); loadStats();
        } catch (err) { B.toast(err.message, 'error'); }
    });

    /* =========================================================
       CLASES Y HORARIOS
       ========================================================= */
    const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
    let iconList = [];
    async function loadActivities() {
        try {
            const r = await refreshActivities();
            iconList = r.icons;
            $('#activities-list').innerHTML = activities.length ? activities.map(a => {
                const c = B.safeColor(a.color);
                return `
                <article class="activity ${a.active ? '' : 'activity--off'}" style="border-left-color:${c}">
                    <div class="activity__head">
                        <div class="activity__icon" style="color:${c};background:${c}22">${B.icon(a.icon)}</div>
                        <div class="activity__title"><h3>${esc(a.name)} ${a.location ? `<span class="pill pill--primary">${esc(a.location)}</span>` : ''} ${a.active ? '' : '<span class="pill pill--muted">Oculta</span>'}</h3><p>${esc(a.description)}</p></div>
                        <div class="row-actions">
                            <button class="btn btn--ghost btn--sm" type="button" data-edit-act="${a.id}">${ICON_EDIT} Editar</button>
                            <button class="btn btn--danger btn--sm" type="button" data-del-act="${a.id}">${ICON_DEL}</button>
                        </div>
                    </div>
                    <div class="week">${WEEK_ORDER.map(d => `
                        <div class="week__day"><h4>${B.DAYS_SHORT[d]}</h4>
                            ${a.slots.filter(sl => sl.weekday === d).map(sl => `
                                <button type="button" class="slot-chip ${sl.active ? '' : 'slot-chip--off'}" data-edit-slot="${sl.id}" title="Editar horario${sl.teachers.length ? ' · Profes: ' + esc(sl.teachers.map(t => t.name).join(', ')) : ' · Sin profe asignado'}">
                                    <span>${esc(sl.start_time)}–${esc(sl.end_time)}</span><small>${Number(sl.capacity)}👤</small>
                                    <span class="slot-chip__t ${sl.teachers.length ? '' : 'is-none'}">${sl.teachers.length ? esc(sl.teachers.map(t => t.name.split(' ')[0]).join(', ')) : 'sin profe'}</span></button>`).join('')}
                            <button type="button" class="week__add" data-add-slot="${a.id}" data-day="${d}">+ horario</button>
                        </div>`).join('')}
                    </div>
                </article>`;
            }).join('') : '<div class="empty">No hay actividades. Creá la primera.</div>';
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }

    const ICON_NAMES = { pesa: 'Pesa', pulso: 'Pulso', rayo: 'Rayo', reloj: 'Reloj', corazon: 'Corazón', fuego: 'Fuego', persona: 'Persona', bici: 'Bici' };
    function activityForm(a) {
        openForm({
            title: a ? 'Editar actividad' : 'Nueva actividad',
            fields: [
                { name: 'name', label: 'Nombre', value: a?.name, max: 50 },
                { name: 'short_name', label: 'Nombre corto (grilla)', value: a?.short_name, max: 20 },
                { name: 'location', label: 'Sede o sala (opcional)', value: a?.location || '', max: 60, full: true, placeholder: 'Ej: Sede Centro · Salón 2' },
                { name: 'description', label: 'Descripción', type: 'textarea', value: a?.description, max: 300, full: true, rows: 3 },
                { name: 'color', label: 'Color', type: 'color', value: a?.color || '#9d4edd' },
                { name: 'icon', label: 'Ícono', type: 'select', value: a?.icon || 'pesa', options: (iconList.length ? iconList : Object.keys(ICON_NAMES)).map(i => ({ value: i, label: ICON_NAMES[i] || i })) },
                { name: 'sort_order', label: 'Orden', type: 'number', value: a?.sort_order ?? activities.length, min: 0, maxNum: 999 },
                { name: 'active', label: 'Visible en la página', type: 'checkbox', value: a ? !!a.active : true },
            ],
            onSubmit: async (v) => {
                await call(a ? 'PUT' : 'POST', a ? `/admin/activities/${a.id}` : '/admin/activities', v);
                B.toast('Actividad guardada.', 'ok'); loadActivities();
            },
        });
    }

    function slotForm(slot, activityId, weekday) {
        const act = activities.find(a => a.id === (slot ? slot.activity_id : activityId));
        const f = openForm({
            title: slot ? 'Editar horario' : 'Nuevo horario',
            subtitle: act ? act.name : '',
            fields: [
                { name: 'activity_id', label: 'Actividad', type: 'select', value: slot?.activity_id ?? activityId, options: activities.map(a => ({ value: a.id, label: a.name })) },
                { name: 'weekday', label: 'Día', type: 'select', value: slot?.weekday ?? weekday, options: WEEK_ORDER.map(d => ({ value: d, label: B.DAYS[d] })) },
                { name: 'start_time', label: 'Desde', type: 'time', value: slot?.start_time || '' },
                { name: 'end_time', label: 'Hasta', type: 'time', value: slot?.end_time || '' },
                { name: 'capacity', label: 'Cupo (boletos)', type: 'number', value: slot?.capacity ?? 12, min: 1, maxNum: 100 },
                { name: 'active', label: 'Activo (se puede reservar)', type: 'checkbox', value: slot ? !!slot.active : true },
            ],
            extraHtml: slot ? `<button class="btn btn--danger btn--sm" type="button" data-del-slot style="margin-bottom:14px">${ICON_DEL} Borrar este horario</button>` : '',
            onSubmit: async (v) => {
                const body = { ...v, activity_id: Number(v.activity_id), weekday: Number(v.weekday), capacity: Number(v.capacity) };
                const r = await call(slot ? 'PUT' : 'POST', slot ? `/admin/slots/${slot.id}` : '/admin/slots', body);
                B.toast(r.cancelledReservations ? `Horario guardado. Se cancelaron ${r.cancelledReservations} reserva(s) afectada(s).` : 'Horario guardado.', 'ok');
                loadActivities();
            },
        });
        f.form.querySelector('[data-del-slot]')?.addEventListener('click', () => confirmDelete('Se borra el horario y se cancelan sus reservas futuras.', async () => {
            const r = await call('DELETE', `/admin/slots/${slot.id}`);
            B.toast(`Horario borrado${r.cancelledReservations ? ` (${r.cancelledReservations} reservas canceladas)` : ''}.`, 'ok');
            f.close(); loadActivities();
        }));
    }

    $('#add-activity').addEventListener('click', () => activityForm(null));
    $('#activities-list').addEventListener('click', (e) => {
        const ea = e.target.closest('[data-edit-act]');
        if (ea) return activityForm(activities.find(a => a.id === Number(ea.dataset.editAct)));
        const da = e.target.closest('[data-del-act]');
        if (da) return confirmDelete('Se borra la actividad con todos sus horarios. Si tiene reservas o planes asociados no se puede borrar (desactivala).', async () => {
            await call('DELETE', `/admin/activities/${da.dataset.delAct}`);
            B.toast('Actividad borrada.', 'ok'); loadActivities();
        });
        const es = e.target.closest('[data-edit-slot]');
        if (es) {
            const slot = activities.flatMap(a => a.slots).find(x => x.id === Number(es.dataset.editSlot));
            return slotForm(slot);
        }
        const as = e.target.closest('[data-add-slot]');
        if (as) slotForm(null, Number(as.dataset.addSlot), Number(as.dataset.day));
    });

    /* =========================================================
       HORARIO DEL BOX
       ========================================================= */
    async function loadHours() {
        try {
            const { hours } = await call('GET', '/admin/opening-hours');
            const by = Object.fromEntries(hours.map(h => [h.weekday, h]));
            $('#hours-rows').innerHTML = WEEK_ORDER.map(d => {
                const h = by[d] || { is_open: 0 };
                return `
                <div class="hours-row" data-wd="${d}">
                    <strong>${B.DAYS[d]}</strong>
                    <label class="check"><input type="checkbox" data-open ${h.is_open ? 'checked' : ''}> Abierto</label>
                    <input type="time" data-from value="${esc(h.open_time || '')}" aria-label="Abre" ${h.is_open ? '' : 'disabled'}>
                    <input type="time" data-to value="${esc(h.close_time || '')}" aria-label="Cierra" ${h.is_open ? '' : 'disabled'}>
                </div>`;
            }).join('');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#hours-rows').addEventListener('change', (e) => {
        if (!e.target.matches('[data-open]')) return;
        const row = e.target.closest('.hours-row');
        row.querySelectorAll('input[type=time]').forEach(i => { i.disabled = !e.target.checked; });
    });
    $('#hours-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const hours = $$('.hours-row').map(r => ({
            weekday: Number(r.dataset.wd),
            is_open: r.querySelector('[data-open]').checked,
            open_time: r.querySelector('[data-from]').value || null,
            close_time: r.querySelector('[data-to]').value || null,
        }));
        try { await call('PUT', '/admin/opening-hours', { hours }); B.toast('Horario guardado.', 'ok'); }
        catch (err) { B.toast(err.message, 'error'); }
    });

    /* =========================================================
       PLANES
       ========================================================= */
    let plans = [];
    async function loadPlans() {
        try {
            if (!activities.length) await refreshActivities();
            plans = (await call('GET', '/admin/plans')).plans;
            $('#plans-body').innerHTML = plans.length ? plans.map(p => `
                <tr class="${p.active ? '' : 'is-muted'}">
                    <td><strong>${esc(p.name)}</strong> ${p.featured ? '<span class="pill pill--primary">Destacado</span>' : ''}
                        ${p.promo_until ? (p.promo_until >= B.todayStr() ? `<span class="pill pill--primary">🎁 Promo hasta ${esc(B.dateShort(p.promo_until))}</span>` : '<span class="pill">Promo vencida (oculta)</span>') : ''}
                        <br><small>${esc(p.description)}</small></td>
                    <td>${p.kind === 'membresia' ? 'Mensualidad' : 'Actividad: ' + esc(p.activity_name || '?')}</td>
                    <td class="num">${B.money(p.price)}</td>
                    <td>${Number(p.duration_days)} días</td>
                    <td>${p.weekly_limit ? Number(p.weekly_limit) + ' por semana' : 'Sin límite'}</td>
                    <td>${yesNo(p.active, 'Publicado', 'Oculto')}</td>
                    <td><div class="row-actions">
                        <button class="btn btn--ghost btn--sm" type="button" data-edit-plan="${p.id}">${ICON_EDIT}</button>
                        <button class="btn btn--danger btn--sm" type="button" data-del-plan="${p.id}">${ICON_DEL}</button></div></td>
                </tr>`).join('') : emptyRow(7, 'No hay planes.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    function planForm(p) {
        const f = openForm({
            title: p ? 'Editar plan' : 'Nuevo plan',
            fields: [
                { name: 'name', label: 'Nombre', value: p?.name, max: 60, full: true },
                { name: 'description', label: 'Descripción', type: 'textarea', value: p?.description, max: 300, full: true, rows: 2 },
                { name: 'kind', label: 'Tipo', type: 'select', value: p?.kind || 'membresia', options: [{ value: 'membresia', label: 'Mensualidad (todas las actividades)' }, { value: 'actividad', label: 'Una actividad' }] },
                { name: 'activity_id', label: 'Actividad', type: 'select', value: p?.activity_id || '', options: [{ value: '', label: '—' }, ...activities.map(a => ({ value: a.id, label: a.name }))] },
                { name: 'price', label: 'Precio ($)', type: 'number', value: p?.price ?? '', min: 0 },
                { name: 'duration_days', label: 'Duración (días)', type: 'number', value: p?.duration_days ?? 30, min: 1, maxNum: 366 },
                { name: 'weekly_limit', label: 'Clases por semana (vacío = sin límite)', type: 'number', value: p?.weekly_limit ?? '', min: 1, maxNum: 14 },
                { name: 'sort_order', label: 'Orden', type: 'number', value: p?.sort_order ?? plans.length, min: 0 },
                { name: 'featured', label: 'Destacar ("Más elegido")', type: 'checkbox', value: p ? !!p.featured : false },
                { name: 'promo_until', label: '🎁 Promo hasta (vacío = plan normal)', type: 'date', value: p?.promo_until || '' },
                { name: 'active', label: 'Publicado', type: 'checkbox', value: p ? !!p.active : true },
            ],
            onSubmit: async (v) => {
                await call(p ? 'PUT' : 'POST', p ? `/admin/plans/${p.id}` : '/admin/plans', v);
                B.toast('Plan guardado.', 'ok'); loadPlans();
            },
        });
        const kind = f.form.elements.namedItem('kind'), act = f.form.elements.namedItem('activity_id');
        const sync = () => { act.disabled = kind.value !== 'actividad'; if (act.disabled) act.value = ''; };
        kind.addEventListener('change', sync); sync();
    }
    $('#add-plan').addEventListener('click', async () => { if (!activities.length) await refreshActivities(); planForm(null); });
    $('#plans-body').addEventListener('click', (e) => {
        const ed = e.target.closest('[data-edit-plan]');
        if (ed) return planForm(plans.find(p => p.id === Number(ed.dataset.editPlan)));
        const del = e.target.closest('[data-del-plan]');
        if (del) confirmDelete('Se borra el plan. Los socios que ya lo tienen lo conservan hasta que venza.', async () => {
            await call('DELETE', `/admin/plans/${del.dataset.delPlan}`); B.toast('Plan borrado.', 'ok'); loadPlans();
        });
    });

    /* =========================================================
       PRODUCTOS
       ========================================================= */
    let products = [];
    async function loadProducts() {
        try {
            products = (await call('GET', '/admin/products')).products;
            $('#products-body').innerHTML = products.length ? products.map(p => `
                <tr class="${p.active ? '' : 'is-muted'}">
                    <td>${p.image ? `<img class="thumb" src="/uploads/products/${encodeURIComponent(p.image)}" alt="">` : '<div class="thumb">sin foto</div>'}</td>
                    <td><strong>${esc(p.name)}</strong><br><small>${esc(p.description)}</small></td>
                    <td>${esc(p.category)}</td>
                    <td class="num">${B.money(p.price)}</td>
                    <td><button class="btn btn--ghost btn--sm" type="button" data-toggle-stock="${p.id}">${p.available ? '✓ Disponible' : '✕ Sin stock'}</button></td>
                    <td>${yesNo(p.active, 'Visible', 'Oculto')}</td>
                    <td><div class="row-actions">
                        <button class="btn btn--ghost btn--sm" type="button" data-edit-prod="${p.id}">${ICON_EDIT}</button>
                        <button class="btn btn--danger btn--sm" type="button" data-del-prod="${p.id}">${ICON_DEL}</button></div></td>
                </tr>`).join('') : emptyRow(7, 'No hay productos.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    function productFields(p) {
        return [
            { name: 'name', label: 'Nombre', value: p?.name, max: 80, full: true },
            { name: 'description', label: 'Descripción', type: 'textarea', value: p?.description, max: 300, full: true, rows: 2 },
            { name: 'category', label: 'Categoría', value: p?.category || 'Bebidas', max: 40, placeholder: 'Bebidas, Suplementos…' },
            { name: 'price', label: 'Precio ($)', type: 'number', value: p?.price ?? '', min: 0 },
            { name: 'sort_order', label: 'Orden', type: 'number', value: p?.sort_order ?? 0, min: 0 },
            { name: 'image', label: p?.image ? 'Reemplazar foto' : 'Foto (opcional)', type: 'file', hint: 'JPG, PNG o WEBP. Máximo 2 MB.' },
            { name: 'available', label: 'Hay stock', type: 'checkbox', value: p ? !!p.available : true },
            { name: 'active', label: 'Visible en la página', type: 'checkbox', value: p ? !!p.active : true },
            ...(p?.image ? [{ name: 'remove_image', label: 'Quitar la foto actual', type: 'checkbox', value: false }] : []),
        ];
    }
    function productForm(p) {
        openForm({
            title: p ? 'Editar producto' : 'Nuevo producto',
            fields: productFields(p),
            multipart: true,
            onSubmit: async (fd) => {
                const file = fd.get('image');
                if (file && file.size > 2 * 1024 * 1024) throw new B.ApiError(400, { error: 'La imagen no puede superar 2 MB.', field: 'image' });
                await call(p ? 'PUT' : 'POST', p ? `/admin/products/${p.id}` : '/admin/products', fd);
                B.toast('Producto guardado.', 'ok'); loadProducts();
            },
        });
    }
    $('#add-product').addEventListener('click', () => productForm(null));
    $('#products-body').addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-edit-prod]');
        if (ed) return productForm(products.find(p => p.id === Number(ed.dataset.editProd)));
        const del = e.target.closest('[data-del-prod]');
        if (del) return confirmDelete('Se borra el producto del mostrador.', async () => {
            await call('DELETE', `/admin/products/${del.dataset.delProd}`); B.toast('Producto borrado.', 'ok'); loadProducts();
        });
        const tg = e.target.closest('[data-toggle-stock]');
        if (tg) {
            const p = products.find(x => x.id === Number(tg.dataset.toggleStock));
            const fd = new FormData();
            ['name', 'description', 'category', 'price', 'sort_order'].forEach(k => fd.append(k, p[k]));
            fd.append('available', p.available ? '0' : '1');
            fd.append('active', p.active ? '1' : '0');
            try { await call('PUT', `/admin/products/${p.id}`, fd); loadProducts(); }
            catch (err) { B.toast(err.message, 'error'); }
        }
    });

    /* =========================================================
       PROFES
       ========================================================= */
    let teachers = [];
    async function loadTeachers() {
        try {
            const r = await call('GET', '/admin/teachers');
            teachers = r.teachers;
            $('#teachers-body').innerHTML = teachers.length ? teachers.map(t => `
                <tr class="${t.active ? '' : 'is-muted'}">
                    <td><strong>${esc(t.name + ' ' + t.lastname)}</strong>${t.phone ? `<br><small>${esc(t.phone)}</small>` : ''}</td>
                    <td>${esc(t.email)}</td>
                    <td class="num">${t.slots.length ? Number(t.slots.length) : '<span class="pill pill--warn">Ninguno</span>'}</td>
                    <td class="num">${t.absences ? `<span class="pill pill--warn">${Number(t.absences)}</span>` : '0'}</td>
                    <td>${yesNo(t.active, 'Activo', 'Desactivado')}</td>
                    <td><div class="row-actions">
                        <button class="btn btn--primary btn--sm" type="button" data-assign="${t.id}">Asignar horarios</button>
                        <button class="btn btn--ghost btn--sm" type="button" data-edit-teacher="${t.id}" title="Editar">${ICON_EDIT}</button>
                        <button class="btn btn--ghost btn--sm" type="button" data-pass-teacher="${t.id}">Nueva clave</button>
                        <button class="btn btn--danger btn--sm" type="button" data-del-teacher="${t.id}" title="Borrar">${ICON_DEL}</button>
                    </div></td>
                </tr>`).join('') : emptyRow(6, 'Todavía no hay profes. Creá el primero con "+ Nuevo profe".');
            $('#absences-list').innerHTML = r.absences.length ? r.absences.map(a => `
                <article class="block-item block-item--slot">
                    <div class="block-item__body">
                        <div class="block-item__title">${esc(B.dateLong(a.date))} · ${esc(a.start_time)}–${esc(a.end_time)} · ${esc(a.activity_name)}${a.location ? ' · ' + esc(a.location) : ''}</div>
                        <div class="block-item__reason"><strong>${esc(a.name + ' ' + a.lastname)}</strong> no viene: ${esc(a.reason)}</div>
                    </div>
                    <div class="row-actions"><button class="btn btn--ghost btn--sm" type="button" data-del-absence="${a.id}" title="Quitar el aviso">${ICON_DEL}</button></div>
                </article>`).join('') : '<div class="empty">No hay ausencias avisadas.</div>';
            const c = $('#count-ausencias');
            c.textContent = r.absences.length; c.hidden = !r.absences.length;
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }

    function teacherForm(t) {
        const fields = [
            { name: 'name', label: 'Nombre', value: t?.name, max: 40 },
            { name: 'lastname', label: 'Apellido', value: t?.lastname, max: 40 },
            { name: 'phone', label: 'Teléfono (opcional)', value: t?.phone || '', max: 30 },
        ];
        if (!t) fields.push(
            { name: 'email', label: 'Correo (con el que entra)', type: 'email', value: '', max: 120 },
            { name: 'password', label: 'Contraseña inicial', type: 'password', value: '', max: 72, hint: 'Mínimo 8 caracteres con letras y números. Pasásela al profe en persona.' },
        );
        fields.push({ name: 'active', label: 'Cuenta activa (puede entrar)', type: 'checkbox', value: t ? !!t.active : true, full: true });
        openForm({
            title: t ? 'Editar profe' : 'Nuevo profe',
            subtitle: t ? t.email : 'Se crea una cuenta con rol "profe": solo ve sus clases y alumnos.',
            fields,
            onSubmit: async (v) => {
                await call(t ? 'PUT' : 'POST', t ? `/admin/teachers/${t.id}` : '/admin/teachers', v);
                B.toast(t ? 'Profe actualizado.' : 'Profe creado. Ahora asignale sus horarios.', 'ok');
                loadTeachers();
            },
        });
    }

    async function assignForm(t) {
        await refreshActivities();
        const mine = new Set(t.slots);
        const days = WEEK_ORDER.map(d => {
            const items = activities.flatMap(a => a.slots.filter(sl => sl.weekday === d).map(sl => ({ ...sl, act: a })))
                .sort((x, y) => x.start_time.localeCompare(y.start_time));
            if (!items.length) return '';
            return `<div class="assign-day"><h4>${B.DAYS[d]}</h4><div class="assign-grid">${items.map(sl => `
                <label title="${esc(sl.act.name)}${sl.teachers.length ? ' · Profes: ' + esc(sl.teachers.map(x => x.name).join(', ')) : ''}">
                    <input type="checkbox" value="${sl.id}" data-act="${sl.act.id}" ${mine.has(sl.id) ? 'checked' : ''}>
                    ${esc(sl.start_time)} ${esc(sl.act.short_name)}${sl.active ? '' : ' (inactivo)'}
                </label>`).join('')}</div></div>`;
        }).join('');
        const f = openForm({
            title: `Horarios de ${t.name} ${t.lastname}`,
            subtitle: 'Marcá las clases que da. Una clase puede tener varios profes.',
            fields: [],
            extraHtml: `<div class="assign-tools">${activities.map(a => `<button class="btn btn--ghost btn--sm" type="button" data-all-act="${a.id}">Todas de ${esc(a.short_name)}</button>`).join('')}
                <button class="btn btn--ghost btn--sm" type="button" data-none>Ninguna</button></div><div class="assign-scroll">${days}</div>`,
            onSubmit: async (v, form) => {
                const slotIds = $$('.assign-grid input:checked', form).map(i => Number(i.value));
                const r = await call('PUT', `/admin/teachers/${t.id}/slots`, { slotIds });
                B.toast(`Listo: ${r.count} horario(s) asignado(s).`, 'ok');
                loadTeachers();
                if (activities.length) loadActivitiesQuiet();
            },
        });
        f.form.addEventListener('click', (e) => {
            const all = e.target.closest('[data-all-act]');
            if (all) $$(`.assign-grid input[data-act="${all.dataset.allAct}"]`, f.form).forEach(i => { i.checked = true; });
            if (e.target.closest('[data-none]')) $$('.assign-grid input', f.form).forEach(i => { i.checked = false; });
        });
    }
    const loadActivitiesQuiet = () => refreshActivities().catch(() => { });

    $('#add-teacher').addEventListener('click', () => teacherForm(null));
    $('#teachers-body').addEventListener('click', (e) => {
        const find = (attr) => teachers.find(t => t.id === Number(e.target.closest(`[${attr}]`).getAttribute(attr)));
        if (e.target.closest('[data-assign]')) return assignForm(find('data-assign'));
        if (e.target.closest('[data-edit-teacher]')) return teacherForm(find('data-edit-teacher'));
        if (e.target.closest('[data-pass-teacher]')) {
            const t = find('data-pass-teacher');
            return openForm({
                title: 'Nueva contraseña', subtitle: `${t.name} ${t.lastname} · se cierran sus sesiones abiertas.`,
                fields: [{ name: 'password', label: 'Contraseña nueva', type: 'password', max: 72, hint: 'Mínimo 8 caracteres con letras y números.' }],
                onSubmit: async (v) => { await call('POST', `/admin/teachers/${t.id}/password`, v); B.toast('Contraseña cambiada.', 'ok'); },
            });
        }
        if (e.target.closest('[data-del-teacher]')) {
            const t = find('data-del-teacher');
            return confirmDelete(`Se borra la cuenta de ${t.name} ${t.lastname}, sus horarios asignados y sus avisos. Si solo querés que no entre más, desactivala.`, async () => {
                await call('DELETE', `/admin/teachers/${t.id}`); B.toast('Profe borrado.', 'ok'); loadTeachers();
            });
        }
    });
    $('#absences-list').addEventListener('click', (e) => {
        const d = e.target.closest('[data-del-absence]');
        if (d) confirmDelete('Se quita el aviso: la clase vuelve a mostrar al profe.', async () => {
            await call('DELETE', `/admin/absences/${d.dataset.delAbsence}`); B.toast('Aviso quitado.', 'ok'); loadTeachers();
        });
    });

    /* =========================================================
       ASISTENTE IA (reemplaza al FAQ)
       ========================================================= */
    let extras = [];
    async function loadAssistant() {
        try {
            const r = await call('GET', '/admin/assistant');
            extras = r.extras;
            const mode = r.provider === 'local'
                ? '<span class="pill pill--warn">Modo sin IA</span> Responde buscando en los archivos. Para usar IA, poné <code>LLM_API_KEY</code> en el archivo <code>.env</code> (ver README).'
                : `<span class="pill pill--ok">IA activa</span> Proveedor: <strong>${esc(r.provider)}</strong> · modelo <code>${esc(r.model)}</code>.`;
            $('#as-status').innerHTML = `${mode}<br>El asistente responde solo con los <strong>datos públicos</strong> (se regeneran solos con cada cambio) y el <strong>conocimiento extra</strong>. Nunca lee la base de datos.`;
            $('#extras-list').innerHTML = extras.length ? extras.map(x => `
                <article class="block-item extra-item" style="border-left-color:var(--primary)">
                    <div class="block-item__body">
                        <div class="block-item__title">${esc(x.tema)}</div>
                        <div class="block-item__reason">${esc(x.dato)}</div>
                    </div>
                    <div class="row-actions">
                        <button class="btn btn--ghost btn--sm" type="button" data-edit-extra="${x.id}">${ICON_EDIT}</button>
                        <button class="btn btn--danger btn--sm" type="button" data-del-extra="${x.id}">${ICON_DEL}</button>
                    </div>
                </article>`).join('') : '<div class="empty">No hay datos extra.</div>';
            $('#as-public-count').textContent = r.publicRows.length;
            $('#as-public').innerHTML = r.publicRows.map(x => `<tr><td>${esc(x.categoria)}</td><td>${esc(x.tema)}</td><td>${esc(x.dato)}</td></tr>`).join('');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    function extraForm(x) {
        openForm({
            title: x ? 'Editar dato extra' : 'Nuevo dato extra',
            subtitle: 'Escribilo como se lo dirías a un socio. El asistente lo usa tal cual.',
            fields: [
                { name: 'tema', label: 'Tema', value: x?.tema, max: 80, full: true, placeholder: 'Ej: Estacionamiento' },
                { name: 'dato', label: 'Información', type: 'textarea', value: x?.dato, max: 1000, full: true, rows: 5, placeholder: 'Ej: Hay lugar para estacionar en la calle; no tenemos estacionamiento propio.' },
            ],
            onSubmit: async (v) => {
                await call(x ? 'PUT' : 'POST', x ? `/admin/assistant/extras/${x.id}` : '/admin/assistant/extras', v);
                B.toast('Guardado. El asistente ya lo sabe.', 'ok'); loadAssistant();
            },
        });
    }
    $('#add-extra').addEventListener('click', () => extraForm(null));
    $('#extras-list').addEventListener('click', (e) => {
        const ed = e.target.closest('[data-edit-extra]');
        if (ed) return extraForm(extras.find(x => x.id === Number(ed.dataset.editExtra)));
        const del = e.target.closest('[data-del-extra]');
        if (del) confirmDelete('Se borra este dato del asistente.', async () => {
            await call('DELETE', `/admin/assistant/extras/${del.dataset.delExtra}`); B.toast('Dato borrado.', 'ok'); loadAssistant();
        });
    });

    /* =========================================================
       BLOQUEOS
       ========================================================= */
    async function loadBlocks() {
        try {
            if (!activities.length) await refreshActivities();
            const { days, slots } = await call('GET', '/admin/blocks');
            const items = [
                ...days.map(d => ({ date: d.date, html: `
                    <article class="block-item">
                        <div class="block-item__body"><div class="block-item__title">Día completo · ${esc(B.dateLong(d.date))}</div>
                        <div class="block-item__reason">${esc(d.reason)}</div></div>
                        <button class="btn btn--danger btn--sm" type="button" data-unblock-day="${esc(d.date)}">Quitar</button>
                    </article>` })),
                ...slots.map(b => ({ date: b.date, html: `
                    <article class="block-item block-item--slot">
                        <div class="block-item__body"><div class="block-item__title">${esc(b.activity_name)} · ${esc(b.start_time)} HS</div>
                        <div class="block-item__meta">${esc(B.dateLong(b.date))}</div>
                        <div class="block-item__reason">${esc(b.reason)}</div></div>
                        <button class="btn btn--danger btn--sm" type="button" data-unblock-slot="${b.id}">Quitar</button>
                    </article>` })),
            ].sort((a, b) => a.date.localeCompare(b.date));
            $('#blocks-list').innerHTML = items.length ? items.map(i => i.html).join('') : '<div class="empty">No hay bloqueos activos.</div>';
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    const today = B.todayStr();
    $('#bd-date').min = today; $('#bs-date').min = today;

    $('#block-day-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.elements.namedItem('date').value) return B.toast('Elegí una fecha.', 'error');
        if (!await B.confirmDialog('Ese día no se va a poder reservar y se cancelan las reservas que ya existan.', { okText: 'Bloquear día', danger: true })) return;
        try {
            const r = await call('POST', '/admin/blocks/day', { date: f.elements.namedItem('date').value, reason: f.elements.namedItem('reason').value });
            B.toast(`Día bloqueado${r.cancelledReservations ? ` · ${r.cancelledReservations} reservas canceladas` : ''}.`, 'ok');
            f.reset(); loadBlocks(); loadStats();
        } catch (err) { B.toast(err.message, 'error'); }
    });

    function updateSlotSelect() {
        const actId = Number($('#bs-activity').value);
        const date = $('#bs-date').value;
        const sel = $('#bs-slot');
        const act = activities.find(a => a.id === actId);
        if (!act || !date) { sel.disabled = true; sel.innerHTML = '<option value="">Primero elegí clase y fecha</option>'; return; }
        const list = act.slots.filter(x => x.weekday === B.weekday(date));
        if (!list.length) { sel.disabled = true; sel.innerHTML = `<option value="">${esc(act.name)} no tiene clase ese día</option>`; return; }
        sel.disabled = false;
        sel.innerHTML = '<option value="">Elegí un horario</option>' + list.map(x => `<option value="${x.id}">${esc(x.start_time)} - ${esc(x.end_time)} HS</option>`).join('');
    }
    $('#bs-activity').addEventListener('change', updateSlotSelect);
    $('#bs-date').addEventListener('change', updateSlotSelect);
    $('#block-slot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const slotId = Number($('#bs-slot').value);
        if (!slotId) return B.toast('Completá clase, fecha y horario.', 'error');
        try {
            const r = await call('POST', '/admin/blocks/slot', { slotId, date: $('#bs-date').value, reason: $('#bs-reason').value });
            B.toast(`Horario bloqueado${r.cancelledReservations ? ` · ${r.cancelledReservations} reservas canceladas` : ''}.`, 'ok');
            f.reset(); updateSlotSelect(); loadBlocks(); loadStats();
        } catch (err) { B.toast(err.message, 'error'); }
    });
    $('#blocks-list').addEventListener('click', async (e) => {
        const d = e.target.closest('[data-unblock-day]');
        const sl = e.target.closest('[data-unblock-slot]');
        try {
            if (d) await call('DELETE', `/admin/blocks/day/${encodeURIComponent(d.dataset.unblockDay)}`);
            else if (sl) await call('DELETE', `/admin/blocks/slot/${sl.dataset.unblockSlot}`);
            else return;
            B.toast('Bloqueo quitado.', 'ok'); loadBlocks(); loadStats();
        } catch (err) { B.toast(err.message, 'error'); }
    });

    /* =========================================================
       AVISOS
       ========================================================= */
    $('#n-msg').addEventListener('input', (e) => { $('#n-count').textContent = e.target.value.length; });
    async function loadNotifs() {
        try {
            const [{ notifications }, { plans: allPlans }] = await Promise.all([call('GET', '/admin/notifications'), call('GET', '/admin/plans')]);
            const today = B.todayStr();
            // PROMO: el aviso puede llevar un botón a un plan marcado como promo (vigente).
            const sel = $('#n-plan');
            const promoPlans = allPlans.filter(x => x.active && x.promo_until && x.promo_until >= today);
            sel.innerHTML = '<option value="">Sin botón (aviso común)</option>'
                + promoPlans.map(x => `<option value="${x.id}">🎁 ${esc(x.name)} · hasta ${esc(B.dateShort(x.promo_until))}</option>`).join('');
            $('#n-plan-hint').textContent = promoPlans.length ? '' : 'Para usarlo, primero marcá un plan como promo en "Planes y precios" (campo "Promo hasta").';
            const ICONS = { info: 'ℹ️', warn: '⚠️', success: '✅' };
            $('#notifs-list').innerHTML = notifications.length ? notifications.map(n => `
                <article class="notif-item notif-item--${n.type === 'warn' || n.type === 'success' ? n.type : 'info'}" style="${n.active ? '' : 'opacity:.55'}">
                    <div class="notif-item__icon">${n.plan_id ? '🎁' : (ICONS[n.type] || 'ℹ️')}</div>
                    <div class="notif-item__body">
                        <div class="notif-item__msg">${esc(n.message)}</div>
                        <div class="notif-item__meta">Publicado: ${esc(B.dateTime(n.created_at))} · ${n.active ? 'Visible' : 'Oculto'}${n.plan_id
                            ? ` · Botón "Ver promo" → ${esc(n.plan_name || 'plan')}${n.promo_until && n.promo_until < today ? ' (promo vencida: ya no se muestra)' : ''}` : ''}</div>
                    </div>
                    <div class="row-actions">
                        <button class="btn btn--ghost btn--sm" type="button" data-toggle-notif="${n.id}" data-active="${n.active ? 1 : 0}">${n.active ? 'Ocultar' : 'Mostrar'}</button>
                        <button class="btn btn--danger btn--sm" type="button" data-del-notif="${n.id}">${ICON_DEL}</button>
                    </div>
                </article>`).join('') : '<div class="empty">No hay avisos.</div>';
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#notif-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        B.clearFieldErrors(f);
        try {
            await call('POST', '/admin/notifications', { message: $('#n-msg').value, type: $('#n-type').value, plan_id: $('#n-plan').value });
            f.reset(); $('#n-count').textContent = '0';
            B.toast('Aviso publicado.', 'ok'); loadNotifs();
        } catch (err) { B.handleError(err, f); }
    });
    $('#notifs-list').addEventListener('click', async (e) => {
        const t = e.target.closest('[data-toggle-notif]');
        const d = e.target.closest('[data-del-notif]');
        try {
            if (t) { await call('PATCH', `/admin/notifications/${t.dataset.toggleNotif}`, { active: t.dataset.active !== '1' }); loadNotifs(); }
            if (d) confirmDelete('Se borra el aviso.', async () => { await call('DELETE', `/admin/notifications/${d.dataset.delNotif}`); loadNotifs(); });
        } catch (err) { B.toast(err.message, 'error'); }
    });

    /* =========================================================
       CONFIGURACIÓN
       ========================================================= */
    async function loadSettings() {
        try {
            const { settings } = await call('GET', '/admin/settings');
            const f = $('#settings-form');
            Object.entries(settings).forEach(([k, v]) => {
                const el = f.elements.namedItem(k);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v;
            });
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }
    $('#settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        B.clearFieldErrors(f);
        const body = {};
        Array.from(f.elements).forEach(el => {
            if (!el.name) return;
            body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
        });
        try { await call('PUT', '/admin/settings', body); B.toast('Configuración guardada.', 'ok'); }
        catch (err) { B.handleError(err, f); }
    });

    /* =========================================================
       AUDITORÍA
       ========================================================= */
    async function loadAudit() {
        try {
            const { entries } = await call('GET', '/admin/audit');
            $('#audit-body').innerHTML = entries.length ? entries.map(a => `
                <tr class="${/fail|locked|inactive/.test(a.action) ? '' : ''}">
                    <td>${esc(B.dateTime(a.created_at))}</td>
                    <td>${esc(a.email || '—')}</td>
                    <td>${/fail|locked/.test(a.action) ? `<span class="pill pill--error">${esc(a.action)}</span>` : `<code>${esc(a.action)}</code>`}</td>
                    <td>${esc(a.detail || '')}</td>
                    <td><small>${esc(a.ip || '')}</small></td>
                </tr>`).join('') : emptyRow(5, 'Sin registros.');
        } catch (err) { if (err.status !== 401) B.toast(err.message, 'error'); }
    }

    /* =========================================================
       INICIO
       ========================================================= */
    await refreshActivities().catch(() => { });
    loadStats();
    switchTab(location.hash.slice(1) || 'reservas');
});
