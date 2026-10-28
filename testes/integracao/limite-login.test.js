const { app, request, EMAIL_ADMIN, SENHA_ADMIN, prepararBanco, enviarLogin, fecharBanco } = require('../helpers/app');

// Arquivo só para o limite de login. O contador do express-rate-limit fica em memória
// e vale para o arquivo inteiro (todas as requisições vêm do mesmo IP), então o
// cenário fica num teste só: dividido, o resultado dependeria da ordem dos testes.

beforeAll(prepararBanco);
afterAll(fecharBanco);

// Cada tentativa é um navegador sem sessão: abre a tela de login, que traz o token
// anti-CSRF (BL-10), e envia o formulário. O GET /login não conta no limite.
function postLogin(email, senha) {
  return enviarLogin(request.agent(app), email, senha);
}

test('5 logins errados recebem 401 e o 6º recebe 429', async () => {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const res = await postLogin(EMAIL_ADMIN, 'senha-errada');
    expect({ tentativa, status: res.status }).toEqual({ tentativa, status: 401 });
  }

  const bloqueada = await postLogin(EMAIL_ADMIN, 'senha-errada');
  expect(bloqueada.status).toBe(429);
  expect(bloqueada.text).toContain('Muitas tentativas de login.');

  // Enquanto o bloqueio dura, nem a senha certa entra
  const senhaCerta = await postLogin(EMAIL_ADMIN, SENHA_ADMIN);
  expect(senhaCerta.status).toBe(429);
});
