document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const esc = B.esc;

    /* Este archivo lo usan todas las páginas públicas (inicio, nosotros, horarios, planes, asistente).
       Cada bloque solo trabaja si su sección está en la página. */

    /* =========================================================
       1. SESIÓN Y MENÚ HAMBURGUESA (el menú lo arma api.js)
       ========================================================= */
    const sessionPromise = B.renderSessionMenu();

    /* =========================================================
       2. SCROLL SUAVE A LAS SECCIONES DE LA MISMA PÁGINA
       ========================================================= */
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.pageYOffset - 70;
        window.scrollTo({ top, behavior: 'smooth' });
    });

    /* =========================================================
       3. ANIMACIONES REVEAL
       ========================================================= */
    let observer = null;
    if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver((entries) => {
            entries.forEach(en => {
                if (en.isIntersecting) { en.target.classList.add('is-visible'); observer.unobserve(en.target); }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    }
    function observeReveals(root = document) {
        $$('.reveal:not(.is-visible)', root).forEach(el => observer ? observer.observe(el) : el.classList.add('is-visible'));
    }
    observeReveals();

    /* =========================================================
       4. BOTÓN VOLVER ARRIBA + AÑO
       ========================================================= */
    const toTop = $('#to-top');
    if (toTop) {
        const t = () => toTop.classList.toggle('show', window.scrollY > 500);
        window.addEventListener('scroll', t, { passive: true }); t();
        toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    /* =========================================================
       5. CONTENIDO DINÁMICO DESDE LA API
       ========================================================= */
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    let shownPlans = [];
    B.api('GET', '/public/site').then(site => {
        renderClasses(site.activities);
        renderTimetable(site.activities);
        renderHours(site.openingHours, site.settings);
        shownPlans = filterPlans(site.plans);
        renderPlans(shownPlans);
        markOpenPlans(shownPlans);
        renderContact(site.settings);
        B.showNotice(site.notifications);
        renderMemberSummary();
        observeReveals();
        // Si se llegó desde el botón "Ver promo" (planes.html#promo), baja hasta el plan en promo.
        if (location.hash === '#promo') setTimeout(() => {
            const target = $('.plan--promo') || $('#plans-grid');
            if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 100, behavior: 'smooth' });
        }, 400);
    }).catch(err => {
        B.toast('No se pudo cargar la información del gimnasio. ' + err.message, 'error');
        $$('.loading').forEach(l => { l.textContent = 'No disponible en este momento.'; });
    });

    B.api('GET', '/public/products').then(({ products }) => {
        const list = products.filter(p => p.available).slice(0, 4);
        const box = $('#products-teaser');
        if (!box) return;
        if (!list.length) { const m = $('#mostrador'); if (m) m.hidden = true; return; }
        box.innerHTML = list.map(productCard).join('');
        observeReveals(box);
    }).catch(() => { const m = $('#mostrador'); if (m) m.hidden = true; });

    /* ---------- Clases ---------- */
    function renderClasses(acts) {
        setText('stat-activities', acts.length);
        const grid = $('#classes-grid');
        if (!grid) return;
        if (!acts.length) { grid.innerHTML = '<p class="empty-mini">Pronto vamos a publicar nuestras clases.</p>'; return; }
        grid.innerHTML = acts.map((a, i) => `
            <article class="class-card reveal" style="--d:${(i % 4) * 0.08}s">
                <span class="class-card__num">${String(i + 1).padStart(2, '0')}</span>
                <div class="class-card__icon">${B.icon(a.icon)}</div>
                <h3>${esc(a.name)}</h3>
                <p>${esc(a.description)}</p>
            </article>`).join('');
    }

    /* ---------- Grilla de horarios ---------- */
    function renderTimetable(acts) {
        if (!$('#tt-body')) return;
        const slots = acts.flatMap(a => a.slots.map(s => ({ ...s, act: a })));
        const hasSunday = slots.some(s => s.weekday === 0);
        const days = hasSunday ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5, 6];
        $('#tt-head').innerHTML = '<th class="timetable__corner">Hora</th>' + days.map(d => `<th>${B.DAYS[d]}</th>`).join('');
        $('#tt-legend').innerHTML = acts.map(a =>
            `<span><i class="dot" style="background:${B.safeColor(a.color)}"></i> ${esc(a.name)}</span>`).join('');

        const times = [...new Set(slots.map(s => s.start_time))].sort();
        if (!times.length) {
            $('#tt-body').innerHTML = `<tr><td class="is-off" colspan="${days.length + 1}">Sin horarios cargados.</td></tr>`;
            return;
        }
        $('#tt-body').innerHTML = times.map(t => {
            const cells = days.map(d => {
                const here = slots.filter(s => s.weekday === d && s.start_time === t);
                if (!here.length) return '<td class="is-off">—</td>';
                return '<td>' + here.map(s => {
                    const c = B.safeColor(s.act.color);
                    return `<span class="chip chip--dyn" style="background:${c}1f;color:${c};border-color:${c}66" title="${esc(s.act.name)} ${esc(s.start_time)} a ${esc(s.end_time)}">${esc(s.act.short_name)}</span>`;
                }).join('') + '</td>';
            }).join('');
            const end = slots.find(s => s.start_time === t).end_time;
            return `<tr><th>${esc(t)} <small>a ${esc(end)}</small></th>${cells}</tr>`;
        }).join('');
    }

    /* ---------- Horario de apertura ---------- */
    function hoursSummary(hours) {
        const order = [1, 2, 3, 4, 5, 6, 0];
        const byDay = Object.fromEntries(hours.map(h => [h.weekday, h]));
        const label = (h) => (h && h.is_open) ? `${h.open_time} a ${h.close_time} HS` : 'Cerrado';
        const groups = [];
        order.forEach(d => {
            const l = label(byDay[d]);
            const g = groups[groups.length - 1];
            if (g && g.label === l) g.days.push(d); else groups.push({ label: l, days: [d] });
        });
        return groups.map(g => ({
            days: g.days.length > 2 ? `${B.DAYS[g.days[0]]} a ${B.DAYS[g.days[g.days.length - 1]].toLowerCase()}`
                : g.days.map((d, i) => i ? B.DAYS[d].toLowerCase() : B.DAYS[d]).join(' y '),
            label: g.label,
        }));
    }
    function renderHours(hours, settings) {
        const sum = hoursSummary(hours);
        if ($('#schedule-note')) $('#schedule-note').innerHTML = settings.schedule_note ? `<strong>Importante:</strong> ${esc(settings.schedule_note)}` : '';
        setText('opening-summary', 'Horario del box: ' + sum.map(g => `${g.days} ${g.label === 'Cerrado' ? 'cerrado' : g.label}`).join(' · ') + '.');
        if ($('#f-hours')) $('#f-hours').innerHTML = sum.map(g => `<li><span>${esc(g.days)}</span><span>${esc(g.label)}</span></li>`).join('');
    }

    /* ---------- Planes ---------- */
    function planPeriod(p) {
        if (p.duration_days === 30 || p.duration_days === 31) return '/ mes';
        if (p.duration_days === 1) return '/ día';
        return `/ ${p.duration_days} días`;
    }
    /** En el inicio se ven solo las mensualidades (data-only="membresia"); en planes.html, todos. */
    function filterPlans(plans) {
        const grid = $('#plans-grid');
        if (grid && grid.dataset.only === 'membresia') return plans.filter(p => p.kind === 'membresia');
        // En planes.html las promos van primero, para que se vean apenas se entra.
        return [...plans.filter(p => p.promo_until), ...plans.filter(p => !p.promo_until)];
    }
    function renderPlans(plans, open = new Map()) {
        const grid = $('#plans-grid');
        if (!grid) return;
        if (!plans.length) { $('#planes').hidden = true; return; }
        grid.innerHTML = plans.map((p, i) => `
            <article class="plan reveal ${p.featured ? 'plan--featured' : ''} ${p.promo_until ? 'plan--promo' : ''}" style="--d:${(i % 4) * 0.06}s">
                ${p.featured ? '<span class="plan__badge">Más elegido</span>' : ''}
                ${p.promo_until ? `<span class="plan__promo">🎁 Promo hasta el ${esc(B.dateLabel(p.promo_until))}</span>` : ''}
                <span class="plan__kind">${p.kind === 'membresia' ? 'Mensualidad' : 'Actividad · ' + esc(p.activity_name)}</span>
                <h3>${esc(p.name)}</h3>
                <div class="plan__price">${B.money(p.price)}<small>${planPeriod(p)}</small></div>
                <p class="plan__desc">${esc(p.description)}</p>
                <div class="plan__tags">
                    ${p.weekly_limit ? `<span class="pill pill--primary">${p.weekly_limit} clase${p.weekly_limit > 1 ? 's' : ''} por semana</span>` : '<span class="pill pill--primary">Sin límite semanal</span>'}
                    ${p.kind === 'membresia' ? '<span class="pill pill--muted">Todas las actividades</span>' : ''}
                </div>
                ${B.planAction(p, open.get(p.id))}
            </article>`).join('');
    }
    /** Si es un socio con un pago sin terminar, la tarjeta de ese plan muestra "Continuar pago". */
    async function markOpenPlans(plans) {
        const s = await sessionPromise;
        if (!s || !s.user || s.user.role !== 'user' || !$('#plans-grid')) return;
        try {
            const ov = await B.api('GET', '/account/overview');
            if (ov.openPlans.length) { renderPlans(plans, B.openPlansMap(ov.openPlans)); $$('#plans-grid .reveal').forEach(el => el.classList.add('is-visible')); }
        } catch { /* si falla, quedan los botones normales */ }
    }
    $('#plans-grid')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-plan]');
        if (!btn) return;
        const s = await sessionPromise;
        if (!s || !s.user) {
            location.href = 'login.html?next=' + encodeURIComponent('/page/cuenta.html#planes') + '#registro';
            return;
        }
        if (s.user.role === 'admin' || s.user.role === 'profe') { B.toast('Los planes se contratan desde una cuenta de socio.', 'error'); return; }
        btn.disabled = true;
        try {
            const r = await B.api('POST', `/account/plans/${btn.dataset.plan}/purchase`);
            location.href = 'pago.html?id=' + r.payment.id;
        } catch (err) { B.toast(err.message, 'error'); btn.disabled = false; }
    });

    /* ---------- Productos ---------- */
    function productCard(p) {
        return `
            <article class="product reveal">
                <div class="product__img">${p.image
                    ? `<img src="/uploads/products/${encodeURIComponent(p.image)}" alt="${esc(p.name)}" loading="lazy">`
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>'}</div>
                <div class="product__body">
                    <span class="product__cat">${esc(p.category)}</span>
                    <h3 class="product__name">${esc(p.name)}</h3>
                    <div class="product__foot">
                        <span class="product__price">${B.money(p.price)}</span>
                        ${p.available ? '<span class="pill pill--ok">Disponible</span>' : '<span class="pill pill--muted">Sin stock</span>'}
                    </div>
                </div>
            </article>`;
    }

    /* ---------- Contacto ---------- */
    function renderContact(s) {
        const wa = /^\d{8,15}$/.test(s.whatsapp) ? `https://wa.me/${s.whatsapp}` : null;
        const ig = /^[A-Za-z0-9._]{1,30}$/.test(s.instagram) ? s.instagram : null;
        setText('c-address', s.address);
        setText('f-address', s.address);
        setText('c-phone', s.phone);
        setText('f-phone', s.phone);
        if ($('#f-phone')) $('#f-phone').href = 'tel:' + String(s.phone).replace(/[^\d+]/g, '');
        if (wa) [$('#c-wa'), $('#c-wa2')].forEach(a => { if (a) a.href = wa; });
        if (ig) {
            [$('#c-ig'), $('#f-ig')].forEach(a => { if (a) { a.href = 'https://instagram.com/' + ig; a.textContent = '@' + ig; } });
        }
        if (!$('#c-fb')) return;
        if (/^https:\/\/(www\.)?facebook\.com(\/|$)/.test(s.facebook_url)) $('#c-fb').href = s.facebook_url;
        else $('#c-fb-wrap').hidden = true;
    }

    /* ---------- Resumen del socio en el inicio ----------
       Si entra un socio, arriba de las clases ve su plan, su próxima clase y si tiene un pago
       pendiente, con el botón para seguir. Así no tiene que buscar nada. */
    async function renderMemberSummary() {
        const box = $('#member-summary');
        if (!box) return;
        const s = await sessionPromise;
        if (!s || !s.user || s.user.role !== 'user') return;
        try {
            const [ov, mine] = await Promise.all([B.api('GET', '/account/overview'), B.api('GET', '/reservations/mine')]);
            const today = mine.today;
            const plan = ov.subscriptions.find(x => x.status === 'activa' && x.end_date >= today);
            const next = mine.reservations.filter(r => r.status === 'activa' && r.date >= today)
                .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];
            const open = ov.openPlans[0];
            const card = (title, value, href, cta, warn) => `
                <a class="member-card${warn ? ' member-card--warn' : ''}" href="${href}">
                    <span class="member-card__title">${title}</span>
                    <strong class="member-card__value">${value}</strong>
                    <span class="member-card__cta">${cta} →</span>
                </a>`;
            $('#member-summary-body').innerHTML = `
                <p class="member-strip__hello">Hola, <strong>${esc(s.user.name)}</strong></p>
                <div class="member-strip__cards">
                    ${plan ? card('Tu plan', `${esc(plan.plan_name)} · hasta el ${esc(B.dateLabel(plan.end_date))}`, 'cuenta.html', 'Ver mi plan')
                           : card('Tu plan', 'No tenés un plan activo', 'cuenta.html#planes', 'Contratar un plan', true)}
                    ${next ? card('Tu próxima clase', `${esc(next.activity_name)} · ${esc(B.dateLong(next.date))} ${esc(next.start_time)} HS`, 'reserva.html#mis-reservas', 'Mis reservas')
                           : card('Tu próxima clase', 'No tenés clases reservadas', 'reserva.html', 'Reservar ahora', !!plan)}
                    ${open ? card('Pago', open.status === 'pendiente' ? 'Tenés un pago sin terminar' : 'Tu pago está en revisión', 'pago.html?id=' + Number(open.payment_id), open.status === 'pendiente' ? 'Continuar pago' : 'Ver mi pago', open.status === 'pendiente') : ''}
                </div>`;
            box.hidden = false;
            document.body.classList.add('has-member');
        } catch { /* si falla, el inicio se ve igual que para un visitante */ }
    }

});
