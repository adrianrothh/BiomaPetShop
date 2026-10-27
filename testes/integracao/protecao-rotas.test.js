const { app, request, prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirFuncionario } = require('../helpers/dados');

beforeAll(prepararBanco);
beforeEach(limparBanco);
afterAll(fecharBanco);

describe('sem sessão', () => {
  test.each([
    '/dashboard',
    '/clientes',
    '/pets',
    '/servicos',
    '/agendamentos',
    '/funcionarios'
  ])('GET %s redireciona para /login', async (rota) => {
    const res = await request(app).get(rota);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('área de funcionários (só administrador)', () => {
  test('funcionário que acessa /funcionarios é redirecionado para /dashboard', async () => {
    const funcionario = await inserirFuncionario();
    const agente = await login(funcionario.email, funcionario.senha);

    const res = await agente.get('/funcionarios');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  test('administrador acessa /funcionarios', async () => {
    const agente = await login();

    const res = await agente.get('/funcionarios');
    expect(res.status).toBe(200);
  });
});
