// Yandex.Metrika loader. The counter is initialised from JS (src/lib/metrica.ts)
// only for logged-out visitors on public pages — never on authenticated pages,
// to keep student personal data out of Webvisor session replays (152-ФЗ).
// Kept as an external file (not inline in index.html) so the CSP's script-src
// doesn't need 'unsafe-inline' or a content hash — see deploy/nginx/gradeassist.conf.
(function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=109625339', 'ym');
