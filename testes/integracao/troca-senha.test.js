const { app, request, EMAIL_ADMIN, prepararBanco, limparBanco, enviarLogin, usarTokenDaPagina, login, fecharBanco } = require('../helpers/app');
const { inserirFuncionario } = require('../helpers/dados');
const bancoPronto = require('../../database/init');
const { dbGet, dbRun } = require('../../database/db-promise');

// O prepararBanco zera a flag do admin e o login() do helper exige redirect para
// /dashboard. Por isso o fluxo usa um funcionário com a flag ligada direto no banco,
// e o login com a troca pendente é feito com request.agent.
// O limite de login conta as respostas com status 400 ou mais (ver autenticacao.test.js).
// Este arquivo faz 1 login com 401; os 400 do POST /trocar-senha não contam.

const SENHA_ATUAL = 'senha-atual-123';
const SENHA_NOVA = 'senha-nova-456';

// Lida antes do prepararBanco, que zera a flag do admin
let flagAdminNoSeed;

beforeAll(async () => {
  await bancoPronto;
  const admin = await dbGet('SELECT deve_trocar_senha FROM usuarios WHERE email = ?', [EMAIL_ADMIN]);
  flagAdminNoSeed = admin.deve_trocar_senha;

  await prepararBanco();
});
beforeEach(limparBanco);
afterAll(fecharBanco);

// Abre a tela de login antes, para enviar o token anti-CSRF (BL-10): o agente precisa
// ser um request.agent, que guarda o cookie da sessão entre o GET e o POST
function postLogin(agente, email, senha) {
  return enviarLogin(agente, email, senha);
}

function postTrocarSenha(agente, novaSenha, confirmarSenha = novaSenha) {
  return agente.post('/trocar-senha').type('form').send({ nova_senha: novaSenha, confirmar_senha: confirmarSenha });
}

async function buscarFlag(usuarioId) {
  const linha = await dbGet('SELECT deve_trocar_senha FROM usuarios WHERE id = ?', [usuarioId]);
  return linha.deve_trocar_senha;
}

// Funcionário com a troca obrigatória pendente
async function inserirFuncionarioComTroca() {
  const funcionario = await inserirFuncionario({ senha: SENHA_ATUAL });
  await dbRun('UPDATE usuarios SET deve_trocar_senha = 1 WHERE id = ?', [funcionario.usuarioId]);
  return funcionario;
}

// Login de quem tem a troca pendente: confere o redirect e devolve o agente com a sessão
async function entrarComTrocaPendente(funcionario) {
  const agente = request.agent(app);
  const res = await postLogin(agente, funcionario.email, funcionario.senha);
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/trocar-senha');
  // O login troca a sessão e, com ela, o token: o token novo vem do formulário de troca
  return usarTokenDaPagina(agente, '/trocar-senha');
}

describe('seed do admin', () => {
  test('cria o admin com deve_trocar_senha = 1', () => {
    expect(flagAdminNoSeed).toBe(1);
  });
});

describe('com deve_trocar_senha = 1', () => {
  test('o login redireciona para /trocar-senha, que abre o formulário', async () => {
    const funcionario = await inserirFuncionarioComTroca();
    const agente = await entrarComTrocaPendente(funcionario);

    const res = await agente.get('/trocar-senha');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Troque sua senha');
  });

  test.each(['/dashboard', '/clientes'])('GET %s redireciona para /trocar-senha', async (rota) => {
    const funcionario = await inserirFuncionarioComTroca();
    const agente = await entrarComTrocaPendente(funcionario);

    const res = await agente.get(rota);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/trocar-senha');
  });
});

describe('POST /trocar-senha', () => {
  test.each([
    ['com menos de 6 caracteres', '12345', '12345', 'A senha deve ter no mínimo 6 caracteres.'],
    ['com confirmação diferente', SENHA_NOVA, 'outra-senha-789', 'As senhas não conferem.'],
    ['igual à atual', SENHA_ATUAL, SENHA_ATUAL, 'A nova senha deve ser diferente da atual.']
  ])('recusa senha %s com 400 e a mensagem, sem mudar a flag', async (_, novaSenha, confirmarSenha, mensagem) => {
    const funcionario = await inserirFuncionarioComTroca();
    const agente = await entrarComTrocaPendente(funcionario);

    const res = await postTrocarSenha(agente, novaSenha, confirmarSenha);
    expect(res.status).toBe(400);
    expect(res.text).toContain(mensagem);
    expect(await buscarFlag(funcionario.usuarioId)).toBe(1);
  });

  test('com dados válidos responde 200 com a mensagem de sucesso, zera a flag e libera o /dashboard', async () => {
    const funcionario = await inserirFuncionarioComTroca();
    const agente = await entrarComTrocaPendente(funcionario);

    const res = await postTrocarSenha(agente, SENHA_NOVA);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Senha alterada com sucesso!');
    expect(await buscarFlag(funcionario.usuarioId)).toBe(0);

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(200);
  });

  test('depois da troca, o login com a senha nova vai para /dashboard e a senha antiga não entra', async () => {
    const funcionario = await inserirFuncionarioComTroca();
    const agente = await entrarComTrocaPendente(funcionario);
    expect((await postTrocarSenha(agente, SENHA_NOVA)).status).toBe(200);

    // Falha com mensagem clara se o login não redirecionar para /dashboard
    await login(funcionario.email, SENHA_NOVA);

    const antiga = await postLogin(request.agent(app), funcionario.email, SENHA_ATUAL);
    expect(antiga.status).toBe(401);
    expect(antiga.text).toContain('Email ou senha inválidos.');
  });
});

describe('com deve_trocar_senha = 0', () => {
  test('o login vai direto para /dashboard', async () => {
    const funcionario = await inserirFuncionario();
    expect(await buscarFlag(funcionario.usuarioId)).toBe(0);

    const agente = request.agent(app);
    const res = await postLogin(agente, funcionario.email, funcionario.senha);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(200);
  });
});
