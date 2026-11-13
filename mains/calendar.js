/* =========================================================
   Calendario mensual reutilizable (Mi cuenta y panel admin).
   new BunkerCalendar(contenedor, async (mes 'YYYY-MM') => datos)
   ========================================================= */
(function () {
    'use strict';
    const B = window.Bunker;

    class BunkerCalendar {
        constructor(el, loader) {
            this.el = el;
            this.loader = loader;
            const now = new Date();
            this.year = now.getFullYear();
            this.month = now.getMonth();
            this.selected = null;
            this.data = null;
            this.el.addEventListener('click', (e) => this.onClick(e));
            this.load();
        }

        get key() { return `${this.year}-${String(this.month + 1).padStart(2, '0')}`; }

        async load() {
            this.el.innerHTML = '<div class="cal"><div class="loading">Cargando calendario…</div></div>';
            try {
                this.data = await this.loader(this.key);
            } catch (err) {
                this.el.innerHTML = `<div class="cal"><div class="empty-mini">${B.esc(err.message)}</div></div>`;
                return;
            }
            this.render();
        }

        shift(n) {
            this.month += n;
            if (this.month < 0) { this.month = 11; this.year--; }
            if (this.month > 11) { this.month = 0; this.year++; }
            this.selected = null;
            this.load();
        }

        onClick(e) {
            const nav = e.target.closest('[data-cal]');
            if (nav) {
                const a = nav.dataset.cal;
                if (a === 'prev') this.shift(-1);
                else if (a === 'next') this.shift(1);
                else if (a === 'today') { const n = new Date(); this.year = n.getFullYear(); this.month = n.getMonth(); this.selected = B.todayStr(); this.load(); }
                return;
            }
            const day = e.target.closest('[data-day]');
            if (day) { this.selected = day.dataset.day; this.render(); }
        }

        render() {
            const d = this.data;
            const byDate = {};
            d.reservations.forEach(r => (byDate[r.date] = byDate[r.date] || []).push(r));
            const blocked = Object.fromEntries(d.blockedDays.map(b => [b.date, b.reason]));
            const inPlan = (ds) => d.subscriptions.some(s => s.start_date <= ds && s.end_date >= ds);
            const today = B.todayStr();

            const first = new Date(this.year, this.month, 1);
            const offset = (first.getDay() + 6) % 7; // semana empieza el lunes
            const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
            const cells = [];
            for (let i = 0; i < offset; i++) cells.push('<div class="cal__day cal__day--out"></div>');
            for (let day = 1; day <= daysInMonth; day++) {
                const ds = `${this.key}-${String(day).padStart(2, '0')}`;
                const evs = byDate[ds] || [];
                const cls = ['cal__day'];
                if (ds === today) cls.push('cal__day--today');
                if (inPlan(ds)) cls.push('cal__day--plan');
                if (blocked[ds]) cls.push('cal__day--blocked');
                const evHtml = evs.slice(0, 3).map(r => {
                    const c = B.safeColor(r.color);
                    return `<span class="cal__ev" style="border-left-color:${c};background:${c}22" title="${B.esc(r.activity_name + ' ' + r.start_time)}">${B.esc(r.start_time)} ${B.esc(r.activity_name)}</span>`;
                }).join('');
                const more = evs.length > 3 ? `<span class="cal__more">+${evs.length - 3} más</span>` : '';
                cells.push(`<button type="button" class="${cls.join(' ')}" data-day="${ds}" aria-label="${B.esc(B.dateLong(ds))}: ${evs.length} clase(s)">
                    <span class="cal__num">${day}</span>${evHtml}${more}</button>`);
            }

            const dows = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<div class="cal__dow">${x}</div>`).join('');
            const total = d.reservations.length;
            let detail = '';
            if (this.selected && this.selected.startsWith(this.key)) {
                const evs = byDate[this.selected] || [];
                detail = `<div class="cal__detail">
                    <h4>${B.esc(B.dateLong(this.selected))}</h4>
                    ${blocked[this.selected] ? `<div class="notice notice--warn"><span class="notice__icon">⚠️</span><div>Sin clases: ${B.esc(blocked[this.selected])}</div></div>` : ''}
                    ${evs.length ? `<div class="list">${evs.map(r => `
                        <div class="list-item">
                            <div class="list-item__body">
                                <div class="list-item__title">${B.esc(r.activity_name)}</div>
                                <div class="list-item__meta"><span>${B.esc(r.start_time)} a ${B.esc(r.end_time)} HS</span><span>Boleto #${Number(r.ticket)}</span></div>
                            </div>
                        </div>`).join('')}</div>` : '<div class="empty-mini">No hay clases reservadas este día.</div>'}
                </div>`;
            }

            this.el.innerHTML = `
                <div class="cal">
                    <div class="cal__head">
                        <div>
                            <div class="cal__title">${B.MONTHS[this.month]} ${this.year}</div>
                            <small style="color:var(--text-muted)">${total} clase${total === 1 ? '' : 's'} reservada${total === 1 ? '' : 's'}</small>
                        </div>
                        <div class="cal__nav">
                            <button class="cal__btn" type="button" data-cal="prev" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
                            <button class="cal__btn cal__today" type="button" data-cal="today">Hoy</button>
                            <button class="cal__btn" type="button" data-cal="next" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                        </div>
                    </div>
                    <div class="cal__grid">${dows}${cells.join('')}</div>
                    <div class="cal__legend">
                        <span><i style="background:var(--primary-soft);border-left:3px solid var(--primary)"></i>Clase reservada</span>
                        <span><i style="background:rgba(74,222,128,.25)"></i>Plan vigente</span>
                        <span><i style="background:rgba(251,191,36,.3)"></i>Día sin clases</span>
                    </div>
                    ${detail}
                </div>`;
        }
    }

    window.BunkerCalendar = BunkerCalendar;
})();
