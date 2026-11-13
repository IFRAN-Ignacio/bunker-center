/* =========================================================
   ASISTENTE VIRTUAL (reemplaza al FAQ)
   - Se monta en cualquier elemento con [data-assistant] y además agrega un botón flotante.
   - SEGURIDAD: las respuestas se pintan SIEMPRE con textContent (nunca innerHTML),
     así que aunque la IA devolviera código HTML o <script>, se ve como texto y no se ejecuta.
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const B = window.Bunker;
    const SUGGESTIONS = ['¿Qué tengo que llevar?', '¿Cuánto sale el pase libre?', '¿Qué horarios hay los sábados?', '¿Cómo pago por transferencia?', '¿Qué venden en el mostrador?'];
    const MAX = 500;
    const history = []; // { role: 'user' | 'assistant', content }

    const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
    const ICON_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/></svg>';
    const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

    const boxes = [];

    /** Pinta texto plano con viñetas y links seguros, sin usar innerHTML con datos. */
    function renderText(el, text) {
        el.textContent = '';
        const lines = String(text).split('\n');
        let list = null;
        for (const raw of lines) {
            const line = raw.trimEnd();
            const bullet = /^\s*[-•*]\s+/.test(line);
            if (bullet) {
                if (!list) { list = document.createElement('ul'); el.appendChild(list); }
                const li = document.createElement('li');
                appendInline(li, line.replace(/^\s*[-•*]\s+/, ''));
                list.appendChild(li);
            } else {
                list = null;
                if (!line.trim()) continue;
                const p = document.createElement('p');
                appendInline(p, line);
                el.appendChild(p);
            }
        }
    }
    // **negrita** y links http(s) → nodos creados a mano (textContent), nunca HTML.
    function appendInline(parent, text) {
        const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
        let last = 0, m;
        while ((m = re.exec(text))) {
            if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
            const tok = m[0];
            if (tok.startsWith('**')) {
                const b = document.createElement('strong');
                b.textContent = tok.slice(2, -2);
                parent.appendChild(b);
            } else {
                const a = document.createElement('a');
                a.href = tok; a.textContent = tok.replace(/^https?:\/\//, '');
                a.target = '_blank'; a.rel = 'noopener noreferrer';
                parent.appendChild(a);
            }
            last = m.index + tok.length;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    }

    function mount(root, { floating = false } = {}) {
        root.classList.add('assistant');
        root.innerHTML = `
            <div class="assistant__head">
                <span class="assistant__avatar">${ICON_BOT}</span>
                <div><strong>Asistente Bunker</strong><small class="assistant__mode">Conectando…</small></div>
                ${floating ? `<button class="assistant__close" type="button" aria-label="Cerrar asistente">${ICON_X}</button>` : ''}
            </div>
            <div class="assistant__log" role="log" aria-live="polite"></div>
            <div class="assistant__chips"></div>
            <form class="assistant__form" novalidate>
                <label class="sr-only" for="">Tu consulta</label>
                <input type="text" maxlength="${MAX}" placeholder="Escribí tu duda…" autocomplete="off">
                <button class="btn btn--primary" type="submit" aria-label="Enviar">${ICON_SEND}</button>
            </form>
            <p class="assistant__note">Responde con la información pública del box. Para tu cuenta, reservas o pagos entrá a "Mi cuenta".</p>`;
        const id = 'as-in-' + boxes.length;
        root.querySelector('input').id = id;
        root.querySelector('label').htmlFor = id;
        const box = {
            root,
            log: root.querySelector('.assistant__log'),
            input: root.querySelector('input'),
            btn: root.querySelector('button[type=submit]'),
            chips: root.querySelector('.assistant__chips'),
        };
        SUGGESTIONS.forEach(q => {
            const c = document.createElement('button');
            c.type = 'button'; c.className = 'assistant__chip'; c.textContent = q;
            c.addEventListener('click', () => send(q));
            box.chips.appendChild(c);
        });
        root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); send(box.input.value); });
        boxes.push(box);
        return box;
    }

    function addBubble(role, text, extraClass = '') {
        for (const b of boxes) {
            const div = document.createElement('div');
            div.className = `assistant__msg assistant__msg--${role} ${extraClass}`;
            renderText(div, text);
            b.log.appendChild(div);
            b.log.scrollTop = b.log.scrollHeight;
            b.chips.hidden = history.length > 0;
        }
    }
    function setBusy(on) {
        for (const b of boxes) {
            b.btn.disabled = on; b.input.disabled = on;
            let t = b.log.querySelector('.assistant__typing');
            if (on && !t) {
                t = document.createElement('div');
                t.className = 'assistant__msg assistant__msg--assistant assistant__typing';
                t.innerHTML = '<span></span><span></span><span></span>';
                t.setAttribute('aria-label', 'El asistente está escribiendo');
                b.log.appendChild(t);
                b.log.scrollTop = b.log.scrollHeight;
            }
            if (!on && t) t.remove();
        }
    }

    let busy = false;
    async function send(text) {
        text = String(text || '').trim();
        if (!text || busy) return;
        if (text.length > MAX) { B.toast(`Máximo ${MAX} caracteres.`, 'error'); return; }
        boxes.forEach(b => { b.input.value = ''; });
        history.push({ role: 'user', content: text });
        addBubble('user', text);
        busy = true; setBusy(true);
        try {
            const r = await B.api('POST', '/chat', { messages: history.slice(-10) });
            history.push({ role: 'assistant', content: r.reply.slice(0, 2000) });
            setBusy(false);
            addBubble('assistant', r.reply);
        } catch (err) {
            history.pop();
            setBusy(false);
            addBubble('assistant', err.message || 'No pude responder. Probá de nuevo en un momento.', 'assistant__msg--error');
        } finally {
            busy = false;
            boxes.forEach(b => { b.btn.disabled = false; b.input.disabled = false; });
            const vis = boxes.find(b => b.root.offsetParent !== null);
            if (vis) vis.input.focus({ preventScroll: true });
        }
    }

    /* ---------- Montaje ---------- */
    document.querySelectorAll('[data-assistant]').forEach(el => mount(el));

    // Botón flotante (en las páginas que cargan este archivo, salvo que lo apaguen con data-assistant-fab="off")
    const withFab = document.body.dataset.assistantFab !== 'off';
    if (withFab) mountFab();
    function mountFab() {
        const fab = document.createElement('button');
        fab.type = 'button'; fab.className = 'assistant-fab'; fab.setAttribute('aria-label', 'Abrir el asistente');
        fab.innerHTML = `${ICON_BOT}<span>¿Dudas?</span>`;
        const panel = document.createElement('div');
        panel.className = 'assistant-pop'; panel.hidden = true;
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Asistente virtual');
        document.body.append(fab, panel);
        const pop = mount(panel, { floating: true });
        const open = (v) => {
            panel.hidden = !v; fab.classList.toggle('is-open', v);
            if (v) { pop.log.scrollTop = pop.log.scrollHeight; pop.input.focus(); }
        };
        fab.addEventListener('click', () => open(panel.hidden));
        panel.querySelector('.assistant__close').addEventListener('click', () => open(false));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
        // Si la sección del asistente está a la vista, el botón flotante se esconde.
        const inline = document.getElementById('assistant-inline');
        if (inline && 'IntersectionObserver' in window) {
            new IntersectionObserver(([en]) => { fab.classList.toggle('is-hidden', en.isIntersecting && panel.hidden); }, { threshold: 0.2 }).observe(inline);
        }
    }

    /* ---------- Mensaje de bienvenida y modo ---------- */
    addBubble('assistant', '¡Hola! Soy el asistente de Bunker. Preguntame por horarios, clases, precios, cómo reservar, pagos, productos o qué traer a entrenar.');
    B.api('GET', '/chat/status').then(s => {
        boxes.forEach(b => { b.root.querySelector('.assistant__mode').textContent = s.mode === 'ia' ? 'Con inteligencia artificial' : 'Respuestas rápidas'; });
    }).catch(() => boxes.forEach(b => { b.root.querySelector('.assistant__mode').textContent = 'Sin conexión'; }));
});
