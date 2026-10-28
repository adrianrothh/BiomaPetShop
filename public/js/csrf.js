// Token anti-CSRF da sessão (BL-10), que o layout principal publica na <meta name="csrf-token">.
// As chamadas fetch que alteram dados (POST, PUT e DELETE) enviam o valor no header X-CSRF-Token.
function tokenCsrf() {
  return document.querySelector('meta[name="csrf-token"]').content;
}
