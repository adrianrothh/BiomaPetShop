const { prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbAll } = require('../../database/db-promise');

// As rotas JSON respondem 200 também nos erros, com { ok: false, erro }. É o
// comportamento atual: status e erro são conferidos separados para o BL-12.

let agente;

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
});
beforeEach(limparBanco);
afterAll(fecharBanco);

const clienteValido = {
  nome: 'maria souza',
  telefone: '(11) 98765-4321',
  email: 'maria@teste.com'
};

function buscarCliente(id) {
  return dbGet('SELECT nome, telefone, email FROM clientes WHERE id = ?', [id]);
}

async function contarClientes() {
  const linha = await dbGet('SELECT COUNT(*) AS total FROM clientes');
  return linha.total;
}

describe('POST /clientes', () => {
  test('cria o cliente com o nome capitalizado', async () => {
    const res = await agente.post('/clientes').send(clienteValido);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const linha = await dbGet('SELECT nome, telefone, email FROM clientes WHERE email = ?', [clienteValido.email]);
    expect(linha).toEqual({ nome: 'Maria Souza', telefone: '(11) 98765-4321', email: 'maria@teste.com' });
  });

  test('recusa telefone já cadastrado (RN01)', async () => {
    await inserirCliente({ telefone: clienteValido.telefone });

    const res = await agente.post('/clientes').send(clienteValido);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('telefone_duplicado');
    expect(await contarClientes()).toBe(1);
  });

  test('recusa email já cadastrado (RN01)', async () => {
    await inserirCliente({ email: clienteValido.email });

    const res = await agente.post('/clientes').send(clienteValido);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('email_duplicado');
    expect(await contarClientes()).toBe(1);
  });

  test.each([
    ['sem nome', { nome: '' }],
    ['nome só com espaços', { nome: '   ' }],
    ['sem telefone', { telefone: '' }],
    ['telefone fora do padrão', { telefone: '1234-5678' }],
    ['sem email', { email: '' }],
    ['email fora do padrão', { email: 'maria@teste' }]
  ])('recusa dados inválidos: %s', async (_, campos) => {
    const res = await agente.post('/clientes').send({ ...clienteValido, ...campos });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('dados_invalidos');
    expect(await contarClientes()).toBe(0);
  });
});

describe('GET /clientes', () => {
  test('lista o cliente cadastrado', async () => {
    await inserirCliente({ nome: 'Carlos Lima' });

    const res = await agente.get('/clientes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Carlos Lima');
  });
});

describe('PUT /clientes/:id', () => {
  test('edita nome, telefone e email', async () => {
    const cliente = await inserirCliente();

    const res = await agente
      .put(`/clientes/${cliente.id}`)
      .send({ nome: 'joão pereira', telefone: '(21) 3456-7890', email: 'joao@teste.com.br' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await buscarCliente(cliente.id)).toEqual({
      nome: 'João Pereira',
      telefone: '(21) 3456-7890',
      email: 'joao@teste.com.br'
    });
  });

  test('aceita manter o próprio telefone e email', async () => {
    const cliente = await inserirCliente();

    const res = await agente
      .put(`/clientes/${cliente.id}`)
      .send({ nome: 'Nome Novo', telefone: cliente.telefone, email: cliente.email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await buscarCliente(cliente.id)).nome).toBe('Nome Novo');
  });

  test('recusa telefone de outro cliente (RN01)', async () => {
    const outro = await inserirCliente();
    const cliente = await inserirCliente();

    const res = await agente
      .put(`/clientes/${cliente.id}`)
      .send({ nome: cliente.nome, telefone: outro.telefone, email: cliente.email });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('telefone_duplicado');
    expect((await buscarCliente(cliente.id)).telefone).toBe(cliente.telefone);
  });

  test('recusa email de outro cliente (RN01)', async () => {
    const outro = await inserirCliente();
    const cliente = await inserirCliente();

    const res = await agente
      .put(`/clientes/${cliente.id}`)
      .send({ nome: cliente.nome, telefone: cliente.telefone, email: outro.email });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('email_duplicado');
    expect((await buscarCliente(cliente.id)).email).toBe(cliente.email);
  });

  test.each([
    ['sem nome', { nome: '' }],
    ['telefone fora do padrão', { telefone: 'abc' }],
    ['email fora do padrão', { email: 'joao@teste.io' }]
  ])('recusa dados inválidos: %s', async (_, campos) => {
    const cliente = await inserirCliente();
    const dados = { nome: cliente.nome, telefone: cliente.telefone, email: cliente.email };

    const res = await agente.put(`/clientes/${cliente.id}`).send({ ...dados, ...campos });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('dados_invalidos');
    expect(await buscarCliente(cliente.id)).toEqual(dados);
  });
});

describe('DELETE /clientes/:id', () => {
  test('exclui o cliente', async () => {
    const cliente = await inserirCliente();

    const res = await agente.delete(`/clientes/${cliente.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await buscarCliente(cliente.id)).toBeUndefined();
  });

  test('remove pets, agendamentos e agendamento_servicos do cliente e preserva os dos outros', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const agendamento = await inserirAgendamento({ clienteId: cliente.id, petId: pet.id });

    const outroCliente = await inserirCliente();
    const outroPet = await inserirPet(outroCliente.id);
    const outroAgendamento = await inserirAgendamento({ clienteId: outroCliente.id, petId: outroPet.id });

    const res = await agente.delete(`/clientes/${cliente.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await buscarCliente(cliente.id)).toBeUndefined();
    expect(await dbAll('SELECT id FROM pets WHERE cliente_id = ?', [cliente.id])).toEqual([]);
    expect(await dbAll('SELECT id FROM agendamentos WHERE id = ?', [agendamento.id])).toEqual([]);
    expect(await dbAll('SELECT id FROM agendamento_servicos WHERE agendamento_id = ?', [agendamento.id])).toEqual([]);

    expect(await buscarCliente(outroCliente.id)).toBeDefined();
    expect(await dbAll('SELECT id FROM pets WHERE cliente_id = ?', [outroCliente.id])).toEqual([{ id: outroPet.id }]);
    expect(await dbAll('SELECT id FROM agendamentos WHERE id = ?', [outroAgendamento.id])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM agendamento_servicos WHERE agendamento_id = ?', [outroAgendamento.id])).toHaveLength(1);
  });
});
