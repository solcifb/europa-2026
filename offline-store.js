(function (root) {
  'use strict';
  const FORMAT = 1;
  const ARRAYS = ['eventos', 'destinos', 'lugares', 'telefonos', 'documentos', 'checks'];
  function validData(data) {
    return !!(data && !data.error && data.config &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.config.FechaInicio) &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.config.FechaFin) &&
      tripExpiry(data.config.FechaInicio) > 0 && tripExpiry(data.config.FechaFin) > 0 &&
      data.config.FechaInicio <= data.config.FechaFin &&
      typeof data.userRole === 'string' && data.checksCompletados && typeof data.checksCompletados === 'object' && !Array.isArray(data.checksCompletados) && ARRAYS.every(key => Array.isArray(data[key])));
  }
  async function fingerprint(token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function validSnapshot(value, owner, now = Date.now()) {
    return !!(value && value.version === FORMAT && value.owner === owner &&
      tripExpiry(value.data?.config?.FechaFin) > now &&
      Number.isFinite(value.savedAt) && validData(value.data));
  }
  // FechaFin no tiene hora: sumar 24 horas desde su medianoche local.
  function tripExpiry(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const [year, month, day] = date.split('-').map(Number);
    const end = new Date(year, month - 1, day);
    if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) return 0;
    return end.getTime() + 24 * 60 * 60 * 1000;
  }
  function createStore(idb = root.indexedDB) {
    let connection;
    function open() {
      if (!connection) connection = new Promise((resolve, reject) => {
        if (!idb) return reject(new Error('Storage unavailable'));
        const request = idb.open('europa2026-trip', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('trip');
        request.onsuccess = () => {
          request.result.onversionchange = () => { request.result.close(); connection = null; };
          resolve(request.result);
        };
        request.onerror = () => { connection = null; reject(request.error); };
        request.onblocked = () => { connection = null; reject(new Error('Storage blocked')); };
      });
      return connection;
    }
    async function transaction(mode, run) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('trip', mode);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage failed'));
        run(tx.objectStore('trip'), result => { value = result; });
      });
    }
    return {
      read: () => transaction('readonly', (store, result) => {
        const request = store.get('current');
        request.onsuccess = () => result(request.result);
      }),
      save: (snapshot, current = () => true) => transaction('readwrite', store => {
        if (current()) store.put(snapshot, 'current');
      }),
      clear: (owner, shouldClear = () => true) => transaction('readwrite', store => {
        const request = store.get('current');
        request.onsuccess = () => {
          if ((!owner || request.result?.owner === owner) && shouldClear(request.result)) store.delete('current');
        };
      }),
      preferences: (owner, settings) => transaction('readwrite', store => {
        const request = store.get('current');
        request.onsuccess = () => {
          const snapshot = request.result;
          if (snapshot?.owner === owner) {
            snapshot.data.settings = { ...settings };
            store.put(snapshot, 'current');
          }
        };
      })
    };
  }
  root.TripOffline = { FORMAT, validData, fingerprint, validSnapshot, tripExpiry, createStore };
})(typeof window === 'undefined' ? globalThis : window);
