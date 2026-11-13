/* Se carga en el <head> para aplicar el tema antes de pintar la página (evita parpadeo). */
(function () {
    try {
        var t = localStorage.getItem('theme') ||
            (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        document.documentElement.setAttribute('data-theme', t);
    } catch (e) { }
})();
