const { app, request, EMAIL_ADMIN, SENHA_ADMIN, prepararBanco, limparBanco, enviarLogin, login, fecharBanco } = require('../helpers/app');
const { inserirFuncionario } = require('../helpers/dados');

// O limite de login conta as respostas com status 400 ou mais e vale para o arquivo
// inteiro, porque todas as requisições vêm do mesmo IP. Ao bater 5, o próximo login
// recebe 429. Este arquivo faz 2 logins com 401: não passe de 4.

beforeAll(prepararBanco);
beforeEach(limparBanco);
afterAll(fecharBanco);

// Abre a tela de login antes, para enviar o token anti-CSRF (BL-10): o agente precisa
// ser um request.agent, que guarda o cookie da sessão entre o GET e o POST
function postLogin(agente, email, senha) {
  return enviarLogin(agente, email, senha);
}

describe('POST /login', () => {
  test('com email e senha válidos redireciona para /dashboard e abre a sessão', async () => {
    const agente = request.agent(app);
    const res = await postLogin(agente, EMAIL_ADMIN, SENHA_ADMIN);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(200);
  });

  test('com senha errada responde 401', async () => {
    const res = await postLogin(request.agent(app), EMAIL_ADMIN, 'senha-errada');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Email ou senha inválidos.');
  });

  test('com email inexistente responde 401', async () => {
    const res = await postLogin(request.agent(app), 'ninguem@biomapet.com', SENHA_ADMIN);

    expect(res.status).toBe(401);
    expect(res.text).toContain('Email ou senha inválidos.');
  });

  // Status 200 é o comportamento atual (ver BL-12); por isso não conta no limite de login
  test.each([
    ['com email e senha vazios', '', ''],
    ['sem senha', EMAIL_ADMIN, ''],
    ['sem email', '', SENHA_ADMIN]
  ])('%s responde 200 pedindo para preencher', async (_, email, senha) => {
    const res = await postLogin(request.agent(app), email, senha);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Preencha email e senha.');
  });

  // Status 200 é o comportamento atual (ver BL-12); por isso não conta no limite de login
  test('com usuário inativo responde 200 com "Usuário Inativo." e não abre a sessão', async () => {
    const funcionario = await inserirFuncionario({ ativo: 0 });
    const agente = request.agent(app);

    const res = await postLogin(agente, funcionario.email, funcionario.senha);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Usuário Inativo.');

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.location).toBe('/login');
  });
});

describe('sessão', () => {
  test('é derrubada quando o admin desativa o usuário', async () => {
    const funcionario = await inserirFuncionario();
    const agenteFuncionario = await login(funcionario.email, funcionario.senha);
    expect((await agenteFuncionario.get('/dashboard')).status).toBe(200);

    const admin = await login();
    const desativar = await admin
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send({ nome: funcionario.nome, telefone: null, ativo: 0, nova_senha: null });
    expect(desativar.body).toEqual({ ok: true });

    const res = await agenteFuncionario.get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');

    // A sessão foi destruída: mesmo reativado, o funcionário precisa entrar de novo
    await admin
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send({ nome: funcionario.nome, telefone: null, ativo: 1, nova_senha: null });
    const depois = await agenteFuncionario.get('/dashboard');
    expect(depois.status).toBe(302);
    expect(depois.headers.location).toBe('/login');
  });

  test('é derrubada quando o admin exclui o usuário', async () => {
    const funcionario = await inserirFuncionario();
    const agenteFuncionario = await login(funcionario.email, funcionario.senha);
    expect((await agenteFuncionario.get('/dashboard')).status).toBe(200);

    const admin = await login();
    const excluir = await admin.delete(`/funcionarios/${funcionario.usuarioId}`);
    expect(excluir.body).toEqual({ ok: true });

    const res = await agenteFuncionario.get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('GET /logout destrói a sessão e redireciona para /login', async () => {
    const agente = await login();

    const res = await agente.get('/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.location).toBe('/login');
  });

  test('GET /login com sessão ativa redireciona para /dashboard', async () => {
    const agente = await login();

    const res = await agente.get('/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });
});
