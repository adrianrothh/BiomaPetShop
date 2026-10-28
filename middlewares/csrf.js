const crypto = require('crypto');

// Proteção contra CSRF (BL-10) com token sincronizado: um token aleatório por sessão,
// guardado em req.session.csrfToken. Os formulários enviam o token no campo _csrf e as
// chamadas fetch no header X-CSRF-Token.

// Devolve o token da sessão e o cria na primeira vez. Para quem não está logado, é a
// criação do token que faz o express-session gravar a sessão e enviar o cookie.
function tokenCsrf(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

// Métodos sem efeito colateral: não exigem o token
const METODOS_SEGUROS = ['GET', 'HEAD', 'OPTIONS'];

// Token enviado pela tela: o header X-CSRF-Token, das chamadas fetch, ou o campo _csrf,
// só quando o corpo é de formulário. Nunca da querystring, que vaza em log e no Referer.
function tokenRecebido(req) {
  const doHeader = req.get('X-CSRF-Token');
  if (doHeader !== undefined) return doHeader;
  if (req.is('application/x-www-form-urlencoded')) return req.body._csrf;
  return undefined;
}

// Comparação em tempo constante. O timingSafeEqual lança erro quando os tamanhos são
// diferentes, por isso o tamanho é conferido antes: token com tamanho errado dá 403, e não 500.
function tokensIguais(recebido, esperado) {
  if (typeof recebido !== 'string' || typeof esperado !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST, PUT e DELETE sem o token da sessão recebem 403 pelo handler central de erros
function protecaoCsrf(req, res, next) {
  if (METODOS_SEGUROS.includes(req.method)) return next();
  if (tokensIguais(tokenRecebido(req), req.session.csrfToken)) return next();

  const err = new Error('Token anti-CSRF ausente ou inválido');
  err.status = 403;
  // Mesmo código do csurf; o handler de erros usa para escolher a mensagem da página
  err.code = 'EBADCSRFTOKEN';
  next(err);
}

module.exports = { tokenCsrf, protecaoCsrf };
