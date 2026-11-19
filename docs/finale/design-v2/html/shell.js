// Injects the 64 px icon rail. data-active on <nav id="rail"> picks the current item.
(function () {
  const svg = (p) => '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  const icons = {
    patients: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.3 3.4 4.7"/>'),
    desk: svg('<path d="M4 13l2.2-7h11.6L20 13v5.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2.5h5l1-2.5H20"/>'),
    requests: svg('<path d="M21 4L10.5 14.5"/><path d="M21 4l-6.5 16-4-5.5L5 10.5z"/>'),
    admin: svg('<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>')
  };
  const items = [['patients', 'Patients', 'patients.html'], ['desk', 'Records desk', 'records-desk.html'], ['requests', 'Requests', '#'], ['admin', 'Admin', 'admin.html']];
  const nav = document.getElementById('rail');
  if (!nav) return;
  const act = nav.dataset.active, show = nav.dataset.showtip;
  nav.className = 'rail';
  nav.setAttribute('aria-label', 'Main');
  nav.innerHTML =
    '<div class="logo" role="img" aria-label="OncoSetu"><svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 24V15a11 11 0 0 1 22 0v9"/><path d="M10 24v-8a5 5 0 0 1 10 0v8" opacity=".55"/></svg></div>' +
    items.map((i) => '<a class="item' + (show === i[0] ? ' show' : '') + '" href="' + i[2] + '"' + (act === i[0] ? ' aria-current="page"' : '') + ' aria-label="' + i[1] + '">' + icons[i[0]] + '<span class="tip" role="tooltip">' + i[1] + '</span></a>').join('') +
    '<div class="spacer"></div><div class="avatar" role="img" aria-label="Signed in as Dr. Meera Iyer">MI</div>';
})();
