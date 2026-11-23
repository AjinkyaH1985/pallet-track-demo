/* Pallet Track demo — plain JS, data in localStorage. */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  const N = ALPHABET.length;                          // 31 (prime: good for check char)
  const ID_RE = new RegExp('^PLT-[' + ALPHABET + ']{7}$');
  const DAY = 86400000;
  const DUP_WINDOW_MS = 3000;

  // Demo mode: pallet IDs come from a fixed seed, so every phone/laptop
  // makes the SAME IDs. Labels printed from one device are then known on
  // every other device after "Load sample data". IDs still look random
  // (not sequential). Set to false for true random IDs.
  const DEMO_FIXED_IDS = true;
  const ID_SEED = 20261119;

  const KEYS = {
    pallets: 'pt_pallets',
    scans: 'pt_scans',
    settings: 'pt_settings',
    photos: 'pt_photos',
    session: 'pt_session',
    init: 'pt_initialized'
  };

  // Made-up customers who rent the pallets. The name is printed under the QR.
  const SAMPLE_CUSTOMERS = ['ABC Auto Components', 'Mahalaxmi Forgings', 'Sigma Engineering'];

  const DEFAULT_SETTINGS = {
    customers: SAMPLE_CUSTOMERS.slice(),
    locations: ['Warehouse Dock A', 'Gate 1', 'Dispatch Bay'],
    userName: '',
    lastLocation: ''
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); } // may throw (quota)

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  }
  function daysSince(iso) { return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)); }
  function daysText(n) { return n == null ? '—' : (n === 0 ? 'Today' : n === 1 ? '1 day' : n + ' days'); }

  // ------------------------------------------------------------------
  // Pallet ID + check character.
  // Weighted mod-31 checksum: sum of (position x value) for positions
  // 1..7 must be 0 mod 31. Because 31 is prime, this catches EVERY single
  // wrong character and EVERY swap of two characters.
  // ------------------------------------------------------------------
  const INV7 = 9; // 7 * 9 = 63 = 1 (mod 31)
  function checkChar(body) {
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum += (i + 1) * ALPHABET.indexOf(body[i]);
    return ALPHABET[((N - (sum % N)) % N) * INV7 % N];
  }
  function checkOk(code7) {
    let sum = 0;
    for (let i = 0; i < code7.length; i++) {
      const v = ALPHABET.indexOf(code7[i]);
      if (v < 0) return false;
      sum += (i + 1) * v;
    }
    return sum % N === 0;
  }
  // Turn "plt 7k3m9qx", "PLT7K3M9QX", "7K3M9QX" into "PLT-7K3M9QX"
  function normalizeId(raw) {
    let s = String(raw || '').toUpperCase().replace(/[\s_]/g, '');
    if (s.startsWith('PLT-')) s = s.slice(4);
    else if (s.startsWith('PLT')) s = s.slice(3);
    s = s.replace(/-/g, '');
    return 'PLT-' + s;
  }
  function looksLikePalletId(id) { return /^PLT-[A-Z0-9]{7}$/.test(id); }
  function isValidId(id) { return ID_RE.test(id) && checkOk(id.slice(4)); }
  function makeId(rand) {
    let body = '';
    for (let i = 0; i < 6; i++) body += ALPHABET[Math.floor(rand() * N)];
    return 'PLT-' + body + checkChar(body);
  }
  function cryptoRand() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  // Fixed demo ID streams: the same lists on every device.
  // The main stream holds the 30 sample pallets (and labels made with no
  // customer name). Each customer has its own stream, so any device can tell
  // that a printed label is genuine and which customer it belongs to, even if
  // the label was generated on a different device.
  const STREAM_LOOKAHEAD = 3000; // how far into each stream a device looks
  function seededIdsFrom(seed, count) {
    const rand = mulberry32(seed), out = [], seen = new Set();
    while (out.length < count) {
      const id = makeId(rand);
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  }
  function seededIds(count) { return seededIdsFrom(ID_SEED, count); }
  function nameHash(s) { // FNV-1a, 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function customerSeed(customer) {
    const key = String(customer || '').trim().toLowerCase();
    return key ? ((ID_SEED ^ nameHash(key)) >>> 0) : ID_SEED;
  }
  function newPalletIds(count, existing, customer) {
    const out = [];
    if (DEMO_FIXED_IDS) {
      const seed = customerSeed(customer);
      let pool = existing.size + count + 20;
      while (out.length < count) {
        out.length = 0;
        for (const id of seededIdsFrom(seed, pool)) {
          if (!existing.has(id)) out.push(id);
          if (out.length === count) break;
        }
        pool *= 2;
      }
      return out;
    }
    const seen = new Set(existing);
    while (out.length < count) {
      const id = makeId(cryptoRand);
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let pallets = load(KEYS.pallets, []);
  let scans = load(KEYS.scans, []);
  let photos = load(KEYS.photos, {});
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
  delete settings.supplierName; // old field, no longer used
  if (!Array.isArray(settings.customers)) settings.customers = SAMPLE_CUSTOMERS.slice();
  let palletMap = new Map();
  let stateById = new Map();

  function rebuildIndex() {
    palletMap = new Map(pallets.map((p) => [p.id, p]));
    stateById = new Map();
    const sorted = scans.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
    for (const s of sorted) {
      let st = stateById.get(s.palletId);
      if (!st) { st = { last: null, lastOut: null, count: 0 }; stateById.set(s.palletId, st); }
      st.last = s;
      st.count++;
      if (s.action === 'LOAD_OUT') st.lastOut = s;
    }
  }
  function customerOf(id) {
    const p = palletMap.get(id);
    return (p && p.customer) || '';
  }
  function palletState(id) {
    const st = stateById.get(id) || { last: null, lastOut: null, count: 0 };
    return {
      last: st.last,
      lastOut: st.lastOut,
      count: st.count,
      status: st.last && st.last.action === 'LOAD_OUT' ? 'OUT' : 'AT_WAREHOUSE',
      damaged: !!(st.last && st.last.condition === 'DAMAGED')
    };
  }
  function statusBadge(st) {
    let html = st.status === 'OUT'
      ? '<span class="badge out">OUT</span>'
      : '<span class="badge in">AT WAREHOUSE</span>';
    if (st.damaged) html += ' <span class="badge dmg">DAMAGED</span>';
    return html;
  }
  function actionBadge(action) {
    return action === 'LOAD_OUT' ? '<span class="badge out">LOAD OUT</span>' : '<span class="badge in">UNLOAD IN</span>';
  }

  // ------------------------------------------------------------------
  // Sound + vibration + toast
  // ------------------------------------------------------------------
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) actx = new AC();
      }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { /* no audio */ }
  }
  function tone(freq, start, dur, type) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    const t0 = actx.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function feedbackSound(kind) {
    if (actx) {
      try {
        if (kind === 'ok') tone(1250, 0, 0.12);
        else if (kind === 'warn') { tone(700, 0, 0.12); tone(700, 0.18, 0.12); }
        else if (kind === 'bad') tone(220, 0, 0.35, 'sawtooth');
        else if (kind === 'info') { tone(880, 0, 0.09, 'sine'); tone(1320, 0.11, 0.12, 'sine'); }
        else if (kind === 'saved') { tone(880, 0, 0.1, 'sine'); tone(1175, 0.1, 0.1, 'sine'); tone(1568, 0.2, 0.18, 'sine'); }
      } catch (e) { /* ignore */ }
    }
    if (navigator.vibrate) {
      const p = { ok: 80, warn: [200, 100, 200], bad: [400], info: [40, 60, 40], saved: [60, 60, 120] }[kind];
      try { navigator.vibrate(p); } catch (e) { /* ignore */ }
    }
  }
  let toastTimer = null;
  function toast(msg, kind, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, ms || 2600);
  }
  // Unlock audio on the first touch anywhere (iOS needs a user tap).
  ['touchend', 'click'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));

  // ------------------------------------------------------------------
  // Tabs
  // ------------------------------------------------------------------
  const TABS = ['scan', 'dashboard', 'inventory', 'history', 'qr', 'settings'];
  let currentTab = 'scan';

  function goTab(name) {
    if (!TABS.includes(name)) name = 'scan';
    const leaving = currentTab;
    currentTab = name;
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.dataset.tab !== name; });
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
    if (leaving === 'scan' && name !== 'scan') camStop(true);
    if (name === 'scan') { renderLocations(); renderSession(); resumeCamIfWanted(); }
    if (name === 'dashboard') renderDashboard();
    if (name === 'qr') renderQr();
    if (name === 'settings') renderSettings();
    if (name === 'history') renderHistoryIdList();
    if (name === 'inventory') renderInventory();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.go)));

  function renderHeader() {
    $('whoLabel').textContent = '👤 ' + (settings.userName || 'Set your name');
  }
  $('whoLabel').addEventListener('click', () => { goTab('settings'); setTimeout(() => $('sUser').focus(), 50); });

  // ------------------------------------------------------------------
  // SCAN screen
  // ------------------------------------------------------------------
  let currentAction = null;          // 'LOAD_OUT' | 'UNLOAD_IN'
  let defaultCond = 'OK';
  let session = load(KEYS.session, { items: [] });   // survives a page reload
  if (!session || !Array.isArray(session.items)) session = { items: [] };
  let batchPhoto = '';               // compressed data URL
  const lastSeen = new Map();        // code -> time, for 3-second repeat filter

  function saveSession() { try { save(KEYS.session, session); } catch (e) { /* ignore */ } }

  function currentLocation() {
    const locs = settings.locations;
    if (settings.lastLocation && locs.includes(settings.lastLocation)) return settings.lastLocation;
    return locs[0] || '';
  }
  function renderLocations() {
    const sel = $('locSelect'), cur = currentLocation();
    sel.innerHTML = settings.locations.map((l) => '<option' + (l === cur ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  }
  function setLocation(name) {
    if (!settings.locations.includes(name)) settings.locations.push(name);
    settings.lastLocation = name;
    persistSettings();
    renderLocations();
  }
  $('locSelect').addEventListener('change', (e) => { settings.lastLocation = e.target.value; persistSettings(); });

  function setAction(a) {
    currentAction = a;
    $('btnLoadOut').classList.toggle('on', a === 'LOAD_OUT');
    $('btnUnloadIn').classList.toggle('on', a === 'UNLOAD_IN');
    $('fPartyLabel').textContent = a === 'LOAD_OUT' ? 'Destination (where is it going?)' : a === 'UNLOAD_IN' ? 'Came from (where did it come from?)' : 'Destination / Came from';
    lastSeen.clear();
    renderSession();
  }
  $('btnLoadOut').addEventListener('click', () => setAction('LOAD_OUT'));
  $('btnUnloadIn').addEventListener('click', () => setAction('UNLOAD_IN'));

  // Is this a genuine label from this system (made on any device)?
  // Returns { customer } or null.
  let genuineCache = null, genuineKey = null;
  function genuineLookup(id) {
    if (!DEMO_FIXED_IDS) return null;
    const key = settings.customers.map((c) => c.trim().toLowerCase()).join('|');
    if (!genuineCache || key !== genuineKey) {
      genuineCache = new Map();
      const main = seededIds(STREAM_LOOKAHEAD);
      main.slice(0, 30).forEach((x, i) => genuineCache.set(x, sampleCustomer(i)));
      settings.customers.forEach((c) => {
        seededIdsFrom(customerSeed(c), STREAM_LOOKAHEAD).forEach((x) => { if (!genuineCache.has(x)) genuineCache.set(x, c); });
      });
      main.slice(30).forEach((x) => { if (!genuineCache.has(x)) genuineCache.set(x, ''); });
      genuineKey = key;
    }
    return genuineCache.has(id) ? { customer: genuineCache.get(id) } : null;
  }
  // Make sure a genuine pallet is known on this device. A label printed on
  // another device (or before "Load sample data" / "Reset all") is added
  // automatically the first time it is scanned. Returns true if known.
  function ensurePallet(id) {
    if (palletMap.has(id)) return true;
    const g = isValidId(id) ? genuineLookup(id) : null;
    if (!g) return false;
    pallets.push({ id: id, createdAt: new Date().toISOString(), customer: g.customer });
    try { save(KEYS.pallets, pallets); } catch (e) { /* storage full: still usable this session */ }
    rebuildIndex();
    return true;
  }

  function warningsFor(id) {
    const w = [];
    if (!palletMap.has(id)) {
      w.push({ bad: true, text: 'This pallet is not in the system. If its label was made on another device for a new customer, add that customer in Settings with the same name.' });
      return w;
    }
    const st = palletState(id);
    if (currentAction === 'LOAD_OUT' && st.status === 'OUT') w.push({ text: 'This pallet is already marked as OUT.' });
    if (currentAction === 'UNLOAD_IN' && st.status === 'AT_WAREHOUSE') w.push({ text: 'This pallet is already marked as AT WAREHOUSE.' });
    return w;
  }

  function showLast(kind, html) {
    const el = $('lastScan');
    el.className = 'last-scan ' + kind;
    el.innerHTML = html;
    el.hidden = false;
    const f = $('scanFlash');
    f.className = 'scan-flash ' + (kind === 'info' ? 'ok' : kind);
    clearTimeout(showLast.t);
    showLast.t = setTimeout(() => { f.className = 'scan-flash'; }, 450);
  }

  // Main entry for every scanned or typed code.
  function handleCode(raw, source) {
    const code = String(raw || '').trim();
    if (!code) return;
    const now = Date.now();
    if (source === 'camera') {
      const t = lastSeen.get(code);
      lastSeen.set(code, now);
      if (t && now - t < DUP_WINDOW_MS) return; // same code still in view
    }

    // Location card
    if (/^LOC:/i.test(code)) {
      const name = code.slice(4).trim();
      if (!name) return;
      setLocation(name);
      showLast('info', '📍 Location set: <span class="id">' + esc(name) + '</span>');
      feedbackSound('info');
      return;
    }

    const id = normalizeId(code);
    if (!looksLikePalletId(id)) {
      showLast('bad', '✖ ' + (source === 'camera' ? 'This is not a pallet QR code.' : 'Pallet ID looks like PLT-7K3M9QX.') +
        '<small>' + esc(code.slice(0, 60)) + '</small>');
      feedbackSound('bad');
      return;
    }
    if (!isValidId(id)) {
      showLast('bad', '✖ This pallet is not in the system.<small><span class="id">' + esc(id) + '</span> — wrong ID. Check every letter.</small>');
      feedbackSound('bad');
      return;
    }
    ensurePallet(id);
    if (!currentAction) {
      showLast('bad', '✖ First tap LOAD OUT or UNLOAD IN.');
      feedbackSound('bad');
      const row = document.querySelector('.action-row');
      row.classList.remove('need'); void row.offsetWidth; row.classList.add('need');
      lastSeen.delete(code);
      return;
    }
    if (session.items.some((it) => it.palletId === id)) {
      showLast('info', 'Already in the list: <span class="id">' + esc(id) + '</span>');
      return;
    }

    session.items.push({ palletId: id, scannedAt: new Date().toISOString(), condition: defaultCond });
    saveSession();
    const w = warningsFor(id);
    const n = session.items.length;
    if (w.length) {
      showLast(w[0].bad ? 'bad' : 'warn', '⚠ <span class="id">' + esc(id) + '</span> added (' + n + ')<small>' + esc(w.map((x) => x.text).join(' ')) + '</small>');
      feedbackSound('warn');
    } else {
      showLast('ok', '✔ <span class="id">' + esc(id) + '</span> added<small>' + n + ' pallet' + (n === 1 ? '' : 's') + ' in this list</small>');
      feedbackSound('ok');
    }
    renderSession();
  }

  function renderSession() {
    const list = $('sessionList');
    const items = session.items.slice().reverse();
    list.innerHTML = items.map((it) => {
      const w = warningsFor(it.palletId);
      const dmg = it.condition === 'DAMAGED';
      return '<li class="session-item" data-id="' + esc(it.palletId) + '">' +
        '<div class="si-main"><div class="si-id">' + esc(it.palletId) + '</div>' +
        (customerOf(it.palletId) ? '<div class="si-cust">' + esc(customerOf(it.palletId)) + '</div>' : '') +
        '<div class="si-time">' + fmtTime(it.scannedAt) + '</div>' +
        w.map((x) => '<div class="si-warn' + (x.bad ? ' bad' : '') + '">⚠ ' + esc(x.text) + '</div>').join('') +
        '</div>' +
        '<button type="button" class="cond-toggle' + (dmg ? ' damaged' : '') + '" data-act="cond">' + (dmg ? 'Damaged' : 'OK') + '</button>' +
        '<button type="button" class="si-remove" data-act="remove" aria-label="Remove from list">×</button>' +
        '</li>';
    }).join('');
    const n = session.items.length;
    $('sessionCount').textContent = n;
    $('sessionEmpty').hidden = n > 0;
    $('btnClearSession').hidden = n === 0;
    const btn = $('btnConfirm');
    btn.disabled = n === 0;
    document.querySelector('.confirm-bar').hidden = n === 0;
    btn.innerHTML = n === 0 ? 'CONFIRM' :
      'CONFIRM ' + n + ' PALLET' + (n === 1 ? '' : 'S') + (currentAction ? ' · ' + (currentAction === 'LOAD_OUT' ? 'LOAD OUT' : 'UNLOAD IN') : '');
  }

  $('sessionList').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.closest('.session-item').dataset.id;
    const idx = session.items.findIndex((it) => it.palletId === id);
    if (idx < 0) return;
    if (btn.dataset.act === 'remove') {
      session.items.splice(idx, 1);
      lastSeen.delete(id);
    } else if (btn.dataset.act === 'cond') {
      session.items[idx].condition = session.items[idx].condition === 'DAMAGED' ? 'OK' : 'DAMAGED';
    }
    saveSession();
    renderSession();
  });
  $('btnClearSession').addEventListener('click', () => {
    if (!confirm('Remove all ' + session.items.length + ' pallets from this list? (Nothing is saved yet.)')) return;
    session.items = [];
    lastSeen.clear();
    saveSession();
    renderSession();
  });

  $('manualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('manualInput');
    if (!inp.value.trim()) return;
    handleCode(inp.value, 'manual');
    inp.value = '';
  });

  $('condSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    defaultCond = b.dataset.cond;
    document.querySelectorAll('#condSeg .seg-btn').forEach((x) => x.classList.toggle('on', x === b));
  });

  // Photo: compress to ~300px wide JPEG.
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = Math.min(300, img.naturalWidth);
        const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
      img.src = url;
    });
  }
  // The phone camera app needs the camera, so pause our scanner first.
  document.querySelector('label[for="fPhoto"]').addEventListener('click', () => camStop(true));
  $('fPhoto').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) {
      try {
        batchPhoto = await compressImage(f);
        $('photoPreview').src = batchPhoto;
        $('photoPreview').hidden = false;
        $('btnPhotoRemove').hidden = false;
      } catch (err) { toast('Could not use this photo.', 'bad'); }
    }
    resumeCamIfWanted();
  });
  $('btnPhotoRemove').addEventListener('click', () => {
    batchPhoto = '';
    $('photoPreview').hidden = true;
    $('btnPhotoRemove').hidden = true;
  });

  function clearDetails() {
    ['fVehicle', 'fParty', 'fChallan', 'fRemarks'].forEach((id) => { $(id).value = ''; });
    $('btnPhotoRemove').click();
    defaultCond = 'OK';
    document.querySelectorAll('#condSeg .seg-btn').forEach((x) => x.classList.toggle('on', x.dataset.cond === 'OK'));
  }

  $('btnConfirm').addEventListener('click', () => {
    if (!session.items.length) return;
    if (!currentAction) {
      toast('First tap LOAD OUT or UNLOAD IN.', 'bad');
      const row = document.querySelector('.action-row');
      row.classList.remove('need'); void row.offsetWidth; row.classList.add('need');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const loc = $('locSelect').value || currentLocation();
    const common = {
      action: currentAction,
      location: loc,
      scannedBy: settings.userName || 'Floor Staff',
      vehicleNo: $('fVehicle').value.trim().toUpperCase(),
      party: $('fParty').value.trim(),
      challanNo: $('fChallan').value.trim(),
      remarks: $('fRemarks').value.trim()
    };

    function trySave(withPhoto) {
      let photoRef = '';
      const newPhotos = Object.assign({}, photos);
      if (withPhoto && batchPhoto) {
        photoRef = 'ph_' + uuid();       // one photo stored once, shared by this batch
        newPhotos[photoRef] = batchPhoto;
      }
      const newScans = session.items.map((it) => Object.assign({
        scanId: uuid(),
        palletId: it.palletId,
        timestamp: it.scannedAt,
        condition: it.condition
      }, common, { photo: photoRef }));
      const all = scans.concat(newScans);
      if (photoRef) save(KEYS.photos, newPhotos);
      try { save(KEYS.scans, all); } catch (e) {
        if (photoRef) { try { save(KEYS.photos, photos); } catch (e2) { /* ignore */ } }
        throw e;
      }
      scans = all;
      photos = newPhotos;
    }

    try {
      trySave(true);
    } catch (e) {
      if (batchPhoto && confirm('Phone storage is full. Save without the photo?')) {
        try { trySave(false); } catch (e2) { toast('Storage is full. Could not save. Export CSV and Reset.', 'bad', 5000); return; }
      } else {
        toast('Storage is full. Could not save.', 'bad', 5000);
        return;
      }
    }

    const n = session.items.length;
    rebuildIndex();
    session.items = [];
    saveSession();
    lastSeen.clear();
    clearDetails();
    renderSession();
    renderPartyList();
    const label = common.action === 'LOAD_OUT' ? 'LOAD OUT' : 'UNLOAD IN';
    showLast('ok', '✔ Saved ' + n + ' pallet' + (n === 1 ? '' : 's') + ' as ' + label + '<small>at ' + esc(loc) + '</small>');
    toast('✔ Saved ' + n + ' pallet' + (n === 1 ? '' : 's') + ' as ' + label, 'ok', 3500);
    feedbackSound('saved');
  });

  function renderPartyList() {
    const parties = Array.from(new Set(scans.map((s) => s.party).filter(Boolean))).sort();
    $('partyList').innerHTML = parties.map((p) => '<option value="' + esc(p) + '">').join('');
  }

  // ------------------------------------------------------------------
  // Camera (html5-qrcode). Works on Android Chrome and iPhone Safari.
  // ------------------------------------------------------------------
  const cam = { scanner: null, running: false, busy: false, want: false, torchOn: false };

  function newScanner(elId) {
    const opts = { verbose: false };
    if (window.Html5QrcodeSupportedFormats) opts.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
    // Uses the fast built-in detector on Android; falls back to JS decoding on iPhone.
    opts.experimentalFeatures = { useBarCodeDetectorIfSupported: true };
    return new Html5Qrcode(elId, opts);
  }
  function qrboxFn(w, h) {
    const s = Math.max(160, Math.floor(Math.min(w, h) * 0.78));
    return { width: s, height: s };
  }
  function camErrorText(err) {
    const s = String((err && (err.name || err.message)) || err || '');
    if (!window.isSecureContext) return 'Camera needs an https:// link. Open the hosted link on the phone.';
    if (/NotAllowed|Permission/i.test(s)) return 'Camera is blocked. Allow camera for this site in browser settings, then tap Start camera.';
    if (/NotFound|Requested device not found|OverconstrainedError/i.test(s)) return 'No camera found on this device.';
    if (/NotReadable|in use/i.test(s)) return 'Camera is busy in another app. Close it and try again.';
    return 'Could not start camera. ' + s.slice(0, 120);
  }
  async function startWithFallback(scanner, onDecode) {
    const base = { fps: 12, qrbox: qrboxFn, disableFlip: true };
    try {
      // Ask for HD so small or far-away labels still read.
      await scanner.start({ facingMode: 'environment' },
        Object.assign({}, base, { videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } }),
        onDecode, () => {});
    } catch (e) {
      if (/NotAllowed|Permission/i.test(String(e && (e.name || e)))) throw e;
      await scanner.start({ facingMode: 'environment' }, base, onDecode, () => {});
    }
  }

  async function camStart() {
    if (cam.running || cam.busy) return;
    cam.want = true;
    unlockAudio();
    if (!window.Html5Qrcode) { $('camHint').textContent = 'Scanner did not load. Check internet and reload.'; return; }
    if (!window.isSecureContext) { $('camHint').textContent = camErrorText(); return; }
    cam.busy = true;
    $('btnStartCam').disabled = true;
    $('camHint').textContent = 'Starting camera…';
    try {
      if (!cam.scanner) cam.scanner = newScanner('reader');
      await startWithFallback(cam.scanner, (text) => handleCode(text, 'camera'));
      cam.running = true;
      $('scannerIdle').hidden = true;
      $('camTools').hidden = false;
      setupCamTools();
      // User may have left the tab while the camera was starting.
      if (currentTab !== 'scan' || document.hidden) camStop(true);
    } catch (err) {
      cam.want = false;
      $('camHint').textContent = camErrorText(err);
    } finally {
      cam.busy = false;
      $('btnStartCam').disabled = false;
    }
  }
  async function camStop(keepWant) {
    if (!keepWant) cam.want = false;
    if (!cam.running || !cam.scanner) return;
    cam.running = false;
    try { await cam.scanner.stop(); } catch (e) { /* already stopped */ }
    cam.torchOn = false;
    $('scannerIdle').hidden = false;
    $('camTools').hidden = true;
    $('camHint').textContent = 'Point the camera at the QR on the pallet.';
  }
  function resumeCamIfWanted() {
    if (cam.want && !cam.running && !cam.busy && currentTab === 'scan' && !document.hidden) {
      setTimeout(() => { if (cam.want && !cam.running && currentTab === 'scan') camStart(); }, 300);
    }
  }
  function setupCamTools() {
    $('btnTorch').hidden = true;
    $('zoomWrap').hidden = true;
    try {
      const caps = cam.scanner.getRunningTrackCameraCapabilities();
      const torch = caps.torchFeature();
      if (torch.isSupported()) {
        $('btnTorch').hidden = false;
        $('btnTorch').textContent = '🔦 Light';
      }
      const zoom = caps.zoomFeature();
      if (zoom.isSupported()) {
        const r = $('zoomRange');
        r.min = zoom.min(); r.max = zoom.max(); r.step = zoom.step() || 0.1;
        r.value = zoom.value() || zoom.min();
        $('zoomWrap').hidden = false;
      }
    } catch (e) { /* not supported (e.g. iPhone) */ }
  }
  $('btnStartCam').addEventListener('click', camStart);
  $('btnStopCam').addEventListener('click', () => camStop(false));
  $('btnTorch').addEventListener('click', async () => {
    try {
      const torch = cam.scanner.getRunningTrackCameraCapabilities().torchFeature();
      cam.torchOn = !cam.torchOn;
      await torch.apply(cam.torchOn);
      $('btnTorch').textContent = cam.torchOn ? '🔦 Light off' : '🔦 Light';
    } catch (e) { toast('Light not available.', 'bad'); }
  });
  $('zoomRange').addEventListener('input', (e) => {
    try { cam.scanner.getRunningTrackCameraCapabilities().zoomFeature().apply(Number(e.target.value)); } catch (err) { /* ignore */ }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { camStop(true); stopModalScanner(); }
    else resumeCamIfWanted();
  });
  window.addEventListener('focus', resumeCamIfWanted);

  // ------------------------------------------------------------------
  // HISTORY
  // ------------------------------------------------------------------
  function renderHistoryIdList() {
    $('palletIdList').innerHTML = pallets.map((p) => '<option value="' + esc(p.id) + '">').join('');
  }
  function showHistory(raw) {
    const out = $('historyResult');
    const id = normalizeId(raw);
    $('historyInput').value = id;
    if (!looksLikePalletId(id)) {
      out.innerHTML = '<div class="card"><p class="empty">Pallet ID looks like PLT-7K3M9QX.</p></div>';
      return;
    }
    const mine = scans.filter((s) => s.palletId === id).sort((a, b) => a.timestamp < b.timestamp ? 1 : -1);
    const known = ensurePallet(id);
    if (!known && !mine.length) {
      out.innerHTML = '<div class="card"><div class="big-id">' + esc(id) + '</div><p class="si-warn bad">⚠ This pallet is not in the system.' +
        (isValidId(id) ? '' : ' (Wrong ID — check every letter.)') + '</p></div>';
      return;
    }
    const st = palletState(id);
    const p = palletMap.get(id);
    let html = '<div class="card status-card">' +
      '<div class="big-id">' + esc(id) + '</div>' +
      '<div style="margin-top:6px">' + statusBadge(st) + (known ? '' : ' <span class="badge dmg">NOT IN SYSTEM</span>') + '</div>' +
      '<div class="status-grid">' +
      stat('Customer (rented to)', customerOf(id) || '—') +
      stat('Last location', st.last ? st.last.location : 'Not scanned yet') +
      stat('Days since last scan', st.last ? daysText(daysSince(st.last.timestamp)) : '—') +
      stat('Last scan', st.last ? fmtDateTime(st.last.timestamp) : '—') +
      stat('Total scans', String(mine.length)) +
      (st.status === 'OUT' && st.lastOut && st.lastOut.party ? stat('Went to', st.lastOut.party) : '') +
      (p ? stat('Added on', fmtDateTime(p.createdAt)) : '') +
      '</div></div>';

    html += '<div class="card"><div class="field-label">Journey (newest first)</div>';
    if (!mine.length) html += '<p class="empty">No scans yet. This pallet is at the warehouse.</p>';
    else {
      html += '<ul class="timeline">' + mine.map((s) => {
        const partyLabel = s.action === 'LOAD_OUT' ? 'Destination' : 'Came from';
        const meta = [
          ['Location', s.location], ['By', s.scannedBy], ['Vehicle', s.vehicleNo],
          [partyLabel, s.party], ['Challan', s.challanNo], ['Remarks', s.remarks]
        ].filter((m) => m[1]).map((m) => esc(m[0]) + ': <b>' + esc(m[1]) + '</b>').join(' · ');
        const ph = s.photo ? (photos[s.photo] || (s.photo.startsWith('data:') ? s.photo : '')) : '';
        return '<li class="tl-item"><span class="tl-dot ' + (s.action === 'LOAD_OUT' ? 'out' : 'in') + '"></span>' +
          '<div class="tl-head"><span class="tl-when">' + fmtDateTime(s.timestamp) + '</span>' + actionBadge(s.action) +
          (s.condition === 'DAMAGED' ? '<span class="badge dmg">DAMAGED</span>' : '<span class="badge in" style="opacity:.7">OK</span>') + '</div>' +
          '<div class="tl-meta">' + meta + '</div>' +
          (ph ? '<img class="tl-photo" src="' + ph + '" alt="Scan photo">' : '') +
          '</li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    out.innerHTML = html;
  }
  function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }

  $('historyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('historyInput').value.trim()) showHistory($('historyInput').value);
  });
  $('historyResult').addEventListener('click', (e) => {
    if (e.target.classList.contains('tl-photo')) {
      $('photoBig').src = e.target.src;
      $('photoModal').hidden = false;
    }
  });
  $('btnClosePhoto').addEventListener('click', () => { $('photoModal').hidden = true; });

  // Scanner modal for History
  let modalScanner = null, modalRunning = false;
  async function openModalScanner() {
    unlockAudio();
    if (!window.isSecureContext) { toast('Camera needs an https:// link.', 'bad', 4000); return; }
    $('scanModal').hidden = false;
    try {
      if (!modalScanner) modalScanner = newScanner('readerModal');
      await startWithFallback(modalScanner, (text) => {
        const t = text.trim();
        if (/^LOC:/i.test(t)) { toast('That is a location card. Scan a pallet.', 'bad'); return; }
        feedbackSound('ok');
        stopModalScanner();
        showHistory(t);
      });
      modalRunning = true;
      if ($('scanModal').hidden) stopModalScanner();
    } catch (err) {
      $('scanModal').hidden = true;
      toast(camErrorText(err), 'bad', 5000);
    }
  }
  async function stopModalScanner() {
    $('scanModal').hidden = true;
    if (!modalRunning || !modalScanner) return;
    modalRunning = false;
    try { await modalScanner.stop(); } catch (e) { /* ignore */ }
  }
  $('btnHistoryScan').addEventListener('click', openModalScanner);
  $('btnCloseModal').addEventListener('click', stopModalScanner);

  // ------------------------------------------------------------------
  // DASHBOARD
  // ------------------------------------------------------------------
  let sortKey = 'days', sortDir = 'desc', statusFilter = 'ALL', customerFilter = 'ALL', dashSearch = '';
  const NO_CUSTOMER = '__none__';

  function allCustomerNames() {
    const names = new Set(settings.customers);
    pallets.forEach((p) => { if (p.customer) names.add(p.customer); });
    return Array.from(names);
  }
  function customerOptions(allLabel, includeNone) {
    let html = allLabel ? '<option value="ALL">' + esc(allLabel) + '</option>' : '';
    html += allCustomerNames().map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    if (includeNone) html += '<option value="' + NO_CUSTOMER + '">No customer name</option>';
    return html;
  }
  function matchCustomer(p, f) {
    if (f === 'ALL') return true;
    if (f === NO_CUSTOMER) return !p.customer;
    return p.customer === f;
  }

  function dashRows() {
    return pallets.filter((p) => matchCustomer(p, customerFilter)).map((p) => {
      const st = palletState(p.id);
      return {
        id: p.id,
        customer: p.customer || '',
        st: st,
        status: st.status,
        damaged: st.damaged,
        days: st.last ? daysSince(st.last.timestamp) : null,
        last: st.last ? st.last.timestamp : '',
        location: st.last ? st.last.location : '',
        dest: st.lastOut ? st.lastOut.party : ''
      };
    });
  }
  function renderDashboard() {
    const cf = $('customerFilter');
    cf.innerHTML = customerOptions('All customers', pallets.some((p) => !p.customer));
    if (![...cf.options].some((o) => o.value === customerFilter)) customerFilter = 'ALL';
    cf.value = customerFilter;
    const rows = dashRows();
    const counts = {
      ALL: rows.length,
      AT_WAREHOUSE: rows.filter((r) => r.status === 'AT_WAREHOUSE').length,
      OUT: rows.filter((r) => r.status === 'OUT').length,
      DAMAGED: rows.filter((r) => r.damaged).length
    };
    const tiles = [['ALL', 'Total pallets', ''], ['AT_WAREHOUSE', 'At warehouse', 't-in'], ['OUT', 'Out with FG', 't-out'], ['DAMAGED', 'Damaged', 't-dmg']];
    $('tiles').innerHTML = tiles.map((t) =>
      '<button type="button" class="tile ' + t[2] + (statusFilter === t[0] ? ' on' : '') + '" data-f="' + t[0] + '">' +
      '<div class="n">' + counts[t[0]] + '</div><div class="l">' + t[1] + '</div></button>').join('');
    $('statusFilter').value = statusFilter;

    const q = dashSearch.trim().toLowerCase();
    $('dashSearch').value = dashSearch;
    let list = rows.filter((r) => statusFilter === 'ALL' ? true : statusFilter === 'DAMAGED' ? r.damaged : r.status === statusFilter)
      .filter((r) => !q || [r.id, r.customer, r.dest, r.location].some((v) => (v || '').toLowerCase().includes(q)));
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'status') { va = a.status + (a.damaged ? 'D' : ''); vb = b.status + (b.damaged ? 'D' : ''); }
      const ea = va == null || va === '', eb = vb == null || vb === '';
      if (ea && eb) return a.id < b.id ? -1 : 1;
      if (ea) return 1;               // empty values always at the bottom
      if (eb) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.id < b.id ? -1 : 1;
    });

    document.querySelectorAll('#dashTable th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === sortKey);
      th.classList.toggle('asc', th.dataset.sort === sortKey && sortDir === 'asc');
    });
    $('dashTable').querySelector('tbody').innerHTML = list.map((r) =>
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="mono">' + esc(r.id) + '</td>' +
      '<td class="days">' + (r.days == null ? '—' : r.days) + '</td>' +
      '<td>' + statusBadge(r.st) + '</td>' +
      '<td>' + esc(r.customer || '—') + '</td>' +
      '<td>' + esc(r.dest || '—') + '</td>' +
      '<td class="nowrap">' + (r.last ? esc(fmtDateTime(r.last)) : 'Not scanned') + '</td>' +
      '<td>' + esc(r.location || '—') + '</td>' +
      '</tr>').join('');
    $('dashEmpty').hidden = rows.length > 0;
    $('dashCount').textContent = rows.length ? 'Showing ' + list.length + ' of ' + rows.length + ' pallets.' : '';
  }
  // Open the dashboard with filters already set (used by the Inventory page).
  function openDashboard(opts) {
    customerFilter = opts.customer || 'ALL';
    statusFilter = opts.status || 'ALL';
    dashSearch = opts.search || '';
    goTab('dashboard');
  }
  $('tiles').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    statusFilter = t.dataset.f;
    renderDashboard();
  });
  $('statusFilter').addEventListener('change', (e) => { statusFilter = e.target.value; renderDashboard(); });
  $('customerFilter').addEventListener('change', (e) => { customerFilter = e.target.value; renderDashboard(); });
  $('dashSearch').addEventListener('input', (e) => { dashSearch = e.target.value; renderDashboard(); });
  document.querySelectorAll('#dashTable th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = k; sortDir = (k === 'days' || k === 'last') ? 'desc' : 'asc'; }
    renderDashboard();
  }));
  $('dashTable').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    goTab('history');
    showHistory(tr.dataset.id);
  });

  // CSV export
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $('btnExport').addEventListener('click', async () => {
    if (!scans.length) { toast('No scans to export yet.', 'bad'); return; }
    const head = ['scanId', 'palletId', 'customer', 'date', 'time', 'timestamp', 'action', 'location', 'scannedBy', 'condition', 'vehicleNo', 'party', 'challanNo', 'remarks', 'hasPhoto'];
    const rows = scans.slice().sort((a, b) => a.timestamp < b.timestamp ? -1 : 1).map((s) => {
      const d = new Date(s.timestamp);
      return [s.scanId, s.palletId, customerOf(s.palletId), d.toLocaleDateString('en-CA'), d.toLocaleTimeString('en-GB'), s.timestamp, s.action, s.location,
        s.scannedBy, s.condition, s.vehicleNo, s.party, s.challanNo, s.remarks, s.photo ? 'yes' : 'no'].map(csvCell).join(',');
    });
    const name = 'pallet-scans-' + new Date().toLocaleDateString('en-CA') + '.csv';
    if (await saveCsv(name, head, rows)) toast('CSV file downloaded: ' + scans.length + ' scans', 'ok');
  });

  // Share (phones) or download (computers) a CSV. Returns true when downloaded.
  async function saveCsv(name, head, rows) {
    const csv = '\ufeff' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    // On phones, offer the share sheet (WhatsApp, email, Files). Else download.
    try {
      const file = new File([blob], name, { type: 'text/csv' });
      if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return false;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  // ------------------------------------------------------------------
  // INVENTORY: pallets assigned to each customer and where they are now
  // ------------------------------------------------------------------
  function inventoryData() {
    const blank = () => ({ assigned: 0, atWh: 0, out: 0, damaged: 0, longestOut: null, lastTs: '' });
    const byCust = new Map();
    // every customer in Settings is listed, even with 0 pallets
    settings.customers.forEach((c) => byCust.set(c, blank()));
    const byDest = new Map(), byLoc = new Map();
    pallets.forEach((p) => {
      const key = p.customer || NO_CUSTOMER;
      if (!byCust.has(key)) byCust.set(key, blank());
      const c = byCust.get(key);
      const st = palletState(p.id);
      c.assigned++;
      if (st.damaged) c.damaged++;
      if (st.last && st.last.timestamp > c.lastTs) c.lastTs = st.last.timestamp;
      if (st.status === 'OUT') {
        c.out++;
        const days = daysSince(st.last.timestamp);
        c.longestOut = Math.max(c.longestOut == null ? 0 : c.longestOut, days);
        const dk = (st.lastOut && st.lastOut.party) || '';
        if (!byDest.has(dk)) byDest.set(dk, { count: 0, longestOut: 0, customers: new Set() });
        const d = byDest.get(dk);
        d.count++;
        d.longestOut = Math.max(d.longestOut, days);
        if (p.customer) d.customers.add(p.customer);
      } else {
        c.atWh++;
        const lk = st.last ? st.last.location : '';
        if (!byLoc.has(lk)) byLoc.set(lk, { count: 0, damaged: 0 });
        const l = byLoc.get(lk);
        l.count++;
        if (st.damaged) l.damaged++;
      }
    });
    const customers = Array.from(byCust.entries()).map(([key, c]) => Object.assign({ key: key }, c))
      .sort((a, b) => (a.key === NO_CUSTOMER) - (b.key === NO_CUSTOMER) || b.assigned - a.assigned || a.key.localeCompare(b.key));
    const dests = Array.from(byDest.entries())
      .map(([key, d]) => ({ key: key, count: d.count, longestOut: d.longestOut, customers: Array.from(d.customers).sort() }))
      .sort((a, b) => b.longestOut - a.longestOut || b.count - a.count);
    const locs = Array.from(byLoc.entries()).map(([key, l]) => ({ key: key, count: l.count, damaged: l.damaged }))
      .sort((a, b) => b.count - a.count);
    return { customers: customers, dests: dests, locs: locs };
  }
  function custLabel(key) { return key === NO_CUSTOMER ? 'No customer name' : key; }
  function numCell(n) { return '<td class="num' + (n ? '' : ' zero') + '">' + n + '</td>'; }
  function splitBar(atWh, out) {
    const t = atWh + out;
    if (!t) return '<span class="hint">—</span>';
    return '<div class="split" title="' + atWh + ' at warehouse, ' + out + ' out with FG">' +
      '<span class="s-in" style="width:' + (atWh / t * 100) + '%"></span>' +
      '<span class="s-out" style="width:' + (out / t * 100) + '%"></span></div>';
  }
  function renderInventory() {
    const inv = inventoryData();
    const tot = inv.customers.reduce((a, c) => {
      a.assigned += c.assigned; a.atWh += c.atWh; a.out += c.out; a.damaged += c.damaged;
      if (c.longestOut != null) a.longestOut = Math.max(a.longestOut == null ? 0 : a.longestOut, c.longestOut);
      if (c.lastTs > a.lastTs) a.lastTs = c.lastTs;
      return a;
    }, { assigned: 0, atWh: 0, out: 0, damaged: 0, longestOut: null, lastTs: '' });

    const ct = $('invCustomerTable');
    ct.querySelector('tbody').innerHTML = inv.customers.map((c) =>
      '<tr data-customer="' + esc(c.key) + '">' +
      '<td><b>' + esc(custLabel(c.key)) + '</b></td>' +
      numCell(c.assigned) + numCell(c.atWh) + numCell(c.out) + numCell(c.damaged) +
      '<td>' + splitBar(c.atWh, c.out) + '</td>' +
      '<td class="num">' + (c.longestOut == null ? '—' : c.longestOut) + '</td>' +
      '<td class="nowrap">' + (c.lastTs ? esc(fmtDateTime(c.lastTs)) : '—') + '</td>' +
      '</tr>').join('') || '<tr><td colspan="8" class="empty">No pallets yet.</td></tr>';
    ct.querySelector('tfoot').innerHTML = inv.customers.length ?
      '<tr><td>Total</td>' + numCell(tot.assigned) + numCell(tot.atWh) + numCell(tot.out) + numCell(tot.damaged) +
      '<td>' + splitBar(tot.atWh, tot.out) +
      '<div class="split-legend"><span><i style="background:var(--in)"></i>At warehouse</span><span><i style="background:var(--out)"></i>Out with FG</span></div></td>' +
      '<td class="num">' + (tot.longestOut == null ? '—' : tot.longestOut) + '</td>' +
      '<td>' + (tot.lastTs ? esc(fmtDateTime(tot.lastTs)) : '—') + '</td></tr>' : '';

    $('invDestTable').querySelector('tbody').innerHTML = inv.dests.map((d) =>
      '<tr data-dest="' + esc(d.key) + '">' +
      '<td><b>' + esc(d.key || 'Not entered') + '</b></td>' + numCell(d.count) +
      '<td class="num">' + d.longestOut + '</td>' +
      '<td>' + esc(d.customers.join(', ') || '—') + '</td></tr>').join('') ||
      '<tr><td colspan="4" class="empty">No pallets are out right now.</td></tr>';

    $('invLocTable').querySelector('tbody').innerHTML = inv.locs.map((l) =>
      '<tr data-loc="' + esc(l.key) + '">' +
      '<td><b>' + esc(l.key || 'Not scanned yet') + '</b></td>' + numCell(l.count) + numCell(l.damaged) + '</tr>').join('') ||
      '<tr><td colspan="3" class="empty">No pallets at the warehouse.</td></tr>';
  }
  $('invCustomerTable').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-customer]');
    if (tr) openDashboard({ customer: tr.dataset.customer });
  });
  $('invDestTable').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-dest]');
    if (tr) openDashboard({ status: 'OUT', search: tr.dataset.dest });
  });
  $('invLocTable').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-loc]');
    if (tr) openDashboard({ status: 'AT_WAREHOUSE', search: tr.dataset.loc });
  });
  $('btnInvExport').addEventListener('click', async () => {
    const inv = inventoryData();
    if (!inv.customers.length) { toast('Nothing to export yet.', 'bad'); return; }
    const head = ['customer', 'assigned', 'atWarehouse', 'outWithFG', 'damaged', 'longestOutDays', 'lastActivity'];
    const rows = inv.customers.map((c) => [custLabel(c.key), c.assigned, c.atWh, c.out, c.damaged,
      c.longestOut == null ? '' : c.longestOut,
      c.lastTs ? new Date(c.lastTs).toLocaleDateString('en-CA') + ' ' + new Date(c.lastTs).toLocaleTimeString('en-GB') : ''].map(csvCell).join(','));
    if (await saveCsv('pallet-inventory-' + new Date().toLocaleDateString('en-CA') + '.csv', head, rows)) toast('Inventory CSV downloaded', 'ok');
  });

  // ------------------------------------------------------------------
  // QR CODES
  // ------------------------------------------------------------------
  function qrSvg(text) {
    const qr = qrcode(0, 'H');   // error correction level H
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), m = 4, size = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  let printFilter = 'ALL';
  let genCustomer = null; // remembered choice in the "Rented to" dropdown

  function labelPallets() {
    const batch = printFilter.startsWith('batch:') ? printFilter.slice(6) : null;
    return pallets.filter((p) => batch ? p.batch === batch : matchCustomer(p, printFilter))
      .sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }
  // Each "Generate pallets" click is one batch, so it can be printed on its own.
  function batchList() {
    const map = new Map();
    pallets.forEach((p) => {
      if (!p.batch) return;
      if (!map.has(p.batch)) map.set(p.batch, { id: p.batch, customer: p.customer || '', count: 0 });
      map.get(p.batch).count++;
    });
    return Array.from(map.values()).sort((a, b) => (a.id < b.id ? 1 : -1));
  }
  function renderQr() {
    // "Rented to" dropdown
    const gc = $('genCustomer');
    gc.innerHTML = customerOptions('', false) + '<option value="' + NO_CUSTOMER + '">No name (blank)</option>' +
      '<option value="__add__">+ Add new customer…</option>';
    if (genCustomer == null || ![...gc.options].some((o) => o.value === genCustomer)) genCustomer = gc.options[0].value;
    gc.value = genCustomer;

    // "Show labels for" dropdown
    const pc = $('printCustomer');
    const batches = batchList();
    pc.innerHTML = (batches.length ? '<optgroup label="Generated batches">' + batches.map((b) =>
      '<option value="batch:' + esc(b.id) + '">' + esc(fmtDateTime(b.id)) + ' · ' + esc(b.customer || 'No customer name') +
      ' · ' + b.count + ' label' + (b.count === 1 ? '' : 's') + '</option>').join('') + '</optgroup>' : '') +
      '<optgroup label="All pallets of">' + customerOptions('All customers', pallets.some((p) => !p.customer)) + '</optgroup>';
    if (![...pc.options].some((o) => o.value === printFilter)) printFilter = 'ALL';
    pc.value = printFilter;

    const list = labelPallets();
    $('palletLabels').innerHTML = list.map((p) =>
      '<div class="label">' + qrSvg(p.id) + '<div class="lid">' + esc(p.id) + '</div>' +
      (p.customer ? '<div class="lcust">' + esc(p.customer) + '</div>' : '') + '</div>').join('') ||
      '<p class="empty">No pallets here yet. Tap "Generate pallets".</p>';
    $('locationCards').innerHTML = settings.locations.map((l) =>
      '<div class="loc-card"><div class="ltag">LOCATION</div>' + qrSvg('LOC:' + l) + '<div class="lname">' + esc(l) + '</div></div>').join('');
    $('palletCountHint').textContent = pallets.length + ' pallets in the system.';
    document.querySelector('#sheetPallets .sheet-title').textContent =
      'Pallet labels (' + list.length + ')' + (printFilter === 'ALL' ? '' : printFilter.startsWith('batch:') ? ' — ' + pc.selectedOptions[0].text :
        printFilter === NO_CUSTOMER ? ' — no customer name' : ' — ' + printFilter);
  }
  $('genCustomer').addEventListener('change', (e) => {
    if (e.target.value === '__add__') {
      const name = (prompt('New customer name') || '').trim();
      if (name) {
        if (!settings.customers.includes(name)) settings.customers.push(name);
        persistSettings();
        genCustomer = name;
      }
      renderQr();
      return;
    }
    genCustomer = e.target.value;
  });
  $('printCustomer').addEventListener('change', (e) => { printFilter = e.target.value; renderQr(); });
  $('btnGenerate').addEventListener('click', () => {
    // Use exactly the number entered: never change it silently.
    const raw = $('genCount').value.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > 200) {
      toast('Enter a whole number from 1 to 200.', 'bad', 3500);
      $('genCount').focus();
      return;
    }
    const customer = genCustomer && genCustomer !== NO_CUSTOMER && genCustomer !== '__add__' ? genCustomer : '';
    const ids = newPalletIds(n, new Set(pallets.map((p) => p.id)), customer);
    const base = Date.now();
    const batch = new Date(base).toISOString();
    const added = ids.map((id, i) => ({ id: id, createdAt: new Date(base + i).toISOString(), customer: customer, batch: batch }));
    try { save(KEYS.pallets, pallets.concat(added)); } catch (e) { toast('Storage is full.', 'bad'); return; }
    pallets = pallets.concat(added);
    rebuildIndex();
    printFilter = 'batch:' + batch; // show exactly this batch, ready to print
    renderQr();
    toast(n + ' new pallets added' + (customer ? ' for ' + customer : ''), 'ok', 3000);
  });
  function printSheet(cls) {
    if (cls === 'print-pallets' && !labelPallets().length) { toast('No labels to print. Generate first.', 'bad'); return; }
    document.body.classList.remove('print-pallets', 'print-locations');
    document.body.classList.add(cls);
    setTimeout(() => window.print(), 50);
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('print-pallets', 'print-locations'));
  $('btnPrintPallets').addEventListener('click', () => printSheet('print-pallets'));
  $('btnPrintLocations').addEventListener('click', () => printSheet('print-locations'));

  // ------------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------------
  function persistSettings() {
    try { save(KEYS.settings, settings); } catch (e) { /* ignore */ }
  }
  function storageUsed() {
    let bytes = 0;
    Object.values(KEYS).forEach((k) => { const v = localStorage.getItem(k); if (v) bytes += v.length * 2; });
    return bytes;
  }
  function renderSettings() {
    $('sUser').value = settings.userName;
    $('sCustomers').value = settings.customers.join('\n');
    $('sLocations').value = settings.locations.join('\n');
    const kb = Math.round(storageUsed() / 1024);
    $('storageInfo').textContent = pallets.length + ' pallets, ' + scans.length + ' scans saved on this device. Space used: about ' + kb + ' KB of ~5,000 KB.';
  }
  $('btnSaveSettings').addEventListener('click', () => {
    const locs = Array.from(new Set($('sLocations').value.split('\n').map((s) => s.trim()).filter(Boolean)));
    if (!locs.length) { toast('Add at least one location.', 'bad'); return; }
    settings.userName = $('sUser').value.trim();
    settings.customers = Array.from(new Set($('sCustomers').value.split('\n').map((s) => s.trim()).filter(Boolean)));
    settings.locations = locs;
    persistSettings();
    renderHeader();
    renderLocations();
    toast('Settings saved', 'ok');
  });
  $('btnSample').addEventListener('click', () => {
    if ((pallets.length || scans.length) && !confirm('Replace all pallets and scans on this phone with sample data?')) return;
    loadSampleData();
    toast('Sample data loaded: ' + pallets.length + ' pallets, ' + scans.length + ' scans', 'ok', 3500);
    renderSettings();
  });
  $('btnReset').addEventListener('click', () => {
    if (!confirm('Delete ALL pallets and scans on this phone? This cannot be undone. (Settings stay.)')) return;
    pallets = []; scans = []; photos = {}; session = { items: [] };
    [KEYS.pallets, KEYS.scans, KEYS.photos, KEYS.session].forEach((k) => localStorage.removeItem(k));
    rebuildIndex();
    renderSession();
    renderSettings();
    toast('All data deleted', 'ok');
  });

  // ------------------------------------------------------------------
  // SAMPLE DATA (~30 pallets, ~120 scans over the last 60 days)
  // ------------------------------------------------------------------
  // Sample pallet i is rented to one of the 3 sample customers (same on every device).
  function sampleCustomer(i) { return SAMPLE_CUSTOMERS[i % SAMPLE_CUSTOMERS.length]; }

  function loadSampleData() {
    const rand = mulberry32(7741);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const customers = [
      'Sunrise Auto Parts, Chakan', 'Kaveri Engineering, Nashik', 'Deccan Wheels, Aurangabad',
      'Apex Forge Works, Satara', 'Nova Tractors, Kolhapur', 'Orbit Appliances, Silvassa',
      'Greenline Pumps, Ahmednagar', 'Vardhan Castings, Sangli'
    ];
    const users = ['Ramesh', 'Suresh', 'Anita', 'Vikas'];
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    const vehicle = () => 'MH' + String(int(10, 50)).padStart(2, '0') + ' ' + letters[int(0, 22)] + letters[int(0, 22)] + ' ' + int(1000, 9999);
    const now = Date.now();
    const when = (daysAgo) => {
      const d = new Date(now - daysAgo * DAY);
      d.setHours(int(8, 18), int(0, 59), int(0, 59), 0);
      if (d.getTime() > now) return new Date(now - int(20, 90) * 60000).toISOString();
      return d.toISOString();
    };

    const ids = seededIds(30);
    const newPallets = ids.map((id, i) => ({ id: id, createdAt: new Date(now - 62 * DAY + i * 60000).toISOString(), customer: sampleCustomer(i) }));
    SAMPLE_CUSTOMERS.forEach((c) => { if (!settings.customers.includes(c)) settings.customers.push(c); });
    persistSettings();
    const out = [];
    const add = (pid, action, daysAgo, party, extra) => {
      out.push(Object.assign({
        scanId: uuid(), palletId: pid, timestamp: when(daysAgo), action: action,
        location: action === 'LOAD_OUT' ? pick(['Dispatch Bay', 'Dispatch Bay', 'Gate 1']) : pick(['Warehouse Dock A', 'Warehouse Dock A', 'Gate 1']),
        scannedBy: pick(users), condition: 'OK', vehicleNo: vehicle(), party: party,
        challanNo: action === 'LOAD_OUT' ? 'DC/26/' + int(1000, 9999) : (rand() < 0.5 ? 'RC/26/' + int(1000, 9999) : ''),
        remarks: '', photo: ''
      }, extra || {}));
    };
    // one round trip: out at loadDay, back at loadDay - dur. Returns day it came back.
    const trip = (pid, loadDay, dur, extraIn) => {
      const party = pick(customers);
      add(pid, 'LOAD_OUT', loadDay, party);
      add(pid, 'UNLOAD_IN', loadDay - dur, party, extraIn);
      return loadDay - dur;
    };

    // Which sample pallets are out (customer of pallet i is i % 3, so this
    // gives ABC 6 out, Mahalaxmi 4 out, Sigma 2 out: a more natural mix).
    const shortOutIdx = [0, 3, 6, 1, 4, 2];
    const longOutIdx = [9, 12, 15, 7, 10, 5];
    const damagedIdx = [8, 13];
    const longOutDays = [50, 46, 42, 38, 34, 31];
    const longOutParties = ['Deccan Wheels, Aurangabad', 'Orbit Appliances, Silvassa', 'Nova Tractors, Kolhapur',
      'Greenline Pumps, Ahmednagar', 'Vardhan Castings, Sangli', 'Apex Forge Works, Satara'];

    ids.forEach((pid, i) => {
      const role = longOutIdx.includes(i) ? 'long' : shortOutIdx.includes(i) ? 'short' : 'back';
      if (role === 'back') {
        // Back at the warehouse after 2–3 round trips.
        let day = int(52, 59);
        const trips = rand() < 0.45 ? 3 : 2;
        for (let t = 0; t < trips; t++) {
          const dur = int(4, 11);
          const last = t === trips - 1;
          const extra = last && damagedIdx.includes(i)
            ? { condition: 'DAMAGED', remarks: i === damagedIdx[0] ? 'Corner bent, needs repair' : 'Weld crack on base' }
            : (rand() < 0.15 ? { remarks: 'Came back with other pallets' } : null);
          const back = trip(pid, day, Math.min(dur, day - 1), extra);
          day = back - int(3, 9);
          if (day < 6) break;
        }
      } else if (role === 'short') {
        // Out now, for only a few days.
        const loadDay = int(1, 7);
        let day = int(40, 56);
        const back = trip(pid, day, int(5, 10));
        if (back - 12 > loadDay + 4) trip(pid, back - int(4, 8), int(4, 7));
        add(pid, 'LOAD_OUT', loadDay, pick(customers));
      } else {
        // Out for a long time (30–50 days).
        const k = longOutIdx.indexOf(i);
        const loadDay = longOutDays[k];
        if (loadDay <= 46) trip(pid, int(loadDay + 7, 59), int(3, 5));
        add(pid, 'LOAD_OUT', loadDay, longOutParties[k], { remarks: k === 0 ? 'Customer said will return next week' : '' });
      }
    });

    pallets = newPallets;
    scans = out;
    photos = {};
    session = { items: [] };
    save(KEYS.pallets, pallets);
    save(KEYS.scans, scans);
    save(KEYS.photos, photos);
    saveSession();
    rebuildIndex();
    renderPartyList();
    renderSession();
    renderHistoryIdList();
  }

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  // Older demo data had no customer on pallets: give the 30 sample pallets
  // their sample customer so phones opened before this update still match.
  (function migrateCustomers() {
    if (!pallets.some((p) => !('customer' in p))) return;
    const sampleIdx = new Map(seededIds(30).map((id, i) => [id, i]));
    pallets.forEach((p) => {
      if (!('customer' in p)) p.customer = sampleIdx.has(p.id) ? sampleCustomer(sampleIdx.get(p.id)) : '';
    });
    try { save(KEYS.pallets, pallets); } catch (e) { /* ignore */ }
  })();
  persistSettings();

  rebuildIndex();
  if (!localStorage.getItem(KEYS.init)) {
    // First open on this device: fill with sample data so the demo looks real.
    if (!pallets.length && !scans.length) loadSampleData();
    try { localStorage.setItem(KEYS.init, '1'); } catch (e) { /* ignore */ }
  }
  renderHeader();
  renderLocations();
  renderPartyList();
  renderSession();
  // ?print=pallets or ?print=locations opens the print layout directly (handy on a laptop).
  const printParam = new URLSearchParams(location.search).get('print');
  if (printParam === 'pallets' || printParam === 'locations') {
    document.body.classList.add('print-' + printParam);
    goTab('qr');
  } else {
    // On a computer open the owner's Dashboard; on a phone open Scan.
    const wide = window.matchMedia('(min-width: 960px)').matches;
    goTab(location.hash ? location.hash.slice(1) : (wide ? 'dashboard' : 'scan'));
  }

  // Exposed for testing in the browser console only.
  window.__pt = { checkChar, isValidId, normalizeId, seededIds, seededIdsFrom, customerSeed, genuineLookup, qrSvg, handleCode, state: () => ({ pallets, scans }) };
})();
