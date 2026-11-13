/* Manual de uso: muestra solo el manual del rol que inició sesión (socio, profe o admin).
   Sin sesión, manda a ingresar y después vuelve acá. */
document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const s = await B.renderSessionMenu();
    if (!s || !s.user) {
        location.replace('login.html?next=' + encodeURIComponent('/page/manual.html'));
        return;
    }
    const role = ['admin', 'profe'].includes(s.user.role) ? s.user.role : 'user';
    document.getElementById('manual-role').textContent = { user: 'socio', profe: 'profe', admin: 'administración' }[role];
    document.querySelector(`.manual__role[data-role="${role}"]`).hidden = false;
    document.getElementById('manual-root').hidden = false;
});
