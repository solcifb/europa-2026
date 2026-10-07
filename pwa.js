/* La lectura guardada no depende de la red ni del SDK de notificaciones. */
function createPWA(App, hooks) {
  var { onDataLoaded, showToast, updateNotificationToggle, showLoginScreen, apiGH, onLoadError, setView, syncNotifications } = hooks;
  var GH_TOKEN_KEY = 'europa2026_gh_token';
  'use strict';
  var store = TripOffline.createStore();
  var dataExpiresAt = 0, sessionExpiresAt = 0, savedAt = 0, verifiedToken = null, refreshing = null;
  var expiryTimer, generation = 0, storageWarning = false, localSettings = false;
  var installPrompt = null, waitingWorker = null, started = false;
  var mutating = ['marcarCheck', 'saveSettings', 'forceLogout', 'agregarLugar', 'agregarEvento', 'actualizarEvento'];
  function token() {
    try { return localStorage.getItem(GH_TOKEN_KEY); } catch (_) { return null; }
  }
  function canWrite() {
    return navigator.onLine && !!token() && verifiedToken === token() && (!sessionExpiresAt || Date.now() < sessionExpiresAt);
  }
  function updateUI() {
    var offline = document.getElementById('offline-status');
    if (offline) offline.hidden = navigator.onLine;
    var updated = document.getElementById('trip-updated');
    if (updated) updated.textContent = savedAt ? 'Última actualización: ' + new Date(savedAt).toLocaleString('es-AR') : '';
    var locked = !canWrite();
    document.querySelectorAll('#btn-add, [data-check-id], [data-force-logout], #btn-save-lugar, #btn-save-evento, #btn-save-edit').forEach(function (el) {
      el.disabled = locked;
      el.title = locked ? 'Necesitás conexión para realizar cambios' : '';
    });
    var admin = document.getElementById('admin-section');
    if (admin && locked) admin.classList.add('hidden');
    if (typeof updateNotificationToggle === 'function') updateNotificationToggle();
  }
  function armExpiry() {
    clearTimeout(expiryTimer);
    if (dataExpiresAt) expiryTimer = setTimeout(function () {
      if (Date.now() >= dataExpiresAt) void expireData();
      else armExpiry();
    }, Math.max(1, Math.min(2147483647, dataExpiresAt - Date.now())));
  }
  function resetView() {
    App.data = null; App.days = []; App.loggedIn = false; App.userRole = null;
    App.settings = { tema: 'dark', zonaHoraria: 'original' };
    ['search-overlay','settings-overlay','add-overlay','edit-overlay'].forEach(function (id) {
      document.getElementById(id)?.classList.add('hidden');
    });
    ['bottom-nav','search-results','admin-sessions-list'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    ['form-lugar','form-evento','form-edit'].forEach(function (id) { document.getElementById(id)?.reset?.(); });
    document.getElementById('topbar-title').textContent = 'Europa 2026';
    document.getElementById('btn-add').style.display = 'none';
    showLoginScreen(); updateUI();
  }
  async function clearSession(expectedToken) {
    var previous = expectedToken || token();
    if (expectedToken && token() !== expectedToken) return;
    generation++;
    verifiedToken = null; dataExpiresAt = 0; sessionExpiresAt = 0; savedAt = 0; localSettings = false;
    clearTimeout(expiryTimer);
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch (_) {}
    resetView();
    try { if (previous) await store.clear(await TripOffline.fingerprint(previous)); } catch (_) {}
  }
  async function expireData(current = token()) {
    if (!current || token() !== current || dataExpiresAt > Date.now()) return;
    dataExpiresAt = 0; savedAt = 0;
    clearTimeout(expiryTimer);
    // La copia vencida no cierra una sesión que todavía permite consultar online.
    if (!navigator.onLine || verifiedToken !== current) {
      verifiedToken = null;
      resetView();
      onLoadError({ message: 'Conectate para actualizar el viaje.' });
    }
    updateUI();
    try {
      await store.clear(await TripOffline.fingerprint(current),
        function (snapshot) { return TripOffline.tripExpiry(snapshot?.data?.config?.FechaFin) <= Date.now(); });
    } catch (_) {}
  }
  async function restore() {
    var current = token(), epoch = generation;
    if (!current) return false;
    try {
      var owner = await TripOffline.fingerprint(current), snapshot = await store.read();
      if (token() !== current || epoch !== generation) return false;
      if (!TripOffline.validSnapshot(snapshot, owner)) {
        if (snapshot) await store.clear(snapshot.owner);
        return false;
      }
      dataExpiresAt = TripOffline.tripExpiry(snapshot.data.config.FechaFin); savedAt = snapshot.savedAt;
      App.loggedIn = true; App.userRole = snapshot.data.userRole;
      onDataLoaded(snapshot.data);
      armExpiry(); updateUI();
      return true;
    } catch (_) { return false; }
  }
  async function acceptData(data, current) {
    if (!TripOffline.validData(data)) throw new Error('No se pudo actualizar el viaje');
    if (token() !== current) throw new Error('La sesión cambió');
    if (localSettings && App.data) data.settings = Object.assign({}, App.settings);
    dataExpiresAt = TripOffline.tripExpiry(data.config.FechaFin);
    savedAt = Date.now();
    verifiedToken = current;
    App.loggedIn = true;
    clearTimeout(expiryTimer);
    updateUI();
    if (dataExpiresAt <= Date.now()) {
      try { await store.clear(await TripOffline.fingerprint(current)); } catch (_) {}
      return;
    }
    armExpiry();
    var clean = Object.assign({}, data); delete clean.userCode;
    try {
      var owner = await TripOffline.fingerprint(current);
      await store.save({ version: TripOffline.FORMAT, owner: owner, expiresAt: dataExpiresAt, savedAt: savedAt, data: clean },
        function () { return token() === current && dataExpiresAt > Date.now(); });
    } catch (_) {
      if (!storageWarning) { storageWarning = true; showToast('No se pudo guardar el viaje para usar sin conexión'); }
    }
  }
  async function session(result, current) {
    if (token() !== current) throw new Error('La sesión cambió');
    started = true;
    var serverExpiry = Number(result.expiresAt);
    sessionExpiresAt = Number.isFinite(serverExpiry) && serverExpiry > 0 ? serverExpiry : 0;
    verifiedToken = null;
    if (sessionExpiresAt && sessionExpiresAt <= Date.now()) { await clearSession(current); throw new Error('La sesión venció'); }
    // No volver a mostrar información de master si el servidor cambió sus permisos.
    if (App.data && App.userRole !== result.rol) {
      App.data = null; App.userRole = result.rol;
      document.getElementById('bottom-nav').innerHTML = '';
      document.getElementById('btn-add').style.display = 'none';
      ['search-overlay','settings-overlay','add-overlay','edit-overlay'].forEach(function (id) { document.getElementById(id)?.classList.add('hidden'); });
      document.getElementById('view-root').innerHTML = '<div class="loading">Actualizando viaje…</div>';
      try { await store.clear(await TripOffline.fingerprint(current)); } catch (_) {}
    }
    updateUI();
  }
  async function refresh() {
    var current = token();
    if (!started || !current) return;
    if (dataExpiresAt && dataExpiresAt <= Date.now()) await expireData(current);
    if (!navigator.onLine) return;
    if (refreshing?.token === current) return refreshing.promise;
    var epoch = generation;
    var promise = (async function () {
      try {
        var result = await apiGH('checkSession', {});
        if (!result.logged || token() !== current || epoch !== generation) return;
        var data = await apiGH('getAppData', {});
        if (token() !== current || epoch !== generation || data.error) return;
        onDataLoaded(data);
      } catch (_) {
        if (token() !== current || epoch !== generation) return;
        verifiedToken = null; updateUI();
        if (!App.data) onLoadError({ message: 'Conectate para ingresar y descargar el viaje.' });
      }
    })();
    refreshing = { token: current, promise: promise };
    await promise;
    if (refreshing?.promise === promise) refreshing = null;
  }
  async function start() {
    var epoch = generation;
    var restored = await restore();
    if (epoch !== generation) return;
    started = true;
    if (!restored && !token()) showLoginScreen();
    else if (!restored && !navigator.onLine) onLoadError({ message: 'Conectate para ingresar y descargar el viaje.' });
    updateUI();
    void refresh();
  }
  function preferences() {
    localSettings = true;
    var current = token();
    if (current) TripOffline.fingerprint(current).then(function (owner) {
      return store.preferences(owner, App.settings);
    }).catch(function () {});
  }
  function lostConnection() {
    verifiedToken = null;
    if (App.data && TripOffline.tripExpiry(App.data.config.FechaFin) <= Date.now()) void expireData();
    updateUI();
    if (App.view === 'mapa' && App.data) setView('mapa');
  }
  function requireConnection() {
    if (canWrite()) return true;
    showToast('Necesitás conexión para realizar cambios');
    return false;
  }
  async function initInstall() {
    var button = document.getElementById('btn-install');
    var hint = document.getElementById('install-hint');
    var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!standalone && ios) {
      button.hidden = false;
      button.onclick = function () { hint.hidden = !hint.hidden; };
    }
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault(); installPrompt = event; button.hidden = false;
      button.onclick = async function () {
        await installPrompt.prompt(); await installPrompt.userChoice;
        installPrompt = null; button.hidden = true;
      };
    });
    window.addEventListener('appinstalled', function () { button.hidden = true; hint.hidden = true; });
    if (!('serviceWorker' in navigator)) return;
    try {
      var registration = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
      function offerUpdate() {
        if (!navigator.serviceWorker.controller || !registration.waiting) return;
        waitingWorker = registration.waiting;
        document.getElementById('app-update').hidden = false;
      }
      offerUpdate();
      registration.addEventListener('updatefound', function () {
        registration.installing?.addEventListener('statechange', offerUpdate);
      });
      var accepted = false;
      document.getElementById('btn-update').onclick = function () {
        accepted = true; waitingWorker?.postMessage({ type: 'ACTIVATE_UPDATE' });
      };
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (accepted) location.reload(); });
    } catch (error) { console.error('No se pudo preparar la aplicación offline', error); }
  }
  window.addEventListener('offline', lostConnection);
  window.addEventListener('online', function () {
    updateUI();
    if (!App.loggedIn && typeof syncNotifications === 'function') void syncNotifications();
    void refresh();
  });
  window.addEventListener('storage', async function (event) {
    if (event.key !== 'europa2026_gh_token') return;
    generation++; started = false; verifiedToken = null; dataExpiresAt = 0; sessionExpiresAt = 0; savedAt = 0; localSettings = false;
    clearTimeout(expiryTimer);
    resetView();
    try { if (event.oldValue) await store.clear(await TripOffline.fingerprint(event.oldValue)); } catch (_) {}
    void start();
  });
  window.addEventListener('focus', function () { if (token()) void refresh(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && token()) void refresh();
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href]');
    if (!link || navigator.onLine || /^(tel:|mailto:|#)/.test(link.getAttribute('href'))) return;
    if (new URL(link.href).origin !== location.origin) {
      event.preventDefault(); showToast('Necesitás conexión para abrir este enlace');
    }
  }, true);
  return { token: token, canWrite: canWrite, mutating: mutating, updateUI: updateUI, clearSession: clearSession,
    acceptData: acceptData, session: session, start: start, refresh: refresh, preferences: preferences,
    requireConnection: requireConnection, initInstall: initInstall, lostConnection: lostConnection };
}
