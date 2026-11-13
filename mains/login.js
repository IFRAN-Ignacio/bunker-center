document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

    // Solo se permite volver a páginas internas del propio sitio (evita "open redirect").
    function safeNext() {
        const n = new URLSearchParams(location.search).get('next') || '';
        return /^\/page\/[a-z0-9-]+\.html([?#][\w=&%#.-]*)?$/i.test(n) ? n : null;
    }
    const goAfterLogin = (user) => {
        if (user.role === 'admin') return location.replace('admin.html');
        if (user.role === 'profe') return location.replace('profe.html');
        location.replace(safeNext() || 'index.html');
    };

    /* ---------- Tabs login / registro / código admin ---------- */
    function switchTab(name) {
        $$('.auth__tab').forEach(t => {
            const active = t.dataset.tab === name;
            t.classList.toggle('is-active', active);
            t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        $$('.auth__form').forEach(f => f.classList.toggle('is-active', f.dataset.form === name));
        $('#auth-tabs-wrap').style.display = name === 'admin-code' ? 'none' : 'block';
        $$('.auth__form').forEach(f => B.clearFieldErrors(f));
        if (name === 'admin-code') setTimeout(() => $('#admin-code').focus(), 150);
    }
    $$('.auth__tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $$('[data-switch]').forEach(btn => btn.addEventListener('click', async () => {
        // Volver desde el código admin = cerrar esa sesión a medio verificar.
        if (btn.closest('#form-admin-code')) { try { await B.api('POST', '/auth/logout'); } catch (e) { } }
        switchTab(btn.dataset.switch);
    }));
    if (location.hash === '#registro') switchTab('register');

    /* ---------- Mostrar / ocultar contraseña ---------- */
    $$('.toggle-pass').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        btn.classList.toggle('is-visible', !visible);
        btn.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    }));

    $$('input[type="password"]').forEach(i => i.addEventListener('input', () => {
        if (/\s/.test(i.value)) i.value = i.value.replace(/\s+/g, '');
    }));
    $('#admin-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9); });
    $$('.field input').forEach(i => i.addEventListener('input', () => {
        const f = i.closest('.field'); f.classList.remove('has-error');
        const er = f.querySelector('.field__error'); if (er) er.textContent = '';
    }));

    /* ---------- Validación rápida en el navegador (la real la hace el servidor) ---------- */
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function busy(form, on) {
        const b = form.querySelector('button[type="submit"]');
        b.disabled = on;
        if (on) { b.dataset.label = b.textContent; b.textContent = 'Procesando…'; }
        else if (b.dataset.label) b.textContent = b.dataset.label;
    }

    /* ---------- LOGIN ---------- */
    const loginForm = $('#form-login');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        B.clearFieldErrors(loginForm);
        const email = $('#login-email').value.trim().toLowerCase();
        const password = $('#login-password').value;
        if (!emailRe.test(email)) return B.showFieldError(loginForm, 'email', 'Ingresá un correo válido.');
        if (!password) return B.showFieldError(loginForm, 'password', 'Ingresá tu contraseña.');

        busy(loginForm, true);
        try {
            const r = await B.api('POST', '/auth/login', { email, password });
            $('#login-password').value = '';
            if (r.needsAdminCode) { switchTab('admin-code'); return; }
            B.toast('¡Bienvenido de nuevo, ' + r.user.name + '!', 'ok');
            setTimeout(() => goAfterLogin(r.user), 500);
        } catch (err) {
            B.showFieldError(loginForm, 'password', err.message);
        } finally { busy(loginForm, false); }
    });

    /* ---------- CÓDIGO DE ADMINISTRADOR ---------- */
    const adminForm = $('#form-admin-code');
    adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        B.clearFieldErrors(adminForm);
        const code = $('#admin-code').value.trim();
        if (!/^\d{9}$/.test(code)) return B.showFieldError(adminForm, 'code', 'El código tiene 9 dígitos.');
        busy(adminForm, true);
        try {
            await B.api('POST', '/auth/admin-code', { code });
            B.toast('Acceso concedido. Entrando al panel…', 'ok');
            setTimeout(() => location.replace('admin.html'), 500);
        } catch (err) {
            $('#admin-code').value = '';
            if (err.data.restart) { B.toast(err.message, 'error'); switchTab('login'); }
            else B.showFieldError(adminForm, 'code', err.message);
        } finally { busy(adminForm, false); }
    });

    /* ---------- REGISTRO ---------- */
    const regForm = $('#form-register');
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        B.clearFieldErrors(regForm);
        const data = {
            name: $('#reg-name').value.trim(),
            lastname: $('#reg-lastname').value.trim(),
            email: $('#reg-email').value.trim().toLowerCase(),
            password: $('#reg-password').value,
        };
        let ok = true;
        if (data.name.length < 2) { B.showFieldError(regForm, 'name', 'Ingresá tu nombre.'); ok = false; }
        if (data.lastname.length < 2) { B.showFieldError(regForm, 'lastname', 'Ingresá tu apellido.'); ok = false; }
        if (!emailRe.test(data.email)) { B.showFieldError(regForm, 'email', 'Correo inválido.'); ok = false; }
        if (data.password.length < 8 || !/[A-Za-z]/.test(data.password) || !/\d/.test(data.password)) {
            { B.showFieldError(regForm, 'password', 'Mínimo 8 caracteres, con letras y números.'); ok = false; }
        }
        if (!ok) return;

        busy(regForm, true);
        try {
            const r = await B.api('POST', '/auth/register', data);
            B.toast('¡Cuenta creada! Bienvenido, ' + r.user.name + '.', 'ok');
            setTimeout(() => location.replace(safeNext() || 'cuenta.html'), 700);
        } catch (err) {
            B.handleError(err, regForm);
        } finally { busy(regForm, false); }
    });

    const y = $('#auth-year');
    if (y) y.textContent = new Date().getFullYear();

    /* ---------- Si ya hay sesión, no tiene sentido estar acá ----------
       (se consulta DESPUÉS de conectar los formularios, para que nunca se envíen sin JavaScript) */
    B.me().then(session => {
        if (!session.user) return;
        if (session.user.role === 'admin' && !session.adminVerified) switchTab('admin-code');
        else goAfterLogin(session.user);
    });
});
