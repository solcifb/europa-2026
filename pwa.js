/* La lectura guardada no depende de la red ni del SDK de notificaciones. */
function createPWA(App, hooks) {
  var { onDataLoaded, showToast, updateNotificationToggle, showLoginScreen, apiGH, onLoadError, setView, syncNotifications } = hooks;
  var GH_TOKEN_KEY = 'europa2026_gh_token';
  'use strict';
  var store = TripOffline.createStore();
  var dataExpiresAt = 0, sessionExpiresAt = 0, savedAt = 0, verifiedToken = null, refreshing = null;
  var expiryTimer, generation = 0, storageWarning = false, localSettings = false;
  var revision = 0, readSequence = 0, latestReads = {}, pendingReads = new Set();
  var installPrompt = null, waitingWorker = null, started = false;
  var mutating = ['marcarCheck', 'saveSettings', 'forceLogout', 'agregarLugar', 'agregarEvento', 'actualizarEvento'];
  function token() {
    try { return localStorage.getItem(GH_TOKEN_KEY); } catch (_) { return null; }
  }
  function isLoading() {
    return !!(refreshing && refreshing.token === token() && refreshing.generation === generation && refreshing.revision === revision) ||
      Array.from(pendingReads).some(function (read) { return readIsCurrent(read); });
  }
  function beginRead(action, current) {
    var read = { action: action, token: current, generation: generation, revision: revision, id: ++readSequence };
    latestReads[action] = read.id;
    pendingReads.add(read); updateUI();
    return read;
  }
  function readIsCurrent(read) {
    return !read || (token() === read.token && generation === read.generation && revision === read.revision && latestReads[read.action] === read.id);
  }
  function assertRead(read) {
    if (!readIsCurrent(read)) {
      var error = new Error('La actualización fue reemplazada'); error.staleData = true; throw error;
    }
  }
  function endRead(read) { pendingReads.delete(read); updateUI(); }
  function dataChanged(current) {
    if (token() !== current) return;
    revision++; verifiedToken = null; updateUI();
  }
  function canWrite() {
    return navigator.onLine && !isLoading() && !!token() && verifiedToken === token() && (!sessionExpiresAt || Date.now() < sessionExpiresAt);
  }
  function updateUI() {
    var offline = document.getElementById('offline-status');
    if (offline) offline.hidden = navigator.onLine;
    var updated = document.getElementById('trip-updated');
    if (updated) updated.textContent = savedAt ? 'Última actualización: ' + new Date(savedAt).toLocaleString('es-AR') : '';
    var locked = !canWrite(), loading = App.loggedIn && isLoading();
    var add = document.getElementById('btn-add');
    var spinner = document.getElementById('trip-loading');
    var slot = document.getElementById('trip-action');
    if (add) add.style.display = App.userRole === 'master' && !locked && !loading ? 'flex' : 'none';
    if (spinner) spinner.hidden = !loading;
    if (slot) slot.hidden = !loading && !(App.userRole === 'master' && !locked);
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
  async function acceptData(data, current, read) {
    assertRead(read);
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
    var expires = dataExpiresAt, updatedAt = savedAt;
    try {
      var owner = await TripOffline.fingerprint(current);
      await store.save({ version: TripOffline.FORMAT, owner: owner, expiresAt: expires, savedAt: updatedAt, data: clean },
        function () { return token() === current && readIsCurrent(read) && expires > Date.now(); });
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
  async function refresh(options) {
    var current = token();
    if (!started || !current || !navigator.onLine) return false;
    if (dataExpiresAt && dataExpiresAt <= Date.now()) await expireData(current);
    if (refreshing?.token === current && refreshing.generation === generation && refreshing.revision === revision && !options?.force) return refreshing.promise;
    var operation = { token: current, generation: generation, revision: revision, promise: null };
    refreshing = operation; updateUI();
    function currentOperation() {
      return refreshing === operation && token() === current && operation.generation === generation && operation.revision === revision;
    }
    operation.promise = (async function () {
      var updated = false;
      try {
        var result = await apiGH('checkSession', {});
        if (!currentOperation() || !result.logged) return false;
        var data = await apiGH('getAppData', {});
        if (!currentOperation() || data.error) return false;
        onDataLoaded(data);
        updated = true;
        return true;
      } catch (error) {
        if (!currentOperation() || error.staleData) return false;
        verifiedToken = null;
        if (!App.data) onLoadError({ message: 'Conectate para ingresar y descargar el viaje.' });
        return false;
      } finally {
        if (refreshing === operation) refreshing = null;
        updateUI();
        if (updated && canWrite() && typeof syncNotifications === 'function') void syncNotifications();
      }
    })();
    return operation.promise;
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
    beginRead: beginRead, endRead: endRead, readIsCurrent: readIsCurrent, assertRead: assertRead, dataChanged: dataChanged,
    requireConnection: requireConnection, initInstall: initInstall, lostConnection: lostConnection };
}
