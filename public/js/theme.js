// Aplica o tema guardado antes de pintar (evita "flash"). Script clássico e externo por causa da CSP.
try {
  const p = JSON.parse(localStorage.getItem('dmz_prefs') || '{}');
  if (p.theme === 'light' || p.theme === 'dark') document.documentElement.setAttribute('data-theme', p.theme);
} catch { /* armazenamento indisponível: segue o tema do sistema */ }
