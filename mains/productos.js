document.addEventListener('DOMContentLoaded', async () => {
    'use strict';
    const B = window.Bunker;
    const $ = (s) => document.querySelector(s);
    const esc = B.esc;

    B.renderSessionMenu(); // el mostrador es público

    let products = [];
    let current = 'Todos';
    try {
        products = (await B.api('GET', '/public/products')).products;
    } catch (err) {
        $('#products').innerHTML = `<div class="empty-mini">${esc(err.message)}</div>`;
        return;
    }

    const cats = ['Todos', ...new Set(products.map(p => p.category))];
    function renderFilters() {
        $('#cat-filters').innerHTML = cats.length > 2 ? cats.map(c =>
            `<button class="chip-btn ${c === current ? 'is-active' : ''}" type="button" data-cat="${esc(c)}">${esc(c)}</button>`).join('') : '';
    }
    $('#cat-filters').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        current = b.dataset.cat;
        renderFilters(); render();
    });

    const NO_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>';
    function render() {
        const list = products.filter(p => current === 'Todos' || p.category === current);
        if (!list.length) { $('#products').innerHTML = '<div class="empty-mini">No hay productos cargados.</div>'; return; }
        $('#products').innerHTML = list.map(p => `
            <article class="product ${p.available ? '' : 'product--off'}">
                <div class="product__img">${p.image ? `<img src="/uploads/products/${encodeURIComponent(p.image)}" alt="${esc(p.name)}" loading="lazy">` : NO_IMG}</div>
                <div class="product__body">
                    <span class="product__cat">${esc(p.category)}</span>
                    <h3 class="product__name">${esc(p.name)}</h3>
                    <p class="product__desc">${esc(p.description)}</p>
                    <div class="product__foot">
                        <span class="product__price">${B.money(p.price)}</span>
                        ${p.available ? '<span class="pill pill--ok">Disponible</span>' : '<span class="pill pill--muted">Sin stock</span>'}
                    </div>
                </div>
            </article>`).join('');
    }
    renderFilters();
    render();
});
