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

// cliente_id vai como texto, igual ao valor do <select> do formulário
function petValido(clienteId) {
  return { nome: 'thor', especie: 'cao', raca: 'golden retriever', porte: 'Grande', cliente_id: String(clienteId) };
}

function buscarPet(id) {
  return dbGet('SELECT nome, especie, raca, porte, cliente_id FROM pets WHERE id = ?', [id]);
}

const camposObrigatorios = [
  ['sem nome', { nome: '' }],
  ['nome só com espaços', { nome: '  ' }],
  ['sem espécie', { especie: '' }],
  ['sem raça', { raca: '' }],
  ['sem porte', { porte: '' }],
  ['sem cliente', { cliente_id: '' }]
];

describe('POST /pets', () => {
  test('cria o pet com nome e raça capitalizados', async () => {
    const cliente = await inserirCliente();

    const res = await agente.post('/pets').send(petValido(cliente.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const pets = await dbAll('SELECT nome, especie, raca, porte, cliente_id FROM pets');
    expect(pets).toEqual([
      { nome: 'Thor', especie: 'cao', raca: 'Golden Retriever', porte: 'Grande', cliente_id: cliente.id }
    ]);
  });

  test.each(camposObrigatorios)('recusa campos obrigatórios faltando: %s', async (_, campos) => {
    const cliente = await inserirCliente();

    const res = await agente.post('/pets').send({ ...petValido(cliente.id), ...campos });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('Campos obrigatórios faltando');
    expect(await dbAll('SELECT id FROM pets')).toEqual([]);
  });
});

describe('PUT /pets/:id', () => {
  test('edita os dados e o dono do pet', async () => {
    const cliente = await inserirCliente();
    const novoDono = await inserirCliente();
    const pet = await inserirPet(cliente.id);

    const res = await agente
      .put(`/pets/${pet.id}`)
      .send({ nome: 'mimi', especie: 'gato', raca: 'siamês', porte: 'Pequeno', cliente_id: String(novoDono.id) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await buscarPet(pet.id)).toEqual({
      nome: 'Mimi',
      especie: 'gato',
      raca: 'Siamês',
      porte: 'Pequeno',
      cliente_id: novoDono.id
    });
  });

  test.each(camposObrigatorios)('recusa campos obrigatórios faltando: %s', async (_, campos) => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);

    const res = await agente.put(`/pets/${pet.id}`).send({ ...petValido(cliente.id), ...campos });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('Campos obrigatórios faltando');
    expect((await buscarPet(pet.id)).nome).toBe(pet.nome);
  });
});

describe('DELETE /pets/:id', () => {
  test('exclui o pet', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);

    const res = await agente.delete(`/pets/${pet.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await buscarPet(pet.id)).toBeUndefined();
  });

  test('remove os agendamentos do pet e mantém o cliente', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const agendamento = await inserirAgendamento({ clienteId: cliente.id, petId: pet.id });

    const res = await agente.delete(`/pets/${pet.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await dbAll('SELECT id FROM agendamentos WHERE id = ?', [agendamento.id])).toEqual([]);
    expect(await dbAll('SELECT id FROM agendamento_servicos WHERE agendamento_id = ?', [agendamento.id])).toEqual([]);
    expect(await dbGet('SELECT id FROM clientes WHERE id = ?', [cliente.id])).toEqual({ id: cliente.id });
  });
});
