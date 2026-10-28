const { app, request, EMAIL_ADMIN, prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet } = require('../helpers/dados');
const { dbGet, dbRun } = require('../../database/db-promise');

// Tratamento de erro centralizado (BL-11). A falha de banco é simulada renomeando uma
// tabela (ou coluna) do banco em memória: com DB_PATH inválido o server.js nem sobe.
// O afterEach desfaz a quebra, para que cada teste comece com o banco inteiro.
//
// Todo teste aqui provoca erros, então o console.error fica silenciado por um spy,
// que os testes de log usam para conferir o que foi logado.

let agente;
let idAdmin;
let erroNoConsole;
// Comandos que desfazem as quebras do teste atual, executados do último para o primeiro
const restauracoes = [];

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
  const admin = await dbGet('SELECT id FROM usuarios WHERE email = ?', [EMAIL_ADMIN]);
  idAdmin = admin.id;
});
beforeEach(async () => {
  await limparBanco();
  erroNoConsole = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  erroNoConsole.mockRestore();
  while (restauracoes.length) {
    await dbRun(restauracoes.pop());
  }
});
afterAll(fecharBanco);

async function quebrarTabela(tabela) {
  await dbRun(`ALTER TABLE ${tabela} RENAME TO ${tabela}_bkp`);
  restauracoes.push(`ALTER TABLE ${tabela}_bkp RENAME TO ${tabela}`);
}

async function quebrarColuna(tabela, coluna) {
  await dbRun(`ALTER TABLE ${tabela} RENAME COLUMN ${coluna} TO ${coluna}_bkp`);
  restauracoes.push(`ALTER TABLE ${tabela} RENAME COLUMN ${coluna}_bkp TO ${coluna}`);
}

// Página de erro amigável, e não a tela da rota renderizada sem dados
function esperarPaginaDeErro(res, status) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.text).toContain(status === 404 ? 'Página não encontrada' : 'Algo deu errado');
  expect(res.text).not.toContain('class="sidebar"');
}

// Tudo o que foi para o console.error durante o teste
function textoDoLog() {
  return erroNoConsole.mock.calls.map(args => args.join(' ')).join('\n');
}

describe('rota inexistente', () => {
  test('sem sessão, responde 404 com a página amigável e link para o /login', async () => {
    const res = await request(app).get('/rota-que-nao-existe');

    esperarPaginaDeErro(res, 404);
    expect(res.text).toContain('href="/login"');
  });

  test('logado, responde 404 com link de volta para o /dashboard', async () => {
    const res = await agente.get('/rota-que-nao-existe');

    esperarPaginaDeErro(res, 404);
    expect(res.text).toContain('href="/dashboard"');
  });

  test('com Accept: application/json, responde 404 com { ok: false, erro: "nao_encontrado" }', async () => {
    const res = await request(app).get('/rota-que-nao-existe').set('Accept', 'application/json');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, erro: 'nao_encontrado' });
  });
});

describe('falha de banco numa tela', () => {
  test.each([
    ['/dashboard', 'clientes'],
    ['/clientes', 'clientes'],
    ['/pets', 'pets'],
    ['/servicos', 'servicos'],
    ['/agendamentos', 'agendamentos'],
    ['/agendamentos/novo', 'servicos'],
    ['/agendamentos/1/editar', 'agendamentos']
  ])('GET %s com a tabela %s quebrada responde 500 com a página de erro', async (rota, tabela) => {
    await quebrarTabela(tabela);

    const res = await agente.get(rota);
    esperarPaginaDeErro(res, 500);
  });

  test('GET /funcionarios com a coluna funcionarios.telefone quebrada responde 500 com a página de erro', async () => {
    // O middleware também lê usuarios e funcionarios, mas não a coluna telefone: a falha fica na tela
    await quebrarColuna('funcionarios', 'telefone');

    const res = await agente.get('/funcionarios');
    esperarPaginaDeErro(res, 500);
  });

  test('GET /redefinir-senha/:token com a tabela usuarios quebrada responde 500 em vez de redirecionar', async () => {
    await quebrarTabela('usuarios');

    const res = await request(app).get('/redefinir-senha/token-qualquer');
    esperarPaginaDeErro(res, 500);
    expect(res.text).toContain('href="/login"');
  });
});

describe('falha no middleware de autenticação', () => {
  test('logado, com a tabela usuarios quebrada, uma tela protegida responde 500 com a página de erro', async () => {
    // A tela de pets não lê usuarios: quem falha é o verificarAutenticacao
    await quebrarTabela('usuarios');

    const res = await agente.get('/pets');
    esperarPaginaDeErro(res, 500);
  });
});

describe('POST /agendamentos/:id/editar com id inexistente', () => {
  test('com dados válidos responde 500 em vez de derrubar o servidor, e a requisição seguinte funciona', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const banho = await dbGet('SELECT id FROM servicos WHERE nome = ?', ['Banho']);

    // Antes do BL-11 a rejeição não tratada encerrava o processo e a resposta não chegava
    const res = await agente
      .post('/agendamentos/999999/editar')
      .type('form')
      .send({ pet_id: pet.id, servicos: banho.id, data: '2030-01-15', hora: '10:00', status: 'confirmado' })
      .timeout(2000);
    esperarPaginaDeErro(res, 500);

    const seguinte = await agente.get('/agendamentos');
    expect(seguinte.status).toBe(200);
  });
});

describe('JSON malformado', () => {
  test('POST /clientes responde 400 com { ok: false, erro: "requisicao_invalida" }, sem stack e sem log', async () => {
    const res = await agente
      .post('/clientes')
      .set('Content-Type', 'application/json')
      .send('{"nome": "Maria",');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, erro: 'requisicao_invalida' });
    expect(res.text).not.toContain('SyntaxError');
    expect(erroNoConsole).not.toHaveBeenCalled();
  });
});

describe('detalhe do erro na página de 500', () => {
  test('em produção, não mostra a mensagem nem o stack', async () => {
    await quebrarTabela('clientes');

    const ambienteOriginal = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let res;
    try {
      res = await agente.get('/clientes');
    } finally {
      process.env.NODE_ENV = ambienteOriginal;
    }

    esperarPaginaDeErro(res, 500);
    expect(res.text).not.toContain('<pre');
    expect(res.text).not.toContain('no such table');
    expect(res.text).not.toContain('db-promise.js');
  });

  test('fora de produção, mostra a mensagem e o stack', async () => {
    await quebrarTabela('clientes');

    const res = await agente.get('/clientes');
    esperarPaginaDeErro(res, 500);
    expect(res.text).toContain('<pre');
    expect(res.text).toContain('SQLITE_ERROR: no such table: clientes');
    expect(res.text).toContain('db-promise.js');
  });

  test('se a view de erro falhar, responde texto simples com o status', async () => {
    const pastaViews = app.get('views');
    app.set('views', `${pastaViews}-que-nao-existe`);
    let res;
    try {
      res = await request(app).get('/rota-que-nao-existe');
    } finally {
      app.set('views', pastaViews);
    }

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('Erro 404: Página não encontrada');
  });
});

describe('log dos erros', () => {
  test('um 500 loga o método, a URL, o id do usuário da sessão e o stack', async () => {
    await quebrarTabela('clientes');

    await agente.get('/clientes');
    const log = textoDoLog();
    expect(log).toContain(`Erro 500 em GET /clientes (usuário ${idAdmin})`);
    expect(log).toContain('SQLITE_ERROR: no such table: clientes');
    expect(log).toContain('db-promise.js');
  });

  test('um 500 sem sessão loga "-" no lugar do usuário', async () => {
    await quebrarTabela('usuarios');

    await request(app).get('/redefinir-senha/token-qualquer');
    expect(textoDoLog()).toContain('Erro 500 em GET /redefinir-senha/token-qualquer (usuário -)');
  });

  test('um 404 não loga', async () => {
    await agente.get('/rota-que-nao-existe');
    expect(erroNoConsole).not.toHaveBeenCalled();
  });
});

describe('rotas JSON', () => {
  test('com a tabela clientes quebrada, POST /clientes continua respondendo 500 com o corpo atual', async () => {
    await quebrarTabela('clientes');

    const res = await agente.post('/clientes').send({
      nome: 'Maria Souza',
      telefone: '(11) 98765-4321',
      email: 'maria@teste.com'
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, erro: 'erro_db' });
  });
});
