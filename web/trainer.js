'use strict';
// Runs the game in the page and records the buttons held on every frame.
(async () => {
  const token = new URLSearchParams(location.search).get('t');
  const q = (path) => path + '?t=' + token;
  const status = document.getElementById('status');
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');

  // SNES buttons, in the order the console shifts them out
  const BTN = { B: 1, Y: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, A: 256, X: 512, L: 1024, R: 2048 };
  // physical key positions (same place on AZERTY and QWERTY keyboards)
  const KEYS = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
    KeyZ: 'B', KeyX: 'A', KeyA: 'Y', KeyS: 'X', KeyQ: 'L', KeyW: 'R', Enter: 'START', ShiftRight: 'SELECT', ShiftLeft: 'SELECT',
  };
  const NAMES = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', B: 'B (saut dans beaucoup de jeux)', A: 'A', Y: 'Y', X: 'X',
                  L: 'L', R: 'R', START: 'Start', SELECT: 'Select' };

  // show the letters printed on this keyboard when the browser can tell
  let layout = null;
  try { if (navigator.keyboard && navigator.keyboard.getLayoutMap) layout = await navigator.keyboard.getLayoutMap(); } catch (e) {}
  const label = (code) => {
    if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code];
    if (code === 'Enter') return 'Entrée';
    if (code.startsWith('Shift')) return 'Maj';
    const k = layout && layout.get(code);
    return (k || code.replace('Key', '')).toUpperCase();
  };
  const rows = {};
  for (const [code, btn] of Object.entries(KEYS)) {
    if (code === 'ShiftLeft' || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(btn)) continue;
    rows[btn] = label(code);
  }
  const table = document.getElementById('keys');
  const addRow = (a, b) => { const tr = table.insertRow(); tr.insertCell().textContent = a; tr.insertCell().innerHTML = b; };
  addRow('Croix directionnelle', '<kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd>');
  for (const btn of ['B', 'A', 'Y', 'X', 'L', 'R', 'START', 'SELECT']) addRow(NAMES[btn], '<kbd>' + rows[btn] + '</kbd>');

  // ---- load the core and the game
  const [wasm, romResp] = await Promise.all([
    WebAssembly.instantiateStreaming(fetch(q('/nwsnes.wasm')), {}),
    fetch(q('/rom')),
  ]);
  const x = wasm.instance.exports;
  if (x._initialize) x._initialize();
  const rom = new Uint8Array(await romResp.arrayBuffer());
  document.getElementById('title').textContent = decodeURIComponent(romResp.headers.get('X-Title') || 'Jeu');
  const p = x.nsw_alloc(rom.length);
  new Uint8Array(x.memory.buffer).set(rom, p);
  if (x.nsw_load_rom(p, rom.length) !== 0 || x.nsw_session(0, 0, 0, 0) !== 0) {
    status.textContent = 'Impossible de charger ce jeu.';
    return;
  }

  // ---- input
  let keys = 0;
  addEventListener('keydown', (e) => { const b = KEYS[e.code]; if (b) { keys |= BTN[b]; e.preventDefault(); } });
  addEventListener('keyup', (e) => { const b = KEYS[e.code]; if (b) { keys &= ~BTN[b]; e.preventDefault(); } });
  addEventListener('blur', () => { keys = 0; });
  const padState = () => {
    let s = 0;
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!g || g.mapping !== 'standard') continue;
      const on = (i) => g.buttons[i] && g.buttons[i].pressed;
      if (on(0)) s |= BTN.B; if (on(1)) s |= BTN.A; if (on(2)) s |= BTN.Y; if (on(3)) s |= BTN.X;
      if (on(4)) s |= BTN.L; if (on(5)) s |= BTN.R; if (on(8)) s |= BTN.SELECT; if (on(9)) s |= BTN.START;
      if (on(12)) s |= BTN.UP; if (on(13)) s |= BTN.DOWN; if (on(14)) s |= BTN.LEFT; if (on(15)) s |= BTN.RIGHT;
    }
    return s;
  };

  // ---- main loop: 60 emulated frames per second whatever the display rate
  const movie = [];
  const image = ctx.createImageData(256, 224);
  const pixels = new Uint32Array(image.data.buffer);
  const draw = () => {
    const fb = new Uint16Array(x.memory.buffer, x.nsw_fb(), 256 * 224);
    for (let i = 0; i < fb.length; i++) {
      const c = fb[i];
      const r = ((c >> 11) & 31) * 255 / 31 | 0, g = ((c >> 5) & 63) * 255 / 63 | 0, b = (c & 31) * 255 / 31 | 0;
      pixels[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    ctx.putImageData(image, 0, 0);
  };
  const frameMs = x.nsw_info(1) ? 20 : 1000 / 60;
  let last = performance.now(), acc = 0, running = true;
  const tick = (now) => {
    if (!running) return;
    acc = Math.min(acc + (now - last), 100);
    last = now;
    let ran = false;
    while (acc >= frameMs) {
      const pad = keys | padState();
      x.nsw_frame(pad, 0);
      movie.push(pad);
      acc -= frameMs;
      ran = true;
    }
    if (ran) {
      draw();
      if (movie.length % 30 === 0) {
        const sec = Math.floor(movie.length * frameMs / 1000);
        document.getElementById('time').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
        document.getElementById('ram').textContent = Math.round(x.nsw_stat(1) / 4) + ' Ko';
      }
    }
    requestAnimationFrame(tick);
  };
  status.textContent = 'Cliquez sur l’écran du jeu puis jouez au clavier.';
  canvas.focus();
  requestAnimationFrame(tick);

  const finish = async (path, message) => {
    running = false;
    const body = path === '/done' ? new Uint8Array(new Uint16Array(movie).buffer) : new Uint8Array(0);
    status.textContent = 'Envoi…';
    try {
      await fetch(q(path), { method: 'POST', body });
      status.textContent = message;
    } catch (e) {
      status.textContent = 'Le programme snes2nw ne répond plus. Relancez-le.';
    }
    document.getElementById('done').disabled = document.getElementById('cancel').disabled = true;
  };
  document.getElementById('done').onclick = () =>
    finish('/done', 'Partie envoyée. Vous pouvez fermer cet onglet et retourner dans la fenêtre de commande.');
  document.getElementById('cancel').onclick = () => finish('/cancel', 'Annulé. Vous pouvez fermer cet onglet.');
})();
