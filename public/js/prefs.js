// Preferências do dispositivo (tema, numeração das casas, som). Guardadas em localStorage, com tolerância a falhas.
const KEY = 'dmz_prefs';
const cur = { theme: 'system', numbers: false, sound: true };
try { Object.assign(cur, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* sem armazenamento */ }

export const get = (k) => cur[k];
export function set(k, v) {
  cur[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignora */ }
  apply();
}
export function apply() {
  const r = document.documentElement;
  if (cur.theme === 'light' || cur.theme === 'dark') r.setAttribute('data-theme', cur.theme);
  else r.removeAttribute('data-theme');
}

let ctx = null;
const TONES = { move: [520], opp: [440, 600], end: [392, 330], notice: [660] };
/** Pequenos sons gerados no dispositivo (sem ficheiros de áudio). */
export function beep(kind) {
  if (!cur.sound) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    let t = ctx.currentTime;
    for (const f of TONES[kind] || TONES.move) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.15);
      t += 0.11;
    }
  } catch { /* sem áudio */ }
}
