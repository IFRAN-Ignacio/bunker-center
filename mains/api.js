/* =========================================================
   BUNKER — utilidades compartidas del front
   - Cliente de la API (cookies de sesión + token CSRF)
   - Escape de HTML para evitar XSS al mostrar datos
   - Toast, tema, formato de fechas y precios, menú de sesión
   ========================================================= */
(function () {
    'use strict';

    let csrfToken = null;
    let mePromise = null;

    // El token CSRF lo entrega el servidor en /api/auth/me (y se renueva al iniciar o cerrar sesión).
    const currentCsrf = () => csrfToken;

    class ApiError extends Error {
        constructor(status, data) {
            super((data && data.error) || 'Error de conexión.');
            this.status = status;
            this.data = data || {};
        }
    }

    async function api(method, url, body, retried = false) {
        const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
        if (method !== 'GET') {
            if (!currentCsrf()) await me(true);
            opts.headers['X-CSRF-Token'] = currentCsrf() || '';
            if (body instanceof FormData) opts.body = body;
            else if (body !== undefined) {
                opts.headers['Content-Type'] = 'application/json';
                opts.body = JSON.stringify(body);
            }
        }
        let res;
        try { res = await fetch('/api' + url, opts); }
        catch (e) { throw new ApiError(0, { error: 'No se pudo conectar con el servidor.' }); }
        const headerToken = res.headers.get('X-CSRF-Token');
        if (headerToken) csrfToken = headerToken;
        let data = null;
        try { data = await res.json(); } catch (e) { }
        if (data && data.csrfToken && !headerToken) csrfToken = data.csrfToken;
        if (!res.ok) {
            // Si el token CSRF quedó viejo (por ej. se inició sesión en otra pestaña), se pide uno nuevo y se reintenta una vez.
            if (res.status === 403 && method !== 'GET' && !retried && data && /Token de seguridad/.test(data.error || '')) {
                csrfToken = null;
                return api(method, url, body, true);
            }
            throw new ApiError(res.status, data);
        }
        return data;
    }

    /** Sesión actual (se pide una sola vez por página). */
    function me(force) {
        if (!mePromise || force) {
            mePromise = api('GET', '/auth/me').catch(() => ({ user: null })); // el token CSRF lo toma api() de la cabecera
        }
        return mePromise;
    }

    /** Si no hay sesión, manda al login y vuelve a esta página después. */
    async function requireLogin() {
        const r = await me();
        if (!r.user) {
            const next = location.pathname + location.search + location.hash;
            location.replace('login.html?next=' + encodeURIComponent(next));
            return new Promise(() => { });
        }
        return r;
    }

    /* ---------- Seguridad: escapar todo texto antes de meterlo en innerHTML ---------- */
    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

    /* ---------- Formatos ---------- */
    const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
    const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const weekday = (s) => parseDate(s).getDay();
    const dateLabel = (s) => { const d = parseDate(s); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
    const dateLong = (s) => `${DAYS[weekday(s)]} ${dateLabel(s)}`;
    const dateShort = (s) => s.split('-').reverse().join('/');
    const dateTime = (ms) => new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const todayStr = () => toDateStr(new Date());

    const PAY_STATUS = {
        pendiente: ['Pendiente de pago', 'warn'],
        en_revision: ['En revisión', 'info'],
        aprobado: ['Aprobado', 'ok'],
        rechazado: ['Rechazado', 'error'],
        cancelado: ['Cancelado', 'muted'],
    };
    const PAY_METHOD = { tarjeta: 'Tarjeta (histórico)', transferencia: 'Transferencia', efectivo: 'Efectivo' };
    const statusPill = (st) => {
        const [label, cls] = PAY_STATUS[st] || [st, 'muted'];
        return `<span class="pill pill--${cls}">${esc(label)}</span>`;
    };

    /* ---------- Íconos de actividades (SVG fijos, no vienen del usuario) ---------- */
    const ICONS = {
        pesa: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"></path>',
        pulso: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
        rayo: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"></path>',
        reloj: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
        corazon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"></path>',
        fuego: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>',
        persona: '<circle cx="12" cy="5" r="2"></circle><path d="M10 22v-6l-2-1 1-6h6l1 6-2 1v6"></path>',
        bici: '<circle cx="5.5" cy="17.5" r="3.5"></circle><circle cx="18.5" cy="17.5" r="3.5"></circle><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"></path>',
    };
    const icon = (name, cls = '') =>
        `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.pesa}</svg>`;
    const safeColor = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#9d4edd';

    /* ---------- Toast ---------- */
    let toastTimer;
    function toast(message, type = '') {
        let el = document.getElementById('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast'; el.className = 'toast';
            el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.className = 'toast show' + (type ? ' toast--' + type : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = 'toast'; }, 3600);
    }

    /* ---------- Confirmación (modal propio, sin window.confirm) ---------- */
    function confirmDialog(message, { okText = 'Confirmar', danger = false } = {}) {
        return new Promise(resolve => {
            const wrap = document.createElement('div');
            wrap.className = 'modal';
            wrap.innerHTML = `
                <div class="modal__backdrop" data-x></div>
                <div class="modal__card" role="dialog" aria-modal="true">
                    <h3>¿Seguro?</h3>
                    <p>${esc(message)}</p>
                    <div class="modal__actions">
                        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok type="button">${esc(okText)}</button>
                        <button class="btn btn--ghost" data-x type="button">Cancelar</button>
                    </div>
                </div>`;
            const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
            const onKey = (e) => { if (e.key === 'Escape') done(false); };
            wrap.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => done(false)));
            wrap.querySelector('[data-ok]').addEventListener('click', () => done(true));
            document.addEventListener('keydown', onKey);
            document.body.appendChild(wrap);
            wrap.querySelector('[data-ok]').focus();
        });
    }

    /* ---------- Tema día/noche ---------- */
    function bindThemeToggle() {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) { }
        });
    }

    async function logout() {
        try { await api('POST', '/auth/logout'); } catch (e) { }
        location.replace('index.html');
    }

    /* ---------- Menú hamburguesa (reemplaza a la barra de arriba) ----------
       Un botón flotante con el logo abre un panel lateral con todas las páginas, los accesos
       de cada rol, el tema y la sesión. Lo arma esta función en todas las páginas; el
       parámetro `container` se mantiene por compatibilidad y ya no se usa. */
    const ICO = {
        home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
        tag: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
        bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
        chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
        cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
        card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
        panel: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
        out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
        moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    };
    const ico = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
    const GYM_LINKS = [
        ['index.html', 'Inicio', 'home'], ['nosotros.html', 'Nosotros', 'users'], ['horarios.html', 'Horarios', 'clock'],
        ['planes.html', 'Planes y precios', 'tag'], ['productos.html', 'Mostrador', 'bag'], ['asistente.html', 'Asistente', 'chat'],
        ['index.html#contacto', 'Ubicación y contacto', 'pin'],
    ];
    function roleLinks(u) {
        if (u.role === 'admin') return [['admin.html', 'Panel de administración', 'panel']];
        if (u.role === 'profe') return [['profe.html', 'Próximos 7 días', 'list'], ['profe.html#calendario', 'Mi calendario', 'cal'], ['profe.html#horarios', 'Mis horarios', 'clock'], ['profe.html#perfil', 'Mi cuenta', 'user']];
        return [['reserva.html', 'Reservar clase', 'cal'], ['reserva.html#mis-reservas', 'Mis reservas', 'list'],
            ['cuenta.html', 'Mi plan', 'tag'], ['cuenta.html#calendario', 'Mi calendario', 'cal'],
            ['cuenta.html#pagos', 'Mis pagos', 'card'], ['cuenta.html#perfil', 'Mi perfil', 'user']];
    }
    function menuLink([href, label, icon]) {
        const here = location.pathname.split('/').pop() || 'index.html';
        const [file, hash] = href.split('#');
        const active = file === here && (hash ? location.hash === '#' + hash : !location.hash || here !== 'index.html');
        return `<a class="drawer__link${active ? ' is-active' : ''}" href="${href}">${ico(icon)}<span>${esc(label)}</span></a>`;
    }
    /* ---------- Aviso del admin (banner de arriba) ----------
       Lo usan todas las páginas: las públicas le pasan los avisos que ya trajeron, y las internas
       (Mi cuenta, Reservar, Pago, Mostrador, Profe) los piden al armar el menú. Si la página no tiene
       el banner en su HTML, se crea acá. PROMO: si el aviso apunta a un plan, va primero, lleva 🎁 y
       el botón "Ver promo" (siempre a planes.html#promo: el admin no escribe links). */
    function showNotice(list) {
        const KEY = 'bunker_dismissed_notifs';
        let dismissed = [];
        try { dismissed = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { }
        // Se recuerda por id + fecha: si se reinicia la base y un aviso nuevo reusa el id, igual se muestra.
        const keyOf = (x) => `${x.id}-${x.created_at}`;
        const onPlans = document.getElementById('plans-grid')?.dataset.only === 'todos';
        const ordered = onPlans ? list.filter(x => !x.plan_id) : [...list.filter(x => x.plan_id), ...list.filter(x => !x.plan_id)];
        const n = ordered.find(x => !dismissed.includes(keyOf(x)));
        if (!n) return;
        let banner = document.getElementById('notif-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'notif-banner';
            banner.className = 'notif-banner';
            banner.hidden = true;
            banner.innerHTML = `<div class="notif-banner__inner"><span class="notif-banner__icon" id="notif-banner-icon"></span>
                <span class="notif-banner__text" id="notif-banner-text"></span>
                <button class="notif-banner__close" id="notif-banner-close" type="button" aria-label="Cerrar notificación"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg></button></div>`;
            document.body.prepend(banner);
        }
        const ICONS = { info: 'ℹ️', warn: '⚠️', success: '✅' };
        banner.querySelector('#notif-banner-icon').textContent = n.plan_id ? '🎁' : (ICONS[n.type] || 'ℹ️');
        banner.querySelector('#notif-banner-text').textContent = n.message;
        banner.classList.add('notif-banner--' + (n.plan_id ? 'promo' : ICONS[n.type] ? n.type : 'info'));
        if (n.plan_id && !banner.querySelector('.notif-banner__cta')) {
            const cta = document.createElement('a');
            cta.className = 'btn btn--primary btn--sm notif-banner__cta';
            cta.href = 'planes.html#promo';
            cta.textContent = 'Ver promo';
            banner.querySelector('#notif-banner-close').before(cta);
        }
        banner.hidden = false;
        requestAnimationFrame(() => banner.classList.add('is-visible'));
        banner.querySelector('#notif-banner-close').addEventListener('click', () => {
            dismissed.push(keyOf(n));
            try { localStorage.setItem(KEY, JSON.stringify(dismissed.slice(-50))); } catch (e) { }
            banner.classList.remove('is-visible');
            setTimeout(() => { banner.hidden = true; }, 350);
        });
    }

    async function renderSessionMenu() {
        const r = await me();
        const u = r.user;
        document.querySelector('.menu-fab')?.remove();
        document.querySelector('.drawer')?.remove();
        document.querySelector('.drawer-backdrop')?.remove();
        document.querySelector('.top-actions')?.remove();

        // Arriba a la derecha, siempre a mano: tema claro/oscuro e Ingresar (o tu perfil si ya entraste).
        const profileHref = u ? (u.role === 'admin' ? 'admin.html' : u.role === 'profe' ? 'profe.html#perfil' : 'cuenta.html#perfil') : '';
        const top = document.createElement('div');
        top.className = 'top-actions';
        top.innerHTML = `
            <button type="button" class="top-actions__theme" aria-label="Cambiar tema claro u oscuro" title="Modo día / noche">
                <svg class="icon--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                <svg class="icon--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO.moon}</svg>
            </button>
            ${u ? `<a class="top-actions__profile" href="${profileHref}" title="Ver mi perfil">
                       <span class="top-actions__avatar">${esc(((u.name[0] || '') + (u.lastname[0] || '')).toUpperCase())}</span>
                       <span class="top-actions__name">${esc(u.name)}</span>
                   </a>`
                : `<a class="btn btn--primary btn--sm top-actions__login" href="login.html"><span class="top-actions__long">Iniciar sesión</span><span class="top-actions__short">Ingresar</span></a>`}`;

        const fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'menu-fab';
        fab.setAttribute('aria-label', 'Abrir menú');
        fab.setAttribute('aria-expanded', 'false');
        fab.innerHTML = `<span class="menu-fab__logo">BUNKER<span>.</span></span><span class="menu-fab__bars" aria-hidden="true"><i></i><i></i><i></i></span>`
            + (u ? `<span class="menu-fab__avatar" aria-hidden="true">${esc(((u.name[0] || '') + (u.lastname[0] || '')).toUpperCase())}</span>` : '');

        const backdrop = document.createElement('div');
        backdrop.className = 'drawer-backdrop';
        const drawer = document.createElement('nav');
        drawer.className = 'drawer';
        drawer.setAttribute('aria-label', 'Menú principal');
        const isMember = u && u.role === 'user';
        drawer.innerHTML = `
            <div class="drawer__top">
                <a href="index.html" class="drawer__logo">BUNKER<span>.</span></a>
                <button type="button" class="drawer__close" aria-label="Cerrar menú"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            ${u ? `<div class="drawer__user"><span class="drawer__avatar">${esc(((u.name[0] || '') + (u.lastname[0] || '')).toUpperCase())}</span>
                    <div><strong>${esc(u.name + ' ' + u.lastname)}</strong><small>${esc(u.role === 'admin' ? 'Administración' : u.role === 'profe' ? 'Profe' : 'Socio')}</small></div></div>`
                : `<div class="drawer__guest"><a href="login.html" class="btn btn--primary btn--block">Ingresar</a><a href="login.html#registro" class="btn btn--ghost btn--block">Crear cuenta</a></div>`}
            ${!u || isMember ? `<a href="reserva.html" class="btn btn--primary btn--block drawer__cta">${ico('cal')} Reservar clase</a>` : ''}
            ${u ? `<p class="drawer__title">${isMember ? 'Mi cuenta' : u.role === 'profe' ? 'Mis clases' : 'Administración'}</p>
                   <div class="drawer__group">${roleLinks(u).filter(l => !(isMember && l[0] === 'reserva.html')).map(menuLink).join('')}</div>` : ''}
            <p class="drawer__title">El gimnasio</p>
            <div class="drawer__group">${GYM_LINKS.map(menuLink).join('')}</div>
            <div class="drawer__bottom">
                <button type="button" class="drawer__link" id="drawer-theme">${ico('moon')}<span>Modo día / noche</span></button>
                ${u ? `<button type="button" class="drawer__link drawer__logout">${ico('out')}<span>Cerrar sesión</span></button>
                       <a class="drawer__manual" href="manual.html">${ico('book')}<span>Manual de uso</span></a>` : ''}
            </div>`;

        document.body.append(fab, top, backdrop, drawer);
        const open = (v) => {
            drawer.classList.toggle('is-open', v);
            backdrop.classList.toggle('is-open', v);
            document.body.classList.toggle('drawer-lock', v);
            fab.setAttribute('aria-expanded', v ? 'true' : 'false');
            if (v) drawer.querySelector('.drawer__close').focus();
        };
        fab.addEventListener('click', () => open(true));
        backdrop.addEventListener('click', () => open(false));
        drawer.querySelector('.drawer__close').addEventListener('click', () => open(false));
        drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => open(false)));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('is-open')) { open(false); fab.focus(); } });
        const toggleTheme = () => {
            const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) { }
        };
        drawer.querySelector('#drawer-theme').addEventListener('click', toggleTheme);
        top.querySelector('.top-actions__theme').addEventListener('click', toggleTheme);
        drawer.querySelector('.drawer__logout')?.addEventListener('click', logout);
        // Páginas internas: también muestran el aviso del admin (las públicas lo hacen con los datos que ya traen).
        if (!document.body.classList.contains('public') && !document.body.dataset.noticeShown) {
            document.body.dataset.noticeShown = '1';
            api('GET', '/public/site').then(site => showNotice(site.notifications || [])).catch(() => { });
        }
        return r;
    }

    /* ---------- Errores de formulario ---------- */
    function showFieldError(form, field, message) {
        const input = form.querySelector(`[name="${field}"]`);
        const wrap = input && input.closest('.field');
        if (!wrap) return false;
        wrap.classList.add('has-error');
        let err = wrap.querySelector('.field__error');
        if (!err) { err = document.createElement('span'); err.className = 'field__error'; wrap.appendChild(err); }
        err.textContent = message;
        input.focus();
        return true;
    }
    function clearFieldErrors(form) {
        form.querySelectorAll('.field.has-error').forEach(f => f.classList.remove('has-error'));
        form.querySelectorAll('.field__error').forEach(e => e.textContent = '');
    }
    /** Muestra el error de la API en el campo correspondiente o como toast. */
    function handleError(err, form) {
        if (form && err.data && err.data.field && showFieldError(form, err.data.field, err.message)) return;
        toast(err.message, 'error');
    }

    /* ---------- Botón de un plan (inicio y Mi cuenta) ----------
       Si el socio ya empezó a pagar ese plan, en vez de "Contratar" se ve el estado y el atajo al pago. */
    function planAction(p, open) {
        if (open && open.status === 'pendiente') {
            return `<span class="plan__state">Pago sin terminar</span>
                <a class="btn btn--primary btn--block" href="pago.html?id=${Number(open.payment_id)}">Continuar pago</a>`;
        }
        if (open && open.status === 'en_revision') {
            return `<span class="plan__state plan__state--review">Pago en revisión: el gimnasio lo está confirmando</span>
                <a class="btn btn--ghost btn--block" href="pago.html?id=${Number(open.payment_id)}">Ver mi pago</a>`;
        }
        return `<button class="btn ${p.featured || p.promo_until ? 'btn--primary' : 'btn--ghost'} btn--block" type="button" data-plan="${Number(p.id)}">Contratar</button>`;
    }
    const openPlansMap = (list) => new Map((list || []).map(o => [o.plan_id, o]));

    // Si el navegador muestra la página desde su memoria al tocar "Atrás", los botones quedarían
    // como estaban (por ejemplo, desactivados). Se recarga para mostrar el estado real.
    window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

    window.Bunker = {
        api, me, requireLogin, ApiError, esc, money, parseDate, toDateStr, weekday, dateLabel, dateLong, dateShort, dateTime,
        todayStr, DAYS, DAYS_SHORT, MONTHS, PAY_STATUS, PAY_METHOD, statusPill, icon, safeColor, toast, confirmDialog,
        bindThemeToggle, renderSessionMenu, showNotice, logout, showFieldError, clearFieldErrors, handleError, planAction, openPlansMap,
    };

    document.addEventListener('DOMContentLoaded', bindThemeToggle);
})();
