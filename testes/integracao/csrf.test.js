const { app, request, EMAIL_ADMIN, SENHA_ADMIN, prepararBanco, limparBanco, tokenDaPagina, enviarLogin, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbAll } = require('../../database/db-promise');

// Proteção contra CSRF (BL-10). Este arquivo não usa o login() do helper, que deixa o
// agente enviando o token em toda requisição: aqui cada requisição escolhe se envia o
// token e por onde (campo _csrf do formulário ou header X-CSRF-Token).
// O limite de login não atrapalha: o POST /login sem token recebe 403 antes do limite e
// não conta, e os outros logins deste arquivo dão certo.

beforeAll(prepararBanco);
beforeEach(limparBanco);
afterAll(fecharBanco);

const MENSAGEM_403 = 'A página ficou desatualizada ou a sessão expirou.';

// Agente logado como admin, sem header padrão, e o token da sessão logada
async function entrar() {
  const agente = request.agent(app);
  const res = await enviarLogin(agente, EMAIL_ADMIN, SENHA_ADMIN);
  expect(res.status).toBe(302);
  const dashboard = await agente.get('/dashboard');
  return { agente, token: tokenDaPagina(dashboard.text, '/dashboard') };
}

function cookieDeSessao(res) {
  const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
  return cookie ? cookie.split(';')[0] : null;
}

// Página de erro do token recusado, sem sidebar (ver erros.test.js)
function esperarPagina403(res) {
  expect(res.status).toBe(403);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.text).toContain(MENSAGEM_403);
  expect(res.text).not.toContain('class="sidebar"');
}

// Resposta das chamadas fetch que enviam JSON
function esperarJson403(res) {
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ ok: false, erro: 'requisicao_invalida' });
}

async function novoAgendamentoValido() {
  const cliente = await inserirCliente();
  const pet = await inserirPet(cliente.id);
  const banho = await dbGet('SELECT id FROM servicos WHERE nome = ?', ['Banho']);
  return { pet_id: pet.id, servicos: banho.id, data: '2030-01-15', hora: '10:00' };
}

describe('formulários (campo _csrf)', () => {
  test('POST /login sem token responde 403 com a página de erro e não abre a sessão', async () => {
    const agente = request.agent(app);
    await agente.get('/login');

    const res = await agente.post('/login').type('form').send({ email: EMAIL_ADMIN, senha: SENHA_ADMIN });
    esperarPagina403(res);
    expect(res.text).toContain('href="/login"');

    const dashboard = await agente.get('/dashboard');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.location).toBe('/login');
  });

  test('POST /agendamentos sem token responde 403 e não cria o agendamento', async () => {
    const { agente } = await entrar();

    const res = await agente.post('/agendamentos').type('form').send(await novoAgendamentoValido());
    esperarPagina403(res);
    expect(res.text).toContain('href="/dashboard"');
    expect(await dbAll('SELECT id FROM agendamentos')).toEqual([]);
  });

  test('POST /agendamentos com o _csrf da tela de novo agendamento cria o agendamento', async () => {
    const { agente } = await entrar();
    const tela = await agente.get('/agendamentos/novo');

    const res = await agente.post('/agendamentos').type('form')
      .send({ ...(await novoAgendamentoValido()), _csrf: tokenDaPagina(tela.text, '/agendamentos/novo') });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/agendamentos?sucesso=criado');
    expect(await dbAll('SELECT id FROM agendamentos')).toHaveLength(1);
  });

  test('_csrf repetido no formulário (chega como lista) é recusado', async () => {
    const { agente, token } = await entrar();

    const res = await agente.post('/trocar-senha').type('form')
      .send(`nova_senha=123456&confirmar_senha=123456&_csrf=${token}&_csrf=${token}`);
    esperarPagina403(res);
  });
});

describe('chamadas fetch (header X-CSRF-Token)', () => {
  test('PUT /clientes/:id sem o header responde 403 em JSON e não altera o cliente', async () => {
    const { agente } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}`).send({ ...cliente, nome: 'Outro Nome' });
    esperarJson403(res);
    expect((await dbGet('SELECT nome FROM clientes WHERE id = ?', [cliente.id])).nome).toBe(cliente.nome);
  });

  test('PUT /clientes/:id com o token da <meta> no header altera o cliente', async () => {
    const { agente, token } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}`).set('X-CSRF-Token', token).send({ ...cliente, nome: 'Outro Nome' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await dbGet('SELECT nome FROM clientes WHERE id = ?', [cliente.id])).nome).toBe('Outro Nome');
  });

  test('DELETE /clientes/:id sem o header responde 403 e o cliente continua no banco', async () => {
    const { agente } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.delete(`/clientes/${cliente.id}`);
    expect(res.status).toBe(403);
    expect(await dbGet('SELECT id FROM clientes WHERE id = ?', [cliente.id])).toBeDefined();
  });

  test('POST /agendamentos/:id/concluir sem o header responde 403 e não conclui', async () => {
    const { agente } = await entrar();
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const agendamento = await inserirAgendamento({ clienteId: cliente.id, petId: pet.id });

    const res = await agente.post(`/agendamentos/${agendamento.id}/concluir`);
    expect(res.status).toBe(403);
    expect((await dbGet('SELECT status FROM agendamentos WHERE id = ?', [agendamento.id])).status).toBe('confirmado');
  });

  test('o _csrf no corpo JSON não vale: em JSON, só o header', async () => {
    const { agente, token } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}`).send({ ...cliente, nome: 'Outro Nome', _csrf: token });
    esperarJson403(res);
  });

  test('o token na querystring não vale', async () => {
    const { agente, token } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}?_csrf=${token}`).send({ ...cliente, nome: 'Outro Nome' });
    esperarJson403(res);
  });

  test('GET não exige token', async () => {
    const { agente } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.get(`/clientes/${cliente.id}/pets`);
    expect(res.status).toBe(200);
  });
});

describe('token inválido', () => {
  test.each([
    ['vazio', () => ''],
    ['com um caractere trocado', token => token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')]
  ])('token %s responde 403', async (_, alterar) => {
    const { agente, token } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}`).set('X-CSRF-Token', alterar(token)).send(cliente);
    esperarJson403(res);
  });

  test('o token de outra sessão responde 403', async () => {
    const { agente } = await entrar();
    const { token: tokenDeOutraSessao } = await entrar();
    const cliente = await inserirCliente();

    const res = await agente.put(`/clientes/${cliente.id}`).set('X-CSRF-Token', tokenDeOutraSessao).send(cliente);
    esperarJson403(res);
  });

  // O crypto.timingSafeEqual lança erro quando os tamanhos são diferentes: sem a
  // conferência do tamanho antes, estes casos virariam 500 e iriam para o log
  describe('com tamanho errado responde 403, e não 500', () => {
    let erroNoConsole;
    beforeEach(() => {
      erroNoConsole = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => erroNoConsole.mockRestore());

    test.each([
      ['mais curto', token => token.slice(0, 10)],
      ['mais longo', token => token + '00'],
      // Mesmo número de caracteres, mas cada "é" ocupa 2 bytes
      ['com o mesmo número de caracteres e mais bytes', token => 'é'.repeat(token.length)]
    ])('no header: token %s', async (_, alterar) => {
      const { agente, token } = await entrar();
      const cliente = await inserirCliente();

      const res = await agente.put(`/clientes/${cliente.id}`).set('X-CSRF-Token', alterar(token)).send(cliente);
      esperarJson403(res);
      expect(erroNoConsole).not.toHaveBeenCalled();
    });

    test('no formulário: _csrf mais curto', async () => {
      const { agente } = await entrar();

      const res = await agente.post('/trocar-senha').type('form')
        .send({ nova_senha: '123456', confirmar_senha: '123456', _csrf: 'abc' });
      esperarPagina403(res);
      expect(erroNoConsole).not.toHaveBeenCalled();
    });
  });
});

describe('sessão e login', () => {
  test('o login troca o cookie de sessão e o token, e o token de antes do login deixa de valer', async () => {
    const agente = request.agent(app);
    const telaLogin = await agente.get('/login');
    const tokenAnonimo = tokenDaPagina(telaLogin.text, '/login');

    const res = await agente.post('/login').type('form').send({ email: EMAIL_ADMIN, senha: SENHA_ADMIN, _csrf: tokenAnonimo });
    expect(res.status).toBe(302);
    expect(cookieDeSessao(res)).not.toBeNull();
    expect(cookieDeSessao(res)).not.toBe(cookieDeSessao(telaLogin));

    const dashboard = await agente.get('/dashboard');
    expect(tokenDaPagina(dashboard.text, '/dashboard')).not.toBe(tokenAnonimo);

    const cliente = await inserirCliente();
    const comTokenAntigo = await agente.put(`/clientes/${cliente.id}`).set('X-CSRF-Token', tokenAnonimo).send(cliente);
    esperarJson403(comTokenAntigo);
  });

  test('POST /login sem token não conta no limite de login', async () => {
    // Com o limite de 5, se contassem, a 6ª tentativa já seria 429
    for (let tentativa = 1; tentativa <= 6; tentativa++) {
      const res = await request(app).post('/login').type('form').send({ email: EMAIL_ADMIN, senha: 'senha-errada' });
      expect({ tentativa, status: res.status }).toEqual({ tentativa, status: 403 });
    }

    const res = await enviarLogin(request.agent(app), EMAIL_ADMIN, SENHA_ADMIN);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  test('uma página sem formulário não cria sessão para quem não está logado', async () => {
    const res = await request(app).get('/rota-que-nao-existe');
    expect(res.status).toBe(404);
    expect(cookieDeSessao(res)).toBeNull();
  });
});

describe('telas', () => {
  test.each(['/login', '/esqueci-senha'])('GET %s traz o _csrf no formulário', async (rota) => {
    const res = await request(app).get(rota);
    expect(res.text).toMatch(/<input type="hidden" name="_csrf" value="[0-9a-f]{64}">/);
  });

  test('as telas com sidebar trazem a <meta name="csrf-token"> e o /js/csrf.js', async () => {
    const { agente, token } = await entrar();

    const res = await agente.get('/clientes');
    expect(res.text).toContain(`<meta name="csrf-token" content="${token}">`);
    expect(res.text).toContain('<script src="/js/csrf.js"></script>');
  });
});
