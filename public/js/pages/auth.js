// Início de sessão, registo e recuperação de acesso.
import { h, icon, brandMark, toast, clear } from '/js/ui.js';
import { POST, setMe, GET } from '/js/api.js';

export default function auth(root, onDone) {
  let mode = 'login';
  const card = h('div', { class: 'card auth-card stack' });
  clear(root).append(h('div', { class: 'auth' }, card));

  const field = (label, name, type, extra = {}) =>
    h('div', { class: 'field' }, h('label', { for: 'f-' + name, text: label }), h('input', { id: 'f-' + name, name, type, required: true, autocomplete: extra.autocomplete, minlength: extra.minlength, maxlength: extra.maxlength, spellcheck: 'false', autocapitalize: 'none' }), extra.hint ? h('span', { class: 'hint', text: extra.hint }) : null);

  function recoveryModal(code, title, after) {
    let ok = false;
    const cont = h('button', { class: 'btn primary block', disabled: true, onclick: () => { wrap.remove(); document.body.classList.remove('modal-open'); after(); } }, 'Continuar');
    const chk = h('input', { type: 'checkbox', id: 'saved', onchange: (e) => { ok = e.target.checked; cont.disabled = !ok; } });
    const copyBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Código copiado.'); } catch { toast('Copie o código manualmente.', 'err'); } } }, icon('copy'), 'Copiar');
    const wrap = h('div', { class: 'modal-wrap', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal stack' },
        h('h2', { text: title }),
        h('p', { class: 'muted', text: 'Este código permite recuperar o acesso se esquecer a palavra-passe. É mostrado apenas agora. Guarde-o num local seguro e não o partilhe.' }),
        h('div', { class: 'code-box', text: code }),
        h('div', { class: 'row between' }, copyBtn),
        h('label', { class: 'row small', for: 'saved' }, chk, 'Guardei o código num local seguro.'),
        cont));
    document.body.append(wrap);
    document.body.classList.add('modal-open');
  }

  function draw(msg) {
    const err = h('div', { class: 'error', role: 'alert', text: msg || '' });
    const title = { login: 'Entrar', register: 'Criar conta', recover: 'Recuperar acesso' }[mode];
    const form = h('form', { class: 'stack', novalidate: false });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, title);
    if (mode === 'login') form.append(field('Nome de utilizador', 'username', 'text', { autocomplete: 'username' }), field('Palavra-passe', 'password', 'password', { autocomplete: 'current-password' }));
    if (mode === 'register') form.append(field('Nome de utilizador', 'username', 'text', { autocomplete: 'username', minlength: 3, maxlength: 20, hint: '3 a 20 caracteres: letras, números, ponto (.), _ e -.' }), field('Palavra-passe', 'password', 'password', { autocomplete: 'new-password', minlength: 8, hint: 'Pelo menos 8 caracteres.' }), field('Repetir palavra-passe', 'password2', 'password', { autocomplete: 'new-password', minlength: 8 }));
    if (mode === 'recover') form.append(field('Nome de utilizador', 'username', 'text', { autocomplete: 'username' }), field('Código de recuperação', 'code', 'text', { hint: 'Formato XXXX-XXXX-XXXX-XXXX.' }), field('Nova palavra-passe', 'password', 'password', { autocomplete: 'new-password', minlength: 8 }));
    form.append(err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      btn.disabled = true;
      try {
        if (mode === 'login') {
          await POST('/api/auth/login', { username: v.username.trim(), password: v.password });
          setMe(await GET('/api/me'));
          onDone();
        } else if (mode === 'register') {
          if (v.password !== v.password2) throw new Error('As palavras-passe não coincidem.');
          const r = await POST('/api/auth/register', { username: v.username.trim(), password: v.password });
          setMe(await GET('/api/me'));
          recoveryModal(r.recoveryCode, 'Guarde o seu código de recuperação', onDone);
        } else {
          const r = await POST('/api/auth/recover', { username: v.username.trim(), recoveryCode: v.code.trim().toUpperCase(), newPassword: v.password });
          recoveryModal(r.recoveryCode, 'Novo código de recuperação', () => { mode = 'login'; draw('Palavra-passe alterada. Entre com a nova palavra-passe.'); });
        }
      } catch (ex) {
        btn.disabled = false;
        err.textContent = ex.message;
      }
    });
    const links = h('div', { class: 'stack sm', style: undefined },
      mode !== 'login' ? h('button', { class: 'btn sm block', type: 'button', onclick: () => { mode = 'login'; draw(); } }, 'Já tenho conta — Entrar') : null,
      mode !== 'register' ? h('button', { class: 'btn sm block', type: 'button', onclick: () => { mode = 'register'; draw(); } }, 'Criar conta') : null,
      mode === 'login' ? h('button', { class: 'btn sm block', type: 'button', onclick: () => { mode = 'recover'; draw(); } }, 'Esqueci a palavra-passe') : null);
    clear(card).append(
      h('div', { class: 'auth-brand' }, brandMark(), h('div', {}, h('h1', { text: 'DAMAS MZ' }), h('p', { class: 'muted', text: 'Damas online para Moçambique' }))),
      h('h2', { text: title }), form, links,
      h('p', { class: 'small faint', text: 'O XP serve apenas para classificação e progressão. Planos pagos dependem de confirmação válida do provedor.' }));
    card.querySelector('input')?.focus();
  }
  draw();
}
