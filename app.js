// =============================================
// VQR – Control de Bicicletas
// app.js – Lógica principal
// Base de datos: 2 tablas (bicicletas + registros)
// =============================================
'use strict';

// ══════════════════════════════════════
// 1. SUPABASE
// ══════════════════════════════════════
const SUPABASE_URL      = 'https://xougtkwukgukwkadezwf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdWd0a3d1a2d1a3drYWRlendmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTA5MDksImV4cCI6MjA5NjY2NjkwOX0.SeVNSoMTxl5smzrbbxmS45QDTqZs9kQj017bmnU7wp0';

// PIN de acceso para modo vigilante
const VIGILANTE_PIN   = '1234';
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
  currentUser:   null,
  currentRole:   null,        // 'admin' | 'vigilante'
  isOnline:      navigator.onLine,
  qrScanner:     null,
  scannerActive: false,
  offlineQueue:  [],
  activeQRCode:  null,        // QR activo en el modal de registro
  adminTab:      'historial',
  // Paginación historial
  histPage: 1, histTotal: 0,
  histFilters: { from: '', to: '', search: '', order: 'desc' },
  // Paginación estadísticas
  statsPage: 1, statsTotal: 0, statsSearch: '', statsFrom: '', statsTo: '',
};

// ══════════════════════════════════════
// 3. INDEXEDDB – COLA OFFLINE
// ══════════════════════════════════════
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vqr_offline', 2);
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
  const req = db.transaction('queue','readonly').objectStore('queue').index('synced').getAll(false);
  return new Promise((res, rej) => { req.onsuccess = (e) => res(e.target.result); req.onerror = rej; });
}
async function markSynced(id) {
  const db    = await openIDB();
  const tx    = db.transaction('queue','readwrite');
  const store = tx.objectStore('queue');
  const req   = store.get(id);
  req.onsuccess = (e) => { const r=e.target.result; if(r){ r.synced=true; store.put(r); } };
  return new Promise((res,rej) => { tx.oncomplete=res; tx.onerror=rej; });
}

// ══════════════════════════════════════
// 4. UTILIDADES UI
// ══════════════════════════════════════
function showToast(msg, type='info', duration=3500) {
  const colors = { success:'bg-green-600', error:'bg-red-600', warning:'bg-amber-500 text-slate-900', info:'bg-blue-600' };
  const icons  = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  const el = document.createElement('div');
  el.className = `${colors[type]||colors.info} text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in max-w-xs`;
  el.innerHTML = `<span class="text-base">${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, duration);
}

function playBeep(ok=true) {
  try {
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(), g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type='sine'; osc.frequency.value=ok?880:220;
    g.gain.setValueAtTime(0.3,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
    osc.start(); osc.stop(ctx.currentTime+0.4);
  } catch(_){}
}

function updateSyncBadge() {
  const badge=document.getElementById('sync-badge');
  const text=document.getElementById('sync-badge-text');
  if(!state.isOnline && state.offlineQueue.length>0){
    badge?.classList.remove('hidden');
    if(text) text.textContent=`${state.offlineQueue.length} pendiente(s)`;
  } else { badge?.classList.add('hidden'); }
}

function formatDate(iso) {
  if(!iso) return '—';
  return new Date(iso).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function esc(str) {
  if(!str) return '';
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
  state.activeQRCode = null;
}
window.closeModalOnOverlay = function(e) {
  if(e.target===document.getElementById('modal-overlay')) closeModal();
};

// ══════════════════════════════════════
// 6. VISTA LOGIN
// ══════════════════════════════════════
function renderLoginView() {
  stopScanner();
  document.getElementById('app').innerHTML = `
    <div class="login-bg min-h-screen flex flex-col items-center justify-center p-4 view-enter">
      <div class="text-center mb-8">
        <img src="./logo.png" alt="VQR" onerror="this.style.display='none'"
             class="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-lg object-contain ring-2 ring-blue-500/30" />
        <h1 class="login-title text-3xl font-bold tracking-tight">VQR</h1>
        <p class="login-label text-sm mt-1">Control de Bicicletas</p>
      </div>

      <div class="login-card w-full max-w-sm rounded-2xl shadow-2xl border overflow-hidden">
        <!-- Pestañas Admin / Vigilante -->
        <div class="login-tabs flex border-b">
          <button onclick="switchLoginTab('admin')" id="tab-admin"
                  class="flex-1 py-3.5 text-sm font-semibold transition-all bg-blue-600 text-white">
            🔐 Administrador
          </button>
          <button onclick="switchLoginTab('vigilante')" id="tab-vigilante"
                  class="login-tab-inactive flex-1 py-3.5 text-sm font-semibold transition-all">
            👁 Vigilante
          </button>
        </div>

        <div class="p-6">
          <!-- Formulario Admin -->
          <div id="form-admin">
            <p class="login-label text-xs mb-4">Ingresa tus credenciales de administrador.</p>
            <div class="space-y-3">
              <input id="login-email" type="email" placeholder="Correo electrónico"
                     autocomplete="email"
                     class="login-input w-full px-4 py-3 rounded-xl border text-sm focus:border-blue-500 transition-all" />
              <input id="login-pass" type="password" placeholder="Contraseña"
                     autocomplete="current-password"
                     class="login-input w-full px-4 py-3 rounded-xl border text-sm focus:border-blue-500 transition-all" />
            </div>
            <button onclick="loginAdmin()"
                    class="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <span id="btn-login-text">Ingresar como Admin</span>
              <span id="btn-login-spin" class="spinner hidden"></span>
            </button>
          </div>

          <!-- Formulario Vigilante PIN -->
          <div id="form-vigilante" class="hidden">
            <p class="login-label text-xs mb-4">Ingresa el PIN para acceder al escáner.</p>
            <div class="flex gap-2 justify-center mb-4">
              ${[0,1,2,3].map(i=>`
                <input id="pin-${i}" type="password" maxlength="1" inputmode="numeric" pattern="[0-9]"
                       class="login-input w-12 h-14 text-center text-xl font-bold rounded-xl border focus:border-blue-500 transition-all"
                       oninput="movePinFocus(this,${i})" onkeydown="handlePinKey(event,${i})" />`).join('')}
            </div>
            <button onclick="loginVigilante()"
                    class="w-full py-3 bg-green-600 hover:bg-green-700 active:scale-95 text-white font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2">
              <span id="btn-pin-text">Entrar al Escáner</span>
              <span id="btn-pin-spin" class="spinner hidden"></span>
            </button>
          </div>
        </div>
      </div>

      <p class="login-footer mt-6 text-xs">VQR v1.0 · Sistema de Control de Uso de Bicicletas HSVA</p>
    </div>`;
  document.getElementById('login-pass')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') loginAdmin(); });
}

window.switchLoginTab = function(tab) {
  const isAdmin = tab==='admin';
  document.getElementById('form-admin').classList.toggle('hidden',!isAdmin);
  document.getElementById('form-vigilante').classList.toggle('hidden',isAdmin);
  // Tab activo: siempre fondo de color sólido con texto blanco
  // Tab inactivo: usa clase semántica login-tab-inactive que responde al tema
  document.getElementById('tab-admin').className =
    `flex-1 py-3.5 text-sm font-semibold transition-all ${isAdmin
      ? 'bg-blue-600 text-white'
      : 'login-tab-inactive'}`;
  document.getElementById('tab-vigilante').className =
    `flex-1 py-3.5 text-sm font-semibold transition-all ${!isAdmin
      ? 'bg-green-600 text-white'
      : 'login-tab-inactive'}`;
};

window.movePinFocus = function(input,index) {
  input.value=input.value.replace(/\D/g,'');
  if(input.value && index<3) document.getElementById(`pin-${index+1}`)?.focus();
};
window.handlePinKey = function(e,index) {
  if(e.key==='Backspace'&&!e.target.value&&index>0) document.getElementById(`pin-${index-1}`)?.focus();
  if(e.key==='Enter') loginVigilante();
};

window.loginAdmin = async function() {
  const email=document.getElementById('login-email')?.value.trim();
  const pass=document.getElementById('login-pass')?.value;
  if(!email||!pass){ showToast('Completa todos los campos','warning'); return; }
  document.getElementById('btn-login-text').textContent='Ingresando...';
  document.getElementById('btn-login-spin').classList.remove('hidden');
  const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
  document.getElementById('btn-login-text').textContent='Ingresar como Admin';
  document.getElementById('btn-login-spin').classList.add('hidden');
  if(error){ showToast('Credenciales incorrectas','error'); return; }
  state.currentUser=data.user; state.currentRole='admin';
  localStorage.setItem('vqr_role', 'admin');       // ← persiste el rol
  showToast('Bienvenido, Admin','success');
  renderAdminDashboard();
};

window.loginVigilante = async function() {
  const pin=[0,1,2,3].map(i=>document.getElementById(`pin-${i}`)?.value).join('');
  if(pin!==VIGILANTE_PIN){
    showToast('PIN incorrecto','error'); playBeep(false);
    [0,1,2,3].forEach(i=>{ const el=document.getElementById(`pin-${i}`); if(el) el.value=''; });
    document.getElementById('pin-0')?.focus(); return;
  }
  document.getElementById('btn-pin-text').textContent='Verificando...';
  document.getElementById('btn-pin-spin').classList.remove('hidden');
  const {data,error}=await sb.auth.signInWithPassword({email:VIGILANTE_EMAIL,password:VIGILANTE_PASS});
  document.getElementById('btn-pin-text').textContent='Entrar al Escáner';
  document.getElementById('btn-pin-spin').classList.add('hidden');
  if(error){
    showToast('Error de configuración del vigilante: '+error.message,'error',6000);
    console.error('[Vigilante]',error); return;
  }
  state.currentUser=data.user; state.currentRole='vigilante';
  localStorage.setItem('vqr_role', 'vigilante');   // ← persiste el rol
  showToast('Bienvenido, Vigilante','success');
  renderGuardView();
};

// ══════════════════════════════════════
// 7. VISTA VIGILANTE – ESCÁNER
// ══════════════════════════════════════
function renderGuardView() {
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col bg-slate-900 view-enter">
      <header class="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div class="flex items-center gap-3">
          <img src="./logo.png" alt="VQR" onerror="this.style.display='none'"
               class="w-9 h-9 rounded-lg object-contain" />
          <div>
            <p class="font-bold text-white text-sm leading-tight">VQR Bicis</p>
            <span class="text-xs bg-green-900/50 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
              Modo Vigilante
            </span>
          </div>
        </div>
        <button onclick="logout()"
                class="text-slate-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-slate-700 text-sm flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"/>
          </svg>Salir
        </button>
      </header>

      <main class="flex-1 p-4 flex flex-col items-center gap-4 max-w-lg mx-auto w-full">

        <!-- Área escáner de cámara -->
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
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4m10-14h4a2 2 0 012 2v4m-6 10h4a2 2 0 002-2v-4"/>
              </svg>Iniciar Cámara
            </button>
            <button id="btn-stop-scan" onclick="stopScanner()"
                    class="hidden px-5 py-2.5 bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
              </svg>Detener
            </button>
          </div>
        </div>

        <!-- Divisor -->
        <div class="flex items-center gap-3 w-full">
          <div class="flex-1 h-px bg-slate-700"></div>
          <span class="text-slate-500 text-xs uppercase tracking-widest">o ingresa manual</span>
          <div class="flex-1 h-px bg-slate-700"></div>
        </div>

        <!-- Input manual / escáner USB -->
        <div class="w-full">
          <div class="flex gap-2">
            <input id="manual-input" type="text"
                   placeholder="Apunta el escáner aquí o escribe el código / cédula..."
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                   class="flex-1 px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                   onkeydown="if(event.key==='Enter') processManualInput()" />
            <button onclick="processManualInput()"
                    class="px-4 py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl transition-all">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1.5 text-center">
            📟 Escáner USB/Bluetooth: el foco se mantiene aquí automáticamente
          </p>
        </div>

        <!-- Tarjeta de resultado -->
        <div id="result-card" class="hidden w-full rounded-2xl p-4 border animate-fade-in"></div>

        <!-- Banner offline -->
        <div id="offline-banner"
             class="${state.isOnline?'hidden':''} w-full bg-amber-900/40 border border-amber-700/50 rounded-xl p-3 text-center text-amber-300 text-sm">
          📡 Sin conexión – los registros se sincronizan al reconectarse.
        </div>
      </main>
    </div>`;

  // Auto-focus para escáner USB
  document.getElementById('manual-input')?.focus();
  document.addEventListener('click', function guardFocus(e) {
    if(!document.getElementById('app')?.querySelector('.view-enter')) {
      document.removeEventListener('click', guardFocus); return;
    }
    const tag=e.target.tagName.toLowerCase();
    if(!['input','button','select','textarea'].includes(tag) &&
       !document.getElementById('modal-overlay')?.contains(e.target)){
      document.getElementById('manual-input')?.focus();
    }
  });
}

window.startScanner = async function() {
  if(state.scannerActive) return;
  try {
    state.qrScanner = new Html5Qrcode('qr-reader');
    await state.qrScanner.start(
      { facingMode:'environment' },
      { fps:10, qrbox:{width:220,height:220}, aspectRatio:1.0 },
      (code) => handleQRScan(code),
      () => {}
    );
    state.scannerActive=true;
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');
  } catch(err) {
    showToast('No se pudo acceder a la cámara. Usa el campo manual.','error');
    console.error('[Scanner]',err);
  }
};

window.stopScanner = async function() {
  if(!state.scannerActive||!state.qrScanner) return;
  try {
    await state.qrScanner.stop();
    state.qrScanner=null; state.scannerActive=false;
    document.getElementById('btn-start-scan')?.classList.remove('hidden');
    document.getElementById('btn-stop-scan')?.classList.add('hidden');
  } catch(_){}
};

window.processManualInput = function() {
  const input=document.getElementById('manual-input');
  const value=input?.value.trim();
  if(!value){ showToast('Ingresa un código o cédula','warning'); return; }
  input.value='';
  handleQRScan(value);
};

// ══════════════════════════════════════
// 8. LÓGICA CENTRAL DE ESCANEO
// ══════════════════════════════════════
let lastScan='', lastScanTime=0;

/**
 * Flujo principal:
 * 1. Busca en tabla "bicicletas" por codigo_qr
 * 2. Si NO existe → abre modal para registrar nueva bicicleta
 * 3. Si existe → mira el último registro (entrada/salida)
 * 4. Alterna: si última fue entrada → registra salida, y viceversa
 */
async function handleQRScan(code) {
  const now=Date.now();
  if(code===lastScan && now-lastScanTime<3000) return;
  lastScan=code; lastScanTime=now;

  showResultCard('loading','Buscando bicicleta...',null);

  try {
    // Buscar bicicleta por codigo_qr en la tabla bicicletas
    const {data:bikes, error:bikeErr} = await sb
      .from('bicicletas')
      .select('id, codigo_qr, cedula, nombre, telefono')
      .eq('codigo_qr', code)
      .limit(1);

    if(bikeErr) throw bikeErr;

    if(!bikes || bikes.length===0){
      // ── Bicicleta NO registrada → registrar nueva ──
      playBeep(false);
      showResultCard('warning',`Código no registrado`,`Registrando: ${esc(code)}`);
      setTimeout(()=>showRegisterModal(code), 600);
      return;
    }

    const bike = bikes[0];

    // Obtener el último movimiento de esta bicicleta
    const {data:lastRecs, error:recErr} = await sb
      .from('registros')
      .select('tipo, fecha_hora')
      .eq('bicicleta_id', bike.id)
      .order('fecha_hora', {ascending:false})
      .limit(1);

    if(recErr) throw recErr;

    // Alternar: si no hay registros o el último fue salida → entrada; si fue entrada → salida
    const lastTipo  = lastRecs&&lastRecs.length>0 ? lastRecs[0].tipo : null;
    const nuevoTipo = (!lastTipo||lastTipo==='salida') ? 'entrada' : 'salida';

    const registro = {
      bicicleta_id:   bike.id,
      tipo:           nuevoTipo,
      fecha_hora:     new Date().toISOString(),
      registrado_por: state.currentUser?.id||null
    };

    if(!state.isOnline){
      await saveOffline({...registro, codigo_qr:code, nombre:bike.nombre});
      state.offlineQueue.push(registro);
      updateSyncBadge();
      playBeep(true);
      showResultCard(nuevoTipo, `${nuevoTipo.toUpperCase()} (offline)`, bike);
      return;
    }

    const {error:insErr} = await sb.from('registros').insert(registro);
    if(insErr) throw insErr;

    playBeep(true);
    showResultCard(nuevoTipo, `${nuevoTipo.toUpperCase()} registrada`, bike);

  } catch(err){
    console.error('[handleQRScan]',err);
    playBeep(false);
    showResultCard('error','Error al procesar',err.message||'Intenta de nuevo');
  }
}

/**
 * Muestra la tarjeta de resultado después de un escaneo.
 * bike tiene: codigo_qr, cedula, nombre (de la tabla bicicletas)
 */
function showResultCard(type, title, bike) {
  const card=document.getElementById('result-card');
  if(!card) return;
  const cfg = {
    loading: {bg:'border-blue-700/50 bg-blue-900/20',   icon:'⟳', color:'text-blue-400'},
    entrada: {bg:'border-green-700/50 bg-green-900/20', icon:'↓', color:'text-green-400'},
    salida:  {bg:'border-red-700/50 bg-red-900/20',     icon:'↑', color:'text-red-400'},
    warning: {bg:'border-amber-700/50 bg-amber-900/20', icon:'⚠', color:'text-amber-400'},
    error:   {bg:'border-red-700/50 bg-red-900/20',     icon:'✕', color:'text-red-400'}
  };
  const c=cfg[type]||cfg.error;
  const info = (bike&&type!=='loading') ? `
    <div class="mt-3 pt-3 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
      <div><span class="text-slate-500">Propietario</span>
           <p class="text-white font-medium">${esc(bike.nombre||'—')}</p></div>
      <div><span class="text-slate-500">Cédula</span>
           <p class="text-white font-medium">${esc(bike.cedula||'—')}</p></div>
      <div><span class="text-slate-500">Código QR</span>
           <p class="text-blue-300 font-mono text-xs break-all">${esc(bike.codigo_qr||'—')}</p></div>
      <div><span class="text-slate-500">Teléfono</span>
           <p class="text-white">${esc(bike.telefono||'—')}</p></div>
    </div>` : (typeof bike==='string'?`<p class="mt-1 text-xs text-slate-400">${esc(bike)}</p>`:'');

  card.className=`w-full border rounded-2xl p-4 animate-fade-in ${c.bg}`;
  card.innerHTML=`
    <div class="flex items-center gap-3">
      <span class="text-3xl ${c.color}">${c.icon}</span>
      <div>
        <p class="font-bold text-white">${title}</p>
        <p class="text-xs text-slate-400">${formatDate(new Date().toISOString())}</p>
      </div>
    </div>${info}`;
  card.classList.remove('hidden');
}

// ══════════════════════════════════════
// 9. MODAL: REGISTRAR NUEVA BICICLETA
// Tabla destino: bicicletas (codigo_qr, cedula, nombre, telefono)
// ══════════════════════════════════════

/**
 * Abre el modal de registro.
 * El codigo_qr escaneado se guarda en state.activeQRCode.
 */
window.showRegisterModal = function(qrCode) {
  state.activeQRCode = qrCode;
  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-white">Registrar Bicicleta</h2>
        <button onclick="closeModal()"
                class="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-700 transition-colors">✕</button>
      </div>

      <!-- Código QR detectado (solo lectura) -->
      <div class="bg-blue-900/30 border border-blue-700/40 rounded-xl px-4 py-3 mb-5">
        <p class="text-xs text-slate-400 mb-1">Código QR / identificador detectado:</p>
        <p class="text-blue-300 font-mono text-sm break-all font-semibold">${esc(qrCode)}</p>
      </div>

      <!-- Formulario: datos del propietario -->
      <div class="space-y-4">

        <div>
          <label class="text-xs font-semibold text-slate-300 mb-1.5 block">
            N° Documento de Identidad <span class="text-red-400">*</span>
          </label>
          <input id="reg-cedula" type="text" inputmode="numeric" autocomplete="off"
                 placeholder="Ej: 1106899671"
                 class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl
                        text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-300 mb-1.5 block">
            Nombre completo <span class="text-red-400">*</span>
          </label>
          <input id="reg-nombre" type="text" autocomplete="off"
                 placeholder="Nombre y apellidos del propietario"
                 class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl
                        text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
        </div>

        <div>
          <label class="text-xs font-semibold text-slate-300 mb-1.5 block">
            Teléfono <span class="text-slate-500">(opcional)</span>
          </label>
          <input id="reg-telefono" type="tel" autocomplete="off"
                 placeholder="Ej: 3001234567"
                 class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl
                        text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all" />
        </div>

        <div id="reg-error" class="hidden bg-red-900/40 border border-red-700/50 rounded-xl px-4 py-2 text-red-300 text-sm"></div>

        <button onclick="saveRegistro()"
                class="w-full py-3.5 bg-green-600 hover:bg-green-700 active:scale-95
                       text-white font-bold rounded-xl transition-all text-sm
                       flex items-center justify-center gap-2 mt-2">
          <span id="reg-btn-text">✓ Registrar y marcar ENTRADA</span>
          <span id="reg-btn-spin" class="spinner hidden"></span>
        </button>
      </div>
    </div>`);

  // Foco en cédula al abrir
  setTimeout(()=>document.getElementById('reg-cedula')?.focus(), 100);
};

/**
 * Guarda la nueva bicicleta y registra su primera entrada.
 * Inserta en tabla "bicicletas": codigo_qr + cedula + nombre + telefono
 * Inserta en tabla "registros": bicicleta_id + tipo='entrada'
 */
window.saveRegistro = async function() {
  const qrCode   = state.activeQRCode;
  const cedula   = document.getElementById('reg-cedula')?.value.trim();
  const nombre   = document.getElementById('reg-nombre')?.value.trim();
  const telefono = document.getElementById('reg-telefono')?.value.trim();

  // Limpiar error previo
  const errDiv=document.getElementById('reg-error');
  errDiv.classList.add('hidden');

  const showRegError = (msg) => {
    errDiv.textContent=msg;
    errDiv.classList.remove('hidden');
  };

  // Validaciones
  if(!qrCode)    { showRegError('Error: código QR no disponible. Cierra y escanea de nuevo.'); return; }
  if(!cedula)    { showRegError('El número de documento es obligatorio.'); document.getElementById('reg-cedula')?.focus(); return; }
  if(!nombre)    { showRegError('El nombre completo es obligatorio.'); document.getElementById('reg-nombre')?.focus(); return; }

  // Estado de carga
  const btnText=document.getElementById('reg-btn-text');
  const btnSpin=document.getElementById('reg-btn-spin');
  btnText.textContent='Guardando...'; btnSpin.classList.remove('hidden');
  document.querySelector('#modal-content button[onclick="saveRegistro()"]').disabled=true;

  try {
    // ── INSERT en tabla bicicletas ──
    // codigo_qr: el código escaneado
    // cedula:    documento del propietario
    // nombre:    nombre del propietario
    const {data:bike, error:bikeErr} = await sb
      .from('bicicletas')
      .insert({
        codigo_qr: qrCode,
        cedula,
        nombre,
        telefono: telefono||null
      })
      .select('id, codigo_qr, cedula, nombre, telefono')
      .single();

    if(bikeErr){
      // Error de duplicado: ya existe ese código QR
      if(bikeErr.code==='23505'){
        showRegError('Este código QR ya está registrado en el sistema.');
      } else {
        showRegError('Error al registrar: '+bikeErr.message);
      }
      btnText.textContent='✓ Registrar y marcar ENTRADA';
      btnSpin.classList.add('hidden');
      document.querySelector('#modal-content button[onclick="saveRegistro()"]').disabled=false;
      return;
    }

    // ── INSERT en tabla registros: primera entrada ──
    const {error:regErr} = await sb.from('registros').insert({
      bicicleta_id:   bike.id,
      tipo:           'entrada',
      fecha_hora:     new Date().toISOString(),
      registrado_por: state.currentUser?.id||null
    });

    if(regErr) throw new Error('Bicicleta guardada pero falló la entrada: '+regErr.message);

    playBeep(true);
    showToast('✓ Bicicleta registrada y entrada guardada','success');
    state.activeQRCode=null;
    closeModal();
    showResultCard('entrada','ENTRADA registrada', bike);

  } catch(err){
    console.error('[saveRegistro]',err);
    showRegError(err.message);
    btnText.textContent='✓ Registrar y marcar ENTRADA';
    btnSpin.classList.add('hidden');
    const btn=document.querySelector('#modal-content button[onclick="saveRegistro()"]');
    if(btn) btn.disabled=false;
  }
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
          <img src="./logo.png" alt="VQR" onerror="this.style.display='none'"
               class="w-9 h-9 rounded-lg object-contain" />
          <div>
            <p class="font-bold text-white text-sm">VQR Admin</p>
            <p class="text-xs text-slate-400 truncate max-w-[200px]">${esc(state.currentUser?.email||'Administrador')}</p>
          </div>
        </div>
        <button onclick="logout()"
                class="text-slate-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-slate-700 text-sm flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"/>
          </svg>Cerrar sesión
        </button>
      </header>

      <!-- Tabs -->
      <div class="bg-slate-800 border-b border-slate-700 px-4">
        <div class="flex max-w-5xl mx-auto">
          <button onclick="switchAdminTab('historial')" id="tab-btn-historial"
                  class="px-5 py-3.5 text-sm font-semibold border-b-2 transition-all border-blue-500 text-blue-400">
            📋 Historial de Movimientos
          </button>
          <button onclick="switchAdminTab('estadisticas')" id="tab-btn-estadisticas"
                  class="px-5 py-3.5 text-sm font-semibold border-b-2 transition-all border-transparent text-slate-400 hover:text-white">
            📊 Por Propietario / Bicicleta
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
  state.adminTab=tab;
  document.getElementById('tab-historial').classList.toggle('hidden',tab!=='historial');
  document.getElementById('tab-estadisticas').classList.toggle('hidden',tab!=='estadisticas');
  document.getElementById('tab-btn-historial').className    =`px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${tab==='historial'    ?'border-blue-500 text-blue-400':'border-transparent text-slate-400 hover:text-white'}`;
  document.getElementById('tab-btn-estadisticas').className =`px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${tab==='estadisticas' ?'border-blue-500 text-blue-400':'border-transparent text-slate-400 hover:text-white'}`;
  if(tab==='historial')    loadHistorial();
  if(tab==='estadisticas') loadEstadisticas();
};

// ══════════════════════════════════════
// 11. TAB HISTORIAL
// Consulta: registros JOIN bicicletas
// Muestra: fecha, cedula, nombre, codigo_qr, telefono, tipo
// ══════════════════════════════════════
function renderHistorialContent() {
  return `
    <div class="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Desde</label>
          <input id="hist-from" type="date"
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Hasta</label>
          <input id="hist-to" type="date"
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Buscar</label>
          <input id="hist-search" type="text" placeholder="Cédula o código QR..."
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                 onkeydown="if(event.key==='Enter') applyHistFilters()" />
        </div>
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Orden</label>
          <select id="hist-order"
                  class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl text-white text-sm focus:border-blue-500 transition-all">
            <option value="desc">Más reciente primero</option>
            <option value="asc">Más antiguo primero</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="applyHistFilters()"
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl text-sm transition-all">Buscar</button>
        <button onclick="clearHistFilters()"
                class="px-4 py-2 bg-slate-700 hover:bg-slate-600 active:scale-95 text-slate-300 font-semibold rounded-xl text-sm transition-all">Limpiar</button>
      </div>
    </div>

    <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <div class="table-wrap">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide bg-slate-900/40">
              <th class="px-4 py-3 text-left">Fecha y hora</th>
              <th class="px-4 py-3 text-left">Cédula</th>
              <th class="px-4 py-3 text-left">Nombre</th>
              <th class="px-4 py-3 text-left">Código QR</th>
              <th class="px-4 py-3 text-left">Teléfono</th>
              <th class="px-4 py-3 text-left">Tipo</th>
            </tr>
          </thead>
          <tbody id="hist-tbody">
            <tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex items-center justify-between flex-wrap gap-2">
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

const HIST_PER_PAGE=20;
window.applyHistFilters = function() {
  state.histFilters.from   =document.getElementById('hist-from')?.value||'';
  state.histFilters.to     =document.getElementById('hist-to')?.value||'';
  state.histFilters.search =document.getElementById('hist-search')?.value.trim()||'';
  state.histFilters.order  =document.getElementById('hist-order')?.value||'desc';
  state.histPage=1; loadHistorial();
};
window.clearHistFilters = function() {
  ['hist-from','hist-to','hist-search'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const o=document.getElementById('hist-order'); if(o) o.value='desc';
  state.histFilters={from:'',to:'',search:'',order:'desc'};
  state.histPage=1; loadHistorial();
};
window.histPrevPage = function(){ if(state.histPage>1){state.histPage--;loadHistorial();} };
window.histNextPage = function(){ if(state.histPage<Math.ceil(state.histTotal/HIST_PER_PAGE)){state.histPage++;loadHistorial();} };

async function loadHistorial() {
  const tbody=document.getElementById('hist-tbody');
  if(!tbody) return;
  tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500"><span class="spinner"></span></td></tr>`;

  try {
    const {from,to,search,order}=state.histFilters;
    const offset=(state.histPage-1)*HIST_PER_PAGE;

    // JOIN: registros → bicicletas (para obtener cedula, nombre, codigo_qr)
    let query = sb
      .from('registros')
      .select(`
        id, tipo, fecha_hora,
        bicicletas ( id, codigo_qr, cedula, nombre, telefono )
      `, {count:'exact'})
      .order('fecha_hora', {ascending:order==='asc'})
      .range(offset, offset+HIST_PER_PAGE-1);

    if(from) query=query.gte('fecha_hora', from+'T00:00:00');
    if(to)   query=query.lte('fecha_hora', to+'T23:59:59');

    // Búsqueda por cédula o código QR
    if(search){
      const {data:matchBikes} = await sb
        .from('bicicletas')
        .select('id')
        .or(`cedula.ilike.%${search}%,codigo_qr.ilike.%${search}%,nombre.ilike.%${search}%`);
      const ids=(matchBikes||[]).map(b=>b.id);
      if(ids.length>0){
        query=query.in('bicicleta_id',ids);
      } else {
        tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">Sin resultados para "${esc(search)}"</td></tr>`;
        document.getElementById('hist-count').textContent='0 registros';
        document.getElementById('hist-page-info').textContent='—';
        return;
      }
    }

    const {data,count,error}=await query;
    if(error) throw error;

    state.histTotal=count||0;

    if(!data||data.length===0){
      tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">No hay registros en este período</td></tr>`;
    } else {
      tbody.innerHTML=data.map(r=>`
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
          <td class="px-4 py-3 text-slate-300 whitespace-nowrap text-xs">${formatDate(r.fecha_hora)}</td>
          <td class="px-4 py-3 text-slate-300 font-mono text-xs">${esc(r.bicicletas?.cedula||'—')}</td>
          <td class="px-4 py-3 text-white text-xs font-medium">${esc(r.bicicletas?.nombre||'—')}</td>
          <td class="px-4 py-3 text-blue-300 font-mono text-xs">${esc(r.bicicletas?.codigo_qr||'—')}</td>
          <td class="px-4 py-3 text-slate-400 text-xs">${esc(r.bicicletas?.telefono||'—')}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${r.tipo==='entrada'?'badge-entrada':'badge-salida'}">
              <span>${r.tipo==='entrada'?'↓':'↑'}</span>
              <span>${r.tipo==='entrada'?'Entrada':'Salida'}</span>
            </span>
          </td>
        </tr>`).join('');
    }

    const totalPages=Math.max(1,Math.ceil(state.histTotal/HIST_PER_PAGE));
    document.getElementById('hist-count').textContent=`${state.histTotal} registro(s)`;
    document.getElementById('hist-page-info').textContent=`Pág. ${state.histPage} / ${totalPages}`;
    document.getElementById('btn-hist-prev').disabled=state.histPage<=1;
    document.getElementById('btn-hist-next').disabled=state.histPage>=totalPages;

  } catch(err){
    console.error('[loadHistorial]',err);
    tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-red-400">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ══════════════════════════════════════
// 12. TAB ESTADÍSTICAS
// Consulta: bicicletas + COUNT de registros
// Muestra: cedula, nombre, codigo_qr, #entradas, #salidas, último movimiento
// ══════════════════════════════════════
function renderEstadisticasContent() {
  return `
    <div class="bg-slate-800 rounded-2xl border border-slate-700 p-4 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <!-- Búsqueda -->
        <div class="sm:col-span-2">
          <label class="text-xs text-slate-400 mb-1 block">Buscar</label>
          <input id="stats-search" type="text"
                 placeholder="Cédula, nombre o código QR..."
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl
                        text-white placeholder-slate-500 text-sm focus:border-blue-500 transition-all"
                 onkeydown="if(event.key==='Enter') applyStatsFilter()" />
        </div>
        <!-- Desde -->
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Desde</label>
          <input id="stats-from" type="date"
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl
                        text-white text-sm focus:border-blue-500 transition-all" />
        </div>
        <!-- Hasta -->
        <div>
          <label class="text-xs text-slate-400 mb-1 block">Hasta</label>
          <input id="stats-to" type="date"
                 class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl
                        text-white text-sm focus:border-blue-500 transition-all" />
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="applyStatsFilter()"
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95
                       text-white font-semibold rounded-xl text-sm transition-all">Buscar</button>
        <button onclick="clearStatsFilter()"
                class="px-4 py-2 bg-slate-700 hover:bg-slate-600 active:scale-95
                       text-slate-300 font-semibold rounded-xl text-sm transition-all">Limpiar</button>
      </div>
    </div>
    <div class="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <div class="table-wrap">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wide bg-slate-900/40">
              <th class="px-4 py-3 text-left">Cédula</th>
              <th class="px-4 py-3 text-left">Nombre</th>
              <th class="px-4 py-3 text-left">Código QR</th>
              <th class="px-4 py-3 text-center">Entradas</th>
              <th class="px-4 py-3 text-center">Salidas</th>
              <th class="px-4 py-3 text-left">Último movimiento</th>
            </tr>
          </thead>
          <tbody id="stats-tbody">
            <tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex items-center justify-between flex-wrap gap-2">
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

const STATS_PER_PAGE=20;
window.applyStatsFilter = function(){
  state.statsSearch = document.getElementById('stats-search')?.value.trim()||'';
  state.statsFrom   = document.getElementById('stats-from')?.value||'';
  state.statsTo     = document.getElementById('stats-to')?.value||'';
  state.statsPage=1; loadEstadisticas();
};
window.clearStatsFilter = function(){
  ['stats-search','stats-from','stats-to'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  state.statsSearch=''; state.statsFrom=''; state.statsTo='';
  state.statsPage=1; loadEstadisticas();
};
window.statsPrevPage = function(){ if(state.statsPage>1){state.statsPage--;loadEstadisticas();} };
window.statsNextPage = function(){ if(state.statsPage<Math.ceil(state.statsTotal/STATS_PER_PAGE)){state.statsPage++;loadEstadisticas();} };

async function loadEstadisticas() {
  const tbody=document.getElementById('stats-tbody');
  if(!tbody) return;
  tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500"><span class="spinner"></span></td></tr>`;

  try {
    const offset=(state.statsPage-1)*STATS_PER_PAGE;
    let q=sb.from('bicicletas')
      .select('id, codigo_qr, cedula, nombre, telefono', {count:'exact'})
      .range(offset, offset+STATS_PER_PAGE-1);

    if(state.statsSearch){
      q=q.or(`cedula.ilike.%${state.statsSearch}%,nombre.ilike.%${state.statsSearch}%,codigo_qr.ilike.%${state.statsSearch}%`);
    }

    const {data:bikes, count, error:bikeErr}=await q;
    if(bikeErr) throw bikeErr;
    state.statsTotal=count||0;

    if(!bikes||bikes.length===0){
      tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">No se encontraron registros</td></tr>`;
      document.getElementById('stats-count').textContent='0 registros';
      document.getElementById('stats-page-info').textContent='—';
      return;
    }

    // Para cada bicicleta: contar entradas, salidas y último movimiento
    // Si hay filtro de fechas, los counts se aplican solo en ese rango
    const {statsFrom, statsTo} = state;
    const rows=await Promise.all(bikes.map(async(bike)=>{
      // Construir queries base de conteo
      let qEnt = sb.from('registros').select('id',{count:'exact',head:true})
                   .eq('bicicleta_id',bike.id).eq('tipo','entrada');
      let qSal = sb.from('registros').select('id',{count:'exact',head:true})
                   .eq('bicicleta_id',bike.id).eq('tipo','salida');
      let qUlt = sb.from('registros').select('tipo,fecha_hora')
                   .eq('bicicleta_id',bike.id).order('fecha_hora',{ascending:false}).limit(1);

      // Aplicar filtro de fechas si está activo
      if(statsFrom){ qEnt=qEnt.gte('fecha_hora',statsFrom+'T00:00:00'); qSal=qSal.gte('fecha_hora',statsFrom+'T00:00:00'); qUlt=qUlt.gte('fecha_hora',statsFrom+'T00:00:00'); }
      if(statsTo)  { qEnt=qEnt.lte('fecha_hora',statsTo+'T23:59:59');   qSal=qSal.lte('fecha_hora',statsTo+'T23:59:59');   qUlt=qUlt.lte('fecha_hora',statsTo+'T23:59:59');   }

      const [ent,sal,ult]=await Promise.all([qEnt,qSal,qUlt]);
      return {bike, entradas:ent.count||0, salidas:sal.count||0, ultimo:ult.data?.[0]||null};
    }));

    tbody.innerHTML=rows.map(({bike,entradas,salidas,ultimo})=>`
      <tr class="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
        <td class="px-4 py-3 text-slate-300 font-mono text-xs">${esc(bike.cedula)}</td>
        <td class="px-4 py-3 text-white text-xs font-medium">${esc(bike.nombre)}</td>
        <td class="px-4 py-3 text-blue-300 font-mono text-xs break-all">${esc(bike.codigo_qr)}</td>
        <td class="px-4 py-3 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap badge-entrada">
            <span>↓</span><span>${entradas}</span>
          </span>
        </td>
        <td class="px-4 py-3 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap badge-salida">
            <span>↑</span><span>${salidas}</span>
          </span>
        </td>
        <td class="px-4 py-3 text-xs whitespace-nowrap">
          ${ultimo?`
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${ultimo.tipo==='entrada'?'badge-entrada':'badge-salida'}">
              <span>${ultimo.tipo==='entrada'?'↓':'↑'}</span><span>${ultimo.tipo}</span>
            </span>
            <span class="text-slate-400 ml-1">${formatDate(ultimo.fecha_hora)}</span>
          `:'<span class="text-slate-600">Sin movimientos</span>'}
        </td>
      </tr>`).join('');

    const totalPages=Math.max(1,Math.ceil(state.statsTotal/STATS_PER_PAGE));
    document.getElementById('stats-count').textContent=`${state.statsTotal} bicicleta(s)`;
    document.getElementById('stats-page-info').textContent=`Pág. ${state.statsPage} / ${totalPages}`;
    document.getElementById('btn-stats-prev').disabled=state.statsPage<=1;
    document.getElementById('btn-stats-next').disabled=state.statsPage>=totalPages;

  } catch(err){
    console.error('[loadEstadisticas]',err);
    tbody.innerHTML=`<tr><td colspan="6" class="px-4 py-10 text-center text-red-400">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ══════════════════════════════════════
// 13. SYNC OFFLINE
// ══════════════════════════════════════
async function syncOfflineQueue() {
  if(!state.isOnline) return;
  const pending=await getPendingOffline();
  if(!pending.length) return;
  document.getElementById('sync-badge')?.classList.remove('hidden');
  let synced=0;
  for(const rec of pending){
    try{
      const {error}=await sb.from('registros').insert({
        bicicleta_id:rec.bicicleta_id, tipo:rec.tipo,
        fecha_hora:rec.fecha_hora||rec.createdAt, registrado_por:rec.registrado_por||null
      });
      if(!error){ await markSynced(rec.id); synced++; }
    }catch(_){}
  }
  if(synced>0) showToast(`${synced} registro(s) sincronizado(s)`,'success');
  updateSyncBadge();
}

function updateOfflineBanner() {
  document.getElementById('offline-banner')?.classList.toggle('hidden', state.isOnline);
}

// ══════════════════════════════════════
// 14. TEMA CLARO / OSCURO
// ══════════════════════════════════════

/** Aplica el tema guardado al cargar la página */
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'light') {
    html.classList.remove('dark');
    html.classList.add('light');
    document.getElementById('icon-sun')?.classList.remove('hidden');
    document.getElementById('icon-moon')?.classList.add('hidden');
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
    document.getElementById('icon-sun')?.classList.add('hidden');
    document.getElementById('icon-moon')?.classList.remove('hidden');
  }
}

/** Alterna entre tema claro y oscuro */
window.toggleTheme = function() {
  const isDark = document.documentElement.classList.contains('dark');
  const next   = isDark ? 'light' : 'dark';
  localStorage.setItem('vqr_theme', next);
  applyTheme(next);
};

// ══════════════════════════════════════
// 15. LOGOUT
// ══════════════════════════════════════
window.logout = async function() {
  stopScanner();
  await sb.auth.signOut();
  state.currentUser=null; state.currentRole=null;
  localStorage.removeItem('vqr_role');             // ← limpia el rol persistido
  renderLoginView();
};

// ══════════════════════════════════════
// 15. INIT
// ══════════════════════════════════════
async function init() {
  // Aplicar tema guardado antes de renderizar cualquier vista
  applyTheme(localStorage.getItem('vqr_theme') || 'dark');

  window.addEventListener('online', ()=>{ state.isOnline=true; updateOfflineBanner(); updateSyncBadge(); syncOfflineQueue(); showToast('Conexión restaurada','success'); });
  window.addEventListener('offline',()=>{ state.isOnline=false; updateOfflineBanner(); showToast('Sin conexión – modo offline','warning'); });

  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); console.log('[SW] Registrado'); }
    catch(e){ console.warn('[SW]',e); }
  }

  // Mostrar login de inmediato (nunca pantalla negra)
  renderLoginView();

  // Verificar sesión activa en segundo plano
  try {
    const {data:{session}}=await sb.auth.getSession();
    if(session?.user){
      // Leer el rol que fue persistido al hacer login.
      // Si no hay rol guardado o es desconocido → forzar login de nuevo (seguridad).
      const savedRole = localStorage.getItem('vqr_role');

      if(savedRole === 'admin'){
        state.currentUser=session.user;
        state.currentRole='admin';
        renderAdminDashboard();
      } else if(savedRole === 'vigilante'){
        state.currentUser=session.user;
        state.currentRole='vigilante';
        renderGuardView();          // ← vigilante SIEMPRE va al escáner, nunca al dashboard
      } else {
        // Sesión de Supabase activa pero sin rol conocido → cerrar sesión y pedir login
        await sb.auth.signOut();
        localStorage.removeItem('vqr_role');
        // renderLoginView ya fue llamado arriba
      }
    }
    // Si no hay sesión → renderLoginView ya fue llamado arriba
  } catch(err){ console.warn('[init]',err); }
}

document.addEventListener('DOMContentLoaded', init);
