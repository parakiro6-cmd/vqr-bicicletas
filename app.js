// =============================================
// VQR – Control de Bicicletas
// app.js – Lógica principal
// =============================================
'use strict';

// ══════════════════════════════════════
// 1. SUPABASE
// ══════════════════════════════════════
const SUPABASE_URL      = 'https://xougtkwukgukwkadezwf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdWd0a3d1a2d1a3drYWRlendmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTA5MDksImV4cCI6MjA5NjY2NjkwOX0.SeVNSoMTxl5smzrbbxmS45QDTqZs9kQj017bmnU7wp0';
// PIN de acceso para modo vigilante (sin cuenta Supabase visible)
const VIGILANTE_PIN   = '1234';
// Credenciales internas del usuario vigilante en Supabase
// Crea este usuario en Supabase > Authentication > Users > Add user
const VIGILANTE_EMAIL = 'vigilante@hospitalsanvicente.gov.co';
const VIGILANTE_PASS  = 'Vigilante.2026';

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ══════════════════════════════════════
// 2. ESTADO GLOBAL
// ══════════════════════════════════════
const state = {
  currentUser:  null,
  currentRole:  null,
  isOnline:     navigator.onLine,
  qrScanner:    null,
  scannerActive: false,
  offlineQueue: [],
  adminTab:     'historial',
  histPage: 1, histTotal: 0,
  histFilters: { from: '', to: '', search: '', order: 'desc' },
  statsPage: 1, statsTotal: 0, statsSearch: '',
};

// ══════════════════════════════════════
// 3. INDEXEDDB – OFFLINE
// ══════════════════════════════════════
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vqr_offline', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        const s = db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        s.createIndex('synced', 'synced', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function saveOffline(record) {
  const db = await openIDB();
  const tx = db.transaction('queue', 'readwrite');
  tx.objectStore('queue').add({ ...record, synced: false, createdAt: new Date().toISOString() });
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function getPendingOffline() {
  const db  = await openIDB();
  const tx  = db.transaction('queue', 'readonly');
  const req = tx.objectStore('queue').index('synced').getAll(false);
  return new Promise((res, rej) => { req.onsuccess = (e) => res(e.target.result); req.onerror = rej; });
}

async function markSynced(id) {
  const db  = await openIDB();
  const tx  = db.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  const req = store.get(id);
  req.onsuccess = (e) => { const r = e.target.result; if (r) { r.synced = true; store.put(r); } };
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

// ══════════════════════════════════════
// 4. UTILIDADES UI
// ══════════════════════════════════════
function showToast(msg, type = 'info', duration = 3500) {
  const colors = { success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-amber-500 text-slate-900', info: 'bg-blue-600' };
  const icons  = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in max-w-xs`;
  el.innerHTML = `<span class="text-base">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

function playBeep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = ok ? 880 : 220;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  const text  = document.getElementById('sync-badge-text');
  if (!state.isOnline && state.offlineQueue.length > 0) {
    badge.classList.remove('hidden');
    if (text) text.textContent = `${state.offlineQueue.length} pendiente(s) offline`;
  } else {
    badge.classList.add('hidden');
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════
// 5. MODAL
// ══════════════════════════════════════
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}
window.closeModalOnOverlay = function(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
};

// ══════════════════════════════════════
// 6. LOGIN
// ══════════════════════════════════════
function renderLoginView() {
  stopScanner();
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col items-center justify-center p-4 view-enter
                bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div class="text-center mb-8">
        <img src="./logo.png" alt="VQR" class="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-lg object-contain ring-2 ring-blue-500/30" onerror="this.style.display='none'" />
        <h1 class="text-3xl font-bold text-white tracking-tight">VQR</h1>
        <p class="text-slate-400 text-sm mt-1">Control de Bicicletas</p>
      </div>
      <div class="w-full max-w-sm bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden">
        <div class="flex border-b border-slate-700">
          <button onclick="switchLoginTab('admin')" id="tab-admin"
                  class="flex-1 py-3.5 text-sm font-semibold transition-all bg-blue-600 text-white">
            🔐 Administrador
          </button>
          <button onclick="switchLoginTab('vigilante')" id="tab-vigilante"
                  class="flex-1 py-3.5 text-sm font-semibold transition-all text-slate-400 hover:text-white hover:bg-slate-700">
            👁 Vigilante
          </button>
        </div>
        <div class="p-6">
          <div id="form-admin">
            <p class="text-slate-400 text-xs mb-4">Ingresa tus credenciales de administrador.</p>
            <div class="space-y-3">
              <input id="login-email" type="email" placeholder="Correo electrónico" autocomplete="email"
                     class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
              <input id="login-pass" type="password" placeholder="Contraseña" autocomplete="current-password"
                     class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-600 text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
            </div>
            <button onclick="loginAdmin()"
                    class="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <span id="btn-login-text">Ingresar como Admin</span>
              <span id="btn-login-spin" class="spinner hidden"></span>
            </button>
          </div>
          <div id="form-vigilante" class="hidden">
            <p class="text-slate-400 text-xs mb-4">Ingresa el PIN de vigilante para acceder al escáner.</p>
            <div class="flex gap-2 justify-center mb-4">
              ${[0,1,2,3].map(i => `
                <input id="pin-${i}" type="password" maxlength="1" inputmode="numeric" pattern="[0-9]"
                       class="w-12 h-14 text-center text-xl font-bold rounded-xl bg-slate-900 border border-slate-600 text-white focus:border-blue-500 transition-all"
                       oninput="movePinFocus(this,${i})" onkeydown="handlePinKey(event,${i})" />`).join('')}
            </div>
            <button onclick="loginVigilante()"
                    class="w-full py-3 bg-green-600 hover:bg-green-700 active:scale-95 text-white font-semibold rounded-xl transition-all text-sm">
              Entrar al Escáner
            </button>
          </div>
        </div>
      </div>
      <p class="mt-6 text-slate-600 text-xs">VQR v1.0 · Sistema de Control de Bicicletas HSVA</p>
    </div>`;
  document.getElementById('login-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAdmin(); });
}

window.switchLoginTab = function(tab) {
  const isAdmin = tab === 'admin';
  document.getElementById('form-admin').classList.toggle('hidden', !isAdmin);
  document.getElementById('form-vigilante').classList.toggle('hidden', isAdmin);
  document.getElementById('tab-admin').className     = `flex-1 py-3.5 text-sm font-semibold transition-all ${isAdmin  ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`;
  document.getElementById('tab-vigilante').className = `flex-1 py-3.5 text-sm font-semibold transition-all ${!isAdmin ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`;
};

window.movePinFocus = function(input, index) {
  input.value = input.value.replace(/\D/g,'');
  if (input.value && index < 3) document.getElementById(`pin-${index+1}`)?.focus();
};
window.handlePinKey = function(e, index) {
  if (e.key === 'Backspace' && !e.target.value && index > 0) document.getElementById(`pin-${index-1}`)?.focus();
  if (e.key === 'Enter') loginVigilante();
};

window.loginAdmin = async function() {
  const email = document.getElementById('login-email')?.value.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { showToast('Completa todos los campos','warning'); return; }

  document.getElementById('btn-login-text').textContent = 'Ingresando...';
  document.getElementById('btn-login-spin').classList.remove('hidden');

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  document.getElementById('btn-login-text').textContent = 'Ingresar como Admin';
  document.getElementById('btn-login-spin').classList.add('hidden');

  if (error) { showToast('Credenciales incorrectas','error'); return; }

  state.currentUser = data.user;
  state.currentRole = 'admin';
  showToast('Bienvenido, Admin','success');
  renderAdminDashboard();
};

window.loginVigilante = async function() {
  const pin = [0,1,2,3].map(i => document.getElementById(`pin-${i}`)?.value).join('');
  if (pin !== VIGILANTE_PIN) {
    showToast('PIN incorrecto','error'); playBeep(false);
    [0,1,2,3].forEach(i => { const el = document.getElementById(`pin-${i}`); if(el) el.value=''; });
    document.getElementById('pin-0')?.focus();
    return;
  }

  // Mostrar estado de carga
  const btn = document.querySelector('#form-vigilante button');
  if (btn) { btn.textContent = 'Verificando...'; btn.disabled = true; }

  // Autenticar silenciosamente en Supabase con el usuario vigilante
  // Esto es necesario para que las queries a las tablas funcionen (RLS requiere auth)
  const { data, error } = await sb.auth.signInWithPassword({
    email:    VIGILANTE_EMAIL,
    password: VIGILANTE_PASS
  });

  if (error) {
    if (btn) { btn.textContent = 'Entrar al Escáner'; btn.disabled = false; }
    showToast('Error de configuración: crea el usuario vigilante en Supabase', 'error', 6000);
    console.error('[Vigilante auth]', error.message);
    return;
  }

  state.currentUser = data.user;
  state.currentRole = 'vigilante';
  showToast('Bienvenido, Vigilante','success');
  renderGuardView();
};

// ══════════════════════════════════════
// 7. VIGILANTE – ESCÁNER
// ══════════════════════════════════════
function renderGuardView() {
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-900 view-enter">
      <header class="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div class="flex items-center gap-3">
          <img src="./logo.png" alt="VQR" class="w-9 h-9 rounded-lg object-contain" onerror="this.style.display='none'" />
          <div>
            <p class="font-bold text-white text-sm leading-tight">VQR Bicis</p>
            <span class="text-xs bg-green-900/50 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">Modo Vigilante</span>
          </div>
        </div>
        <button onclick="logout()" class="text-slate-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-slate-700 text-sm flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"/>
          </svg>Salir
        </button>
      </header>

      <main class="flex-1 p-4 flex flex-col items-center gap-4 max-w-lg mx-auto w-full">
        <!-- Escáner QR -->
        <div class="w-full">
          <div class="relative bg-black rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-700 aspect-square max-w-xs mx-auto">
            <div id="qr-reader" class="w-full h-full"></div>
            <div class="absolute inset-0 pointer-events-none">
              <div class="qr-corner qr-corner-tl"></div>
              <div class="qr-corner qr-corner-tr"></div>
              <div class="qr-corner qr-corner-bl"></div>
              <div class="qr-corner qr-corner-br"></div>
              <div class="scan-line"></div>
            </div>
          </div>
          <div class="flex justify-center mt-3 gap-3">
            <button id="btn-start-scan" onclick="startScanner()"
                    class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4m10-14h4a2 2 0 012 2v4m-6 10h4a2 2 0 002-2v-4"/>
              </svg>Iniciar Cámara
            </button>
            <button id="btn-stop-scan" onclick="stopScanner()"
                    class="hidden px-5 py-2.5 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
              </svg>Detener
            </button>
          </div>
        </div>

        <div class="flex items-center gap-3 w-full">
          <div class="flex-1 h-px bg-slate-700"></div>
          <span class="text-slate-500 text-xs uppercase tracking-widest">o ingresa manual</span>
          <div class="flex-1 h-px bg-slate-700"></div>
        </div>

        <!-- Input manual / escáner USB -->
        <div class="w-full">
          <div class="flex gap-2">
            <input id="manual-input" type="text"
                   placeholder="Apunta el escáner aquí o escribe la cédula / QR..."
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                   class="flex-1 px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                   onkeydown="if(event.key==='Enter') processManualInput()" />
            <button onclick="processManualInput()"
                    class="px-4 py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl transition-all">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1.5 text-center">📟 Escáner USB/Bluetooth: el foco se mantiene aquí automáticamente</p>
        </div>

        <div id="result-card" class="hidden w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 animate-fade-in"></div>

        <div id="offline-banner" class="hidden w-full bg-amber-900/40 border border-amber-700/50 rounded-xl p-3 text-center text-amber-300 text-sm">
          📡 Sin conexión – los registros se guardan localmente y se sincronizan al reconectarse.
        </div>
      </main>
    </div>`;

  updateOfflineBanner();

  // Auto-focus para escáner USB
  const inp = document.getElementById('manual-input');
  if (inp) {
    inp.focus();
    document.addEventListener('click', function reFocus(e) {
      const tag = e.target.tagName.toLowerCase();
      if (!['input','button','select','textarea'].includes(tag) &&
          !document.getElementById('modal-overlay')?.contains(e.target)) {
        document.getElementById('manual-input')?.focus();
      }
    });
  }
}

window.startScanner = async function() {
  if (state.scannerActive) return;
  try {
    state.qrScanner = new Html5Qrcode('qr-reader');
    await state.qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      (code) => handleQRScan(code),
      () => {}
    );
    state.scannerActive = true;
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');
  } catch (err) {
    showToast('No se pudo acceder a la cámara. Usa el campo manual.','error');
  }
};

window.stopScanner = async function() {
  if (!state.scannerActive || !state.qrScanner) return;
  try {
    await state.qrScanner.stop();
    state.qrScanner    = null;
    state.scannerActive = false;
    document.getElementById('btn-start-scan')?.classList.remove('hidden');
    document.getElementById('btn-stop-scan')?.classList.add('hidden');
  } catch (_) {}
};

window.processManualInput = function() {
  const input = document.getElementById('manual-input');
  const value = input?.value.trim();
  if (!value) { showToast('Ingresa un código o cédula','warning'); return; }
  input.value = '';
  handleQRScan(value);
};

// ══════════════════════════════════════
// 8. LÓGICA DE ESCANEO
// ══════════════════════════════════════
let lastScan = '', lastScanTime = 0;

async function handleQRScan(code) {
  const now = Date.now();
  if (code === lastScan && now - lastScanTime < 3000) return;
  lastScan = code; lastScanTime = now;

  showResultCard('loading','Buscando bicicleta...', null);

  try {
    const { data: bikes, error: bikeErr } = await sb
      .from('bicicletas')
      .select('*, personas(cedula, nombre, telefono)')
      .eq('codigo_qr', code)
      .limit(1);

    if (bikeErr) throw bikeErr;

    if (!bikes || bikes.length === 0) {
      playBeep(false);
      showResultCard('warning', `Código "${esc(code)}" no registrado`, 'Abriendo formulario de registro...');
      setTimeout(() => showRegisterBikeModal(code), 800);
      return;
    }

    const bike = bikes[0];
    const { data: lastRecs, error: recErr } = await sb
      .from('registros')
      .select('tipo, fecha_hora')
      .eq('bicicleta_id', bike.id)
      .order('fecha_hora', { ascending: false })
      .limit(1);

    if (recErr) throw recErr;

    const lastTipo  = lastRecs && lastRecs.length > 0 ? lastRecs[0].tipo : null;
    const nuevoTipo = (!lastTipo || lastTipo === 'salida') ? 'entrada' : 'salida';

    const registro = {
      bicicleta_id:   bike.id,
      tipo:           nuevoTipo,
      fecha_hora:     new Date().toISOString(),
      registrado_por: state.currentUser?.id || null
    };

    if (!state.isOnline) {
      await saveOffline({ ...registro, codigo_qr: code });
      state.offlineQueue.push(registro);
      updateSyncBadge();
      playBeep(true);
      showResultCard(nuevoTipo, `${nuevoTipo.toUpperCase()} (offline)`, bike);
      return;
    }

    const { error: insErr } = await sb.from('registros').insert(registro);
    if (insErr) throw insErr;

    playBeep(true);
    showResultCard(nuevoTipo, `${nuevoTipo.toUpperCase()} registrada`, bike);

  } catch (err) {
    console.error('[handleQRScan]', err);
    playBeep(false);
    showResultCard('error', 'Error al procesar', err.message || 'Intenta de nuevo');
  }
}

function showResultCard(type, title, bike) {
  const card = document.getElementById('result-card');
  if (!card) return;
  const configs = {
    loading: { bg:'border-blue-700/50 bg-blue-900/20',   icon:'⟳', color:'text-blue-400'  },
    entrada: { bg:'border-green-700/50 bg-green-900/20', icon:'↓', color:'text-green-400' },
    salida:  { bg:'border-red-700/50 bg-red-900/20',     icon:'↑', color:'text-red-400'   },
    warning: { bg:'border-amber-700/50 bg-amber-900/20', icon:'⚠', color:'text-amber-400' },
    error:   { bg:'border-red-700/50 bg-red-900/20',     icon:'✕', color:'text-red-400'   }
  };
  const c = configs[type] || configs.error;
  const bikeInfo = (bike && type !== 'loading') ? `
    <div class="mt-3 pt-3 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
      <div><span class="text-slate-500">Propietario</span><p class="text-white font-medium">${esc(bike.personas?.nombre||'—')}</p></div>
      <div><span class="text-slate-500">Cédula</span><p class="text-white font-medium">${esc(bike.personas?.cedula||'—')}</p></div>
      <div><span class="text-slate-500">Marca</span><p class="text-white font-medium">${esc(bike.marca||'—')}</p></div>
      <div><span class="text-slate-500">Color</span><p class="text-white font-medium">${esc(bike.color||'—')}</p></div>
    </div>` : (typeof bike === 'string' ? `<p class="mt-1 text-xs text-slate-400">${esc(bike)}</p>` : '');

  card.className = `w-full border rounded-2xl p-4 animate-fade-in ${c.bg}`;
  card.innerHTML = `
    <div class="flex items-center gap-3">
      <span class="text-3xl ${c.color}">${c.icon}</span>
      <div>
        <p class="font-bold text-white">${title}</p>
        <p class="text-xs text-slate-400">${formatDate(new Date().toISOString())}</p>
      </div>
    </div>${bikeInfo}`;
  card.classList.remove('hidden');
}

// ══════════════════════════════════════
// 9. MODAL REGISTRO BICICLETA
// ══════════════════════════════════════
window.showRegisterBikeModal = function(qrCode) {
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-white">Registrar Bicicleta</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700">✕</button>
      </div>
      <p class="text-xs text-slate-400 mb-4">Código QR: <span class="text-blue-400 font-mono">${esc(qrCode)}</span></p>
      <div id="modal-step-persona">
        <p class="text-sm font-semibold text-slate-300 mb-2">1. Buscar propietario</p>
        <div class="flex gap-2">
          <input id="modal-cedula" type="text" placeholder="Número de cédula" inputmode="numeric"
                 class="flex-1 px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                 onkeydown="if(event.key==='Enter') searchPersona()" />
          <button onclick="searchPersona()" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm transition-all">Buscar</button>
        </div>
        <div id="modal-persona-result" class="mt-3"></div>
      </div>
      <div id="modal-step-bike" class="hidden mt-4">
        <div class="h-px bg-slate-700 mb-4"></div>
        <p class="text-sm font-semibold text-slate-300 mb-3">2. Datos de la bicicleta</p>
        <div class="space-y-3">
          <input id="modal-marca" type="text" placeholder="Marca (ej: Trek, Specialized...)"
                 class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
          <input id="modal-color" type="text" placeholder="Color principal"
                 class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
        </div>
        <input type="hidden" id="modal-persona-id" />
        <button onclick="saveBike('${esc(qrCode)}')"
                class="mt-4 w-full py-3 bg-green-600 hover:bg-green-700 active:scale-95 text-white font-bold rounded-xl transition-all text-sm">
          ✓ Guardar y Registrar Entrada
        </button>
      </div>
    </div>`);
};

window.searchPersona = async function() {
  const cedula = document.getElementById('modal-cedula')?.value.trim();
  if (!cedula) { showToast('Ingresa una cédula','warning'); return; }
  const resultDiv = document.getElementById('modal-persona-result');
  resultDiv.innerHTML = '<p class="text-slate-400 text-sm">Buscando...</p>';
  const { data, error } = await sb.from('personas').select('*').eq('cedula', cedula).limit(1);
  if (error) { resultDiv.innerHTML = `<p class="text-red-400 text-sm">${error.message}</p>`; return; }
  if (data && data.length > 0) {
    const p = data[0];
    resultDiv.innerHTML = `
      <div class="bg-green-900/30 border border-green-700/50 rounded-xl p-3 text-sm">
        <p class="font-semibold text-green-300">✓ Persona encontrada</p>
        <p class="text-white mt-1">${esc(p.nombre)}</p>
        <p class="text-slate-400 text-xs">Cédula: ${esc(p.cedula)} · Tel: ${esc(p.telefono||'—')}</p>
      </div>`;
    document.getElementById('modal-persona-id').value = p.id;
    document.getElementById('modal-step-bike').classList.remove('hidden');
  } else {
    resultDiv.innerHTML = `
      <div class="bg-slate-900/50 border border-slate-600 rounded-xl p-3">
        <p class="text-amber-400 text-sm font-semibold mb-3">⚠ No encontrado. Crear nueva persona:</p>
        <div class="space-y-2">
          <input id="modal-nombre" type="text" placeholder="Nombre completo"
                 class="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
          <input id="modal-telefono" type="tel" placeholder="Teléfono (opcional)"
                 class="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
          <button onclick="createPersona('${esc(cedula)}')"
                  class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-all">
            Crear Persona
          </button>
        </div>
      </div>`;
  }
};

window.createPersona = async function(cedula) {
  const nombre   = document.getElementById('modal-nombre')?.value.trim();
  const telefono = document.getElementById('modal-telefono')?.value.trim();
  if (!nombre) { showToast('El nombre es obligatorio','warning'); return; }
  const { data, error } = await sb.from('personas').insert({ cedula, nombre, telefono: telefono||null }).select().single();
  if (error) { showToast('Error: '+error.message,'error'); return; }
  document.getElementById('modal-persona-id').value = data.id;
  document.getElementById('modal-persona-result').innerHTML = `
    <div class="bg-green-900/30 border border-green-700/50 rounded-xl p-3 text-sm">
      <p class="font-semibold text-green-300">✓ Persona creada</p>
      <p class="text-white">${esc(data.nombre)}</p>
    </div>`;
  document.getElementById('modal-step-bike').classList.remove('hidden');
  showToast('Persona registrada','success');
};

window.saveBike = async function(qrCode) {
  const personaId = document.getElementById('modal-persona-id')?.value;
  const marca     = document.getElementById('modal-marca')?.value.trim();
  const color     = document.getElementById('modal-color')?.value.trim();
  if (!personaId) { showToast('Primero busca o crea la persona','warning'); return; }
  if (!marca)     { showToast('Ingresa la marca de la bicicleta','warning'); return; }
  const { data: bike, error: bikeErr } = await sb.from('bicicletas')
    .insert({ codigo_qr: qrCode, persona_id: personaId, marca, color: color||null }).select().single();
  if (bikeErr) { showToast('Error: '+bikeErr.message,'error'); return; }
  const { error: regErr } = await sb.from('registros').insert({
    bicicleta_id: bike.id, tipo: 'entrada',
    fecha_hora: new Date().toISOString(), registrado_por: state.currentUser?.id||null
  });
  if (regErr) showToast('Bicicleta creada pero no se pudo registrar entrada','warning');
  else { showToast('Bicicleta registrada y entrada guardada','success'); playBeep(true); }
  closeModal();
  showResultCard('entrada','ENTRADA registrada', { ...bike, personas:{ nombre:'(nuevo)' } });
};

// ══════════════════════════════════════
// 10. ADMIN DASHBOARD
// ══════════════════════════════════════
function renderAdminDashboard() {
  stopScanner();
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-900 view-enter">
      <header class="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div class="flex items-center gap-3">
          <img src="./logo.png" alt="VQR" class="w-9 h-9 rounded-lg object-contain" onerror="this.style.display='none'" />
          <div>
            <p class="font-bold text-white text-sm">VQR Admin</p>
            <p class="text-xs text-slate-400 truncate max-w-[180px]">${esc(state.currentUser?.email||'Administrador')}</p>
          </div>
        </div>
        <button onclick="logout()" class="text-slate-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-slate-700 text-sm flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"/>
          </svg>Cerrar sesión
        </button>
      </header>
      <div class="bg-slate-800 border-b border-slate-700 px-4">
        <div class="flex max-w-5xl mx-auto">
          <button onclick="switchAdminTab('historial')" id="tab-btn-historial"
                  class="px-4 py-3 text-sm font-semibold border-b-2 transition-all border-blue-500 text-blue-400">
            📋 Historial de Movimientos
          </button>
          <button onclick="switchAdminTab('estadisticas')" id="tab-btn-estadisticas"
                  class="px-4 py-3 text-sm font-semibold border-b-2 transition-all border-transparent text-slate-400 hover:text-white">
            📊 Por Usuario / Bicicleta
          </button>
        </div>
      </div>
      <main class="flex-1 p-4 max-w-6xl mx-auto w-full">
        <div id="tab-historial" class="view-enter">${renderHistorialContent()}</div>
        <div id="tab-estadisticas" class="hidden">${renderEstadisticasContent()}</div>
      </main>
    </div>`;
  loadHistorial();
}

window.switchAdminTab = function(tab) {
  state.adminTab = tab;
  document.getElementById('tab-historial').classList.toggle('hidden', tab !== 'historial');
  document.getElementById('tab-estadisticas').classList.toggle('hidden', tab !== 'estadisticas');
  document.getElementById('tab-btn-historial').className    = `px-4 py-3 text-sm font-semibold border-b-2 transition-all ${tab==='historial'    ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-white'}`;
  document.getElementById('tab-btn-estadisticas').className = `px-4 py-3 text-sm font-semibold border-b-2 transition-all ${tab==='estadisticas' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-white'}`;
  if (tab === 'historial')    loadHistorial();
  if (tab === 'estadisticas') loadEstadisticas();
};

// ══════════════════════════════════════
// 11. HISTORIAL
// ══════════════════════════════════════
function renderHistorialContent() {
  return `
    <div class="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Desde</label>
          <input id="hist-from" type="date" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Hasta</label>
          <input id="hist-to" type="date" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Buscar</label>
          <input id="hist-search" type="text" placeholder="Cédula o código QR..."
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                 onkeydown="if(event.key==='Enter') applyHistFilters()" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Orden</label>
          <select id="hist-order" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all">
            <option value="desc">Más reciente primero</option>
            <option value="asc">Más antiguo primero</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="applyHistFilters()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all">Buscar</button>
        <button onclick="clearHistFilters()" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-slate-300 font-semibold rounded-xl text-sm transition-all">Limpiar</button>
      </div>
    </div>
    <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <div class="table-wrap">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide">
              <th class="px-4 py-3 text-left">Fecha y hora</th>
              <th class="px-4 py-3 text-left">Cédula</th>
              <th class="px-4 py-3 text-left">Nombre</th>
              <th class="px-4 py-3 text-left">Código QR</th>
              <th class="px-4 py-3 text-left">Marca</th>
              <th class="px-4 py-3 text-left">Color</th>
              <th class="px-4 py-3 text-left">Tipo</th>
            </tr>
          </thead>
          <tbody id="hist-tbody">
            <tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
        <span id="hist-count" class="text-xs text-slate-400">—</span>
        <div class="flex gap-2 items-center">
          <button onclick="histPrevPage()" id="btn-hist-prev"
                  class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs transition-all">← Anterior</button>
          <span id="hist-page-info" class="text-xs text-slate-400 px-2">—</span>
          <button onclick="histNextPage()" id="btn-hist-next"
                  class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs transition-all">Siguiente →</button>
        </div>
      </div>
    </div>`;
}

const HIST_PER_PAGE = 20;

window.applyHistFilters = function() {
  state.histFilters.from   = document.getElementById('hist-from')?.value  || '';
  state.histFilters.to     = document.getElementById('hist-to')?.value    || '';
  state.histFilters.search = document.getElementById('hist-search')?.value.trim() || '';
  state.histFilters.order  = document.getElementById('hist-order')?.value  || 'desc';
  state.histPage = 1;
  loadHistorial();
};
window.clearHistFilters = function() {
  ['hist-from','hist-to','hist-search'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const o = document.getElementById('hist-order'); if(o) o.value='desc';
  state.histFilters = { from:'', to:'', search:'', order:'desc' };
  state.histPage = 1;
  loadHistorial();
};
window.histPrevPage = function() { if(state.histPage>1){ state.histPage--; loadHistorial(); } };
window.histNextPage = function() {
  if(state.histPage < Math.ceil(state.histTotal/HIST_PER_PAGE)){ state.histPage++; loadHistorial(); }
};

async function loadHistorial() {
  const tbody = document.getElementById('hist-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500"><span class="spinner"></span></td></tr>`;

  try {
    const { from, to, search, order } = state.histFilters;
    const offset = (state.histPage - 1) * HIST_PER_PAGE;

    let query = sb
      .from('registros')
      .select('id, tipo, fecha_hora, bicicletas(codigo_qr, marca, color, personas(cedula, nombre))', { count: 'exact' })
      .order('fecha_hora', { ascending: order === 'asc' })
      .range(offset, offset + HIST_PER_PAGE - 1);

    if (from) query = query.gte('fecha_hora', from + 'T00:00:00');
    if (to)   query = query.lte('fecha_hora', to   + 'T23:59:59');

    if (search) {
      const { data: persons } = await sb.from('personas').select('id').ilike('cedula', `%${search}%`);
      const personIds = (persons || []).map(p => p.id);
      let bikeIds = [];
      const { data: bikesByQR } = await sb.from('bicicletas').select('id').ilike('codigo_qr', `%${search}%`);
      bikeIds = (bikesByQR || []).map(b => b.id);
      if (personIds.length > 0) {
        const { data: bikesByPerson } = await sb.from('bicicletas').select('id').in('persona_id', personIds);
        bikeIds = [...new Set([...bikeIds, ...(bikesByPerson||[]).map(b=>b.id)])];
      }
      if (bikeIds.length > 0) {
        query = query.in('bicicleta_id', bikeIds);
      } else {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">Sin resultados para "${esc(search)}"</td></tr>`;
        document.getElementById('hist-count').textContent    = '0 registros';
        document.getElementById('hist-page-info').textContent = '—';
        return;
      }
    }

    const { data, count, error } = await query;
    if (error) throw error;

    state.histTotal = count || 0;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No hay registros en este rango</td></tr>`;
    } else {
      tbody.innerHTML = data.map(r => `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
          <td class="px-4 py-3 text-slate-300 whitespace-nowrap text-xs">${formatDate(r.fecha_hora)}</td>
          <td class="px-4 py-3 text-slate-300 font-mono text-xs">${esc(r.bicicletas?.personas?.cedula||'—')}</td>
          <td class="px-4 py-3 text-white text-xs">${esc(r.bicicletas?.personas?.nombre||'—')}</td>
          <td class="px-4 py-3 text-slate-400 font-mono text-xs">${esc(r.bicicletas?.codigo_qr||'—')}</td>
          <td class="px-4 py-3 text-slate-300 text-xs">${esc(r.bicicletas?.marca||'—')}</td>
          <td class="px-4 py-3 text-slate-300 text-xs">${esc(r.bicicletas?.color||'—')}</td>
          <td class="px-4 py-3">
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${r.tipo==='entrada'?'badge-entrada':'badge-salida'}">
              ${r.tipo==='entrada'?'↓ Entrada':'↑ Salida'}
            </span>
          </td>
        </tr>`).join('');
    }

    const totalPages = Math.max(1, Math.ceil(state.histTotal / HIST_PER_PAGE));
    document.getElementById('hist-count').textContent     = `${state.histTotal} registro(s)`;
    document.getElementById('hist-page-info').textContent = `Pág. ${state.histPage} / ${totalPages}`;
    document.getElementById('btn-hist-prev').disabled     = state.histPage <= 1;
    document.getElementById('btn-hist-next').disabled     = state.histPage >= totalPages;

  } catch (err) {
    console.error('[loadHistorial]', err);
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-400">
      Error: ${esc(err.message)}</td></tr>`;
  }
}

// ══════════════════════════════════════
// 12. ESTADÍSTICAS
// ══════════════════════════════════════
const STATS_PER_PAGE = 20;

function renderEstadisticasContent() {
  return `
    <div class="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-4">
      <div class="flex gap-2">
        <input id="stats-search" type="text" placeholder="Buscar por cédula, nombre o código QR..."
               class="flex-1 px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
               onkeydown="if(event.key==='Enter') applyStatsFilter()" />
        <button onclick="applyStatsFilter()" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all">Buscar</button>
        <button onclick="clearStatsFilter()" class="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 active:scale-95 text-slate-300 rounded-xl text-sm transition-all">✕</button>
      </div>
    </div>
    <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <div class="table-wrap">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide">
              <th class="px-4 py-3 text-left">Cédula</th>
              <th class="px-4 py-3 text-left">Nombre</th>
              <th class="px-4 py-3 text-left">Bicicleta</th>
              <th class="px-4 py-3 text-center">Entradas</th>
              <th class="px-4 py-3 text-center">Salidas</th>
              <th class="px-4 py-3 text-left">Último movimiento</th>
            </tr>
          </thead>
          <tbody id="stats-tbody">
            <tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
        <span id="stats-count" class="text-xs text-slate-400">—</span>
        <div class="flex gap-2 items-center">
          <button onclick="statsPrevPage()" id="btn-stats-prev"
                  class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs transition-all">← Anterior</button>
          <span id="stats-page-info" class="text-xs text-slate-400 px-2">—</span>
          <button onclick="statsNextPage()" id="btn-stats-next"
                  class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs transition-all">Siguiente →</button>
        </div>
      </div>
    </div>`;
}

window.applyStatsFilter = function() { state.statsSearch = document.getElementById('stats-search')?.value.trim()||''; state.statsPage=1; loadEstadisticas(); };
window.clearStatsFilter = function() { const el=document.getElementById('stats-search'); if(el) el.value=''; state.statsSearch=''; state.statsPage=1; loadEstadisticas(); };
window.statsPrevPage = function() { if(state.statsPage>1){ state.statsPage--; loadEstadisticas(); } };
window.statsNextPage = function() { if(state.statsPage < Math.ceil(state.statsTotal/STATS_PER_PAGE)){ state.statsPage++; loadEstadisticas(); } };

async function loadEstadisticas() {
  const tbody = document.getElementById('stats-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500"><span class="spinner"></span></td></tr>`;

  try {
    const offset = (state.statsPage - 1) * STATS_PER_PAGE;
    let bikeQuery = sb
      .from('bicicletas')
      .select('id, codigo_qr, marca, color, personas(cedula, nombre)', { count: 'exact' })
      .range(offset, offset + STATS_PER_PAGE - 1);

    if (state.statsSearch) {
      const { data: matchPersons } = await sb.from('personas').select('id')
        .or(`cedula.ilike.%${state.statsSearch}%,nombre.ilike.%${state.statsSearch}%`);
      const personIds = (matchPersons||[]).map(p=>p.id);
      if (personIds.length > 0) {
        bikeQuery = bikeQuery.or(`codigo_qr.ilike.%${state.statsSearch}%,persona_id.in.(${personIds.join(',')})`);
      } else {
        bikeQuery = bikeQuery.ilike('codigo_qr', `%${state.statsSearch}%`);
      }
    }

    const { data: bikes, count, error: bikeErr } = await bikeQuery;
    if (bikeErr) throw bikeErr;
    state.statsTotal = count || 0;

    if (!bikes || bikes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">No se encontraron bicicletas</td></tr>`;
      document.getElementById('stats-count').textContent    = '0 bicicletas';
      document.getElementById('stats-page-info').textContent = '—';
      return;
    }

    const rows = await Promise.all(bikes.map(async (bike) => {
      const [ent, sal, ult] = await Promise.all([
        sb.from('registros').select('id',{count:'exact',head:true}).eq('bicicleta_id',bike.id).eq('tipo','entrada'),
        sb.from('registros').select('id',{count:'exact',head:true}).eq('bicicleta_id',bike.id).eq('tipo','salida'),
        sb.from('registros').select('tipo,fecha_hora').eq('bicicleta_id',bike.id).order('fecha_hora',{ascending:false}).limit(1)
      ]);
      return { bike, entradas: ent.count||0, salidas: sal.count||0, ultimo: ult.data?.[0]||null };
    }));

    tbody.innerHTML = rows.map(({ bike, entradas, salidas, ultimo }) => `
      <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
        <td class="px-4 py-3 text-slate-300 font-mono text-xs">${esc(bike.personas?.cedula||'—')}</td>
        <td class="px-4 py-3 text-white text-xs font-medium">${esc(bike.personas?.nombre||'—')}</td>
        <td class="px-4 py-3 text-xs">
          <p class="text-slate-200">${esc(bike.marca||'—')} · ${esc(bike.color||'—')}</p>
          <p class="text-slate-500 font-mono">${esc(bike.codigo_qr)}</p>
        </td>
        <td class="px-4 py-3 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-bold badge-entrada">↓ ${entradas}</span></td>
        <td class="px-4 py-3 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-bold badge-salida">↑ ${salidas}</span></td>
        <td class="px-4 py-3 text-xs whitespace-nowrap">
          ${ultimo ? `
            <span class="px-2 py-0.5 rounded-full text-xs ${ultimo.tipo==='entrada'?'badge-entrada':'badge-salida'}">${ultimo.tipo}</span>
            <span class="text-slate-400 ml-1">${formatDate(ultimo.fecha_hora)}</span>
          ` : '<span class="text-slate-600">Sin registros</span>'}
        </td>
      </tr>`).join('');

    const totalPages = Math.max(1, Math.ceil(state.statsTotal / STATS_PER_PAGE));
    document.getElementById('stats-count').textContent     = `${state.statsTotal} bicicleta(s)`;
    document.getElementById('stats-page-info').textContent = `Pág. ${state.statsPage} / ${totalPages}`;
    document.getElementById('btn-stats-prev').disabled     = state.statsPage <= 1;
    document.getElementById('btn-stats-next').disabled     = state.statsPage >= totalPages;

  } catch (err) {
    console.error('[loadEstadisticas]', err);
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ══════════════════════════════════════
// 13. OFFLINE SYNC
// ══════════════════════════════════════
async function syncOfflineQueue() {
  if (!state.isOnline) return;
  const pending = await getPendingOffline();
  if (!pending.length) return;
  const badge = document.getElementById('sync-badge');
  const text  = document.getElementById('sync-badge-text');
  if (badge) badge.classList.remove('hidden');
  if (text)  text.textContent = `Sincronizando ${pending.length}...`;
  let synced = 0;
  for (const rec of pending) {
    try {
      const { error } = await sb.from('registros').insert({
        bicicleta_id: rec.bicicleta_id, tipo: rec.tipo,
        fecha_hora: rec.fecha_hora||rec.createdAt, registrado_por: rec.registrado_por||null
      });
      if (!error) { await markSynced(rec.id); synced++; }
    } catch (_) {}
  }
  if (synced > 0) showToast(`${synced} registro(s) sincronizado(s)`,'success');
  updateSyncBadge();
}

function updateOfflineBanner() {
  document.getElementById('offline-banner')?.classList.toggle('hidden', state.isOnline);
}

// ══════════════════════════════════════
// 14. LOGOUT
// ══════════════════════════════════════
window.logout = async function() {
  stopScanner();
  if (state.currentRole === 'admin') await sb.auth.signOut();
  state.currentUser = null;
  state.currentRole = null;
  renderLoginView();
};

// ══════════════════════════════════════
// 15. INIT
// ══════════════════════════════════════
async function init() {
  window.addEventListener('online',  () => { state.isOnline=true;  updateOfflineBanner(); updateSyncBadge(); syncOfflineQueue(); showToast('Conexión restaurada','success'); });
  window.addEventListener('offline', () => { state.isOnline=false; updateOfflineBanner(); showToast('Sin conexión – modo offline','warning'); });

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); console.log('[SW] Registrado'); }
    catch (e) { console.warn('[SW]', e); }
  }

  // Mostrar login inmediatamente como estado por defecto
  // (se reemplazará si hay sesión activa)
  renderLoginView();

  // Luego verificar sesión en segundo plano
  try {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) { console.warn('[Auth] getSession error:', error.message); return; }
    if (session?.user) {
      state.currentUser = session.user;
      state.currentRole = 'admin';
      renderAdminDashboard();
    }
  } catch (err) {
    console.error('[init] Error crítico:', err);
    // renderLoginView ya fue llamado arriba, la app sigue funcionando
  }
}

document.addEventListener('DOMContentLoaded', init);
