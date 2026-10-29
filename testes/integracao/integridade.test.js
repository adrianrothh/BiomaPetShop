const { prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirFuncionario, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbAll, dbRun } = require('../../database/db-promise');

// Integridade referencial no schema (BL-16). Os DELETEs e INSERTs daqui vão direto pela
// conexão do app, sem passar pelas rotas: as cascatas e as recusas têm de vir do banco.

let agente;

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
});
beforeEach(limparBanco);
afterAll(fecharBanco);

describe('DELETE direto no banco', () => {
  test('excluir um cliente remove os pets, os agendamentos e os serviços deles e preserva os dos outros', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const outroPet = await inserirPet(cliente.id);
    await inserirAgendamento({ petId: pet.id });
    await inserirAgendamento({ petId: outroPet.id, servico: 'Corte de Unhas' });
    const outroCliente = await inserirCliente();
    const petDoOutro = await inserirPet(outroCliente.id);
    const agendamentoDoOutro = await inserirAgendamento({ petId: petDoOutro.id });

    await dbRun('DELETE FROM clientes WHERE id = ?', [cliente.id]);

    expect(await dbAll('SELECT id FROM pets')).toEqual([{ id: petDoOutro.id }]);
    expect(await dbAll('SELECT id FROM agendamentos')).toEqual([{ id: agendamentoDoOutro.id }]);
    expect(await dbAll('SELECT agendamento_id FROM agendamento_servicos')).toEqual([{ agendamento_id: agendamentoDoOutro.id }]);
  });

  test('excluir um usuário remove o funcionário e deixa os agendamentos dele sem funcionário', async () => {
    const funcionario = await inserirFuncionario();
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const agendamento = await inserirAgendamento({ petId: pet.id, funcionarioId: funcionario.funcionarioId });

    await dbRun('DELETE FROM usuarios WHERE id = ?', [funcionario.usuarioId]);

    expect(await dbGet('SELECT id FROM funcionarios WHERE id = ?', [funcionario.funcionarioId])).toBeUndefined();
    expect(await dbGet('SELECT funcionario_id FROM agendamentos WHERE id = ?', [agendamento.id])).toEqual({ funcionario_id: null });
    expect(await dbAll('SELECT id FROM agendamento_servicos WHERE agendamento_id = ?', [agendamento.id])).toHaveLength(1);
  });
});

describe('cliente do agendamento é o tutor atual do pet (N5)', () => {
  // Agenda o Thor, que é da Ana, e depois passa o Thor para o Bruno pelo PUT /pets,
  // como a tela de pets faz
  async function trocarTutorDepoisDeAgendar() {
    const ana = await inserirCliente({ nome: 'Ana Ribeiro' });
    const bruno = await inserirCliente({ nome: 'Bruno Lima' });
    const thor = await inserirPet(ana.id, { nome: 'Thor' });
    const funcionario = await inserirFuncionario();
    await inserirAgendamento({ petId: thor.id, funcionarioId: funcionario.funcionarioId, dataHora: '2030-01-15 10:00:00' });

    const res = await agente.put(`/pets/${thor.id}`).send({
      nome: thor.nome, especie: thor.especie, raca: thor.raca, porte: thor.porte, cliente_id: String(bruno.id)
    });
    expect(res.status).toBe(200);
    return funcionario;
  }

  test('GET /agendamentos mostra o tutor novo', async () => {
    await trocarTutorDepoisDeAgendar();

    const res = await agente.get('/agendamentos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Bruno Lima');
    expect(res.text).not.toContain('Ana Ribeiro');
  });

  test('o calendário e os agendamentos do funcionário também mostram o tutor novo', async () => {
    const funcionario = await trocarTutorDepoisDeAgendar();

    const calendario = await agente.get('/agendamentos/calendario-dados?inicio=2030-01-01&fim=2030-02-01');
    expect(calendario.status).toBe(200);
    expect(calendario.body.dados.map(a => a.cliente_nome)).toEqual(['Bruno Lima']);

    const doFuncionario = await agente.get(`/funcionarios/${funcionario.usuarioId}/agendamentos`);
    expect(doFuncionario.status).toBe(200);
    expect(doFuncionario.body.agendamentos.map(a => a.cliente_nome)).toEqual(['Bruno Lima']);
  });
});

describe('o banco recusa', () => {
  test.each([
    ['pet sem cliente', 'pets', "INSERT INTO pets (nome, especie, cliente_id) VALUES ('Rex', 'cao', NULL)", 'NOT NULL constraint failed: pets.cliente_id'],
    ['pet de cliente que não existe', 'pets', "INSERT INTO pets (nome, especie, cliente_id) VALUES ('Rex', 'cao', 999999)", 'FOREIGN KEY constraint failed'],
    ['funcionário sem usuário', 'funcionarios', "INSERT INTO funcionarios (nome, usuario_id) VALUES ('Carla', NULL)", 'NOT NULL constraint failed: funcionarios.usuario_id'],
    ['funcionário de usuário que não existe', 'funcionarios', "INSERT INTO funcionarios (nome, usuario_id) VALUES ('Carla', 999999)", 'FOREIGN KEY constraint failed']
  ])('%s', async (_, tabela, sql, mensagem) => {
    await expect(dbRun(sql)).rejects.toThrow(mensagem);
    expect(await dbAll(`SELECT id FROM ${tabela}`)).toEqual([]);
  });

  test('dois funcionários para o mesmo usuário', async () => {
    const funcionario = await inserirFuncionario();

    await expect(dbRun("INSERT INTO funcionarios (nome, usuario_id) VALUES ('Outro', ?)", [funcionario.usuarioId]))
      .rejects.toThrow('UNIQUE constraint failed: funcionarios.usuario_id');
    expect(await dbAll('SELECT id FROM funcionarios')).toEqual([{ id: funcionario.funcionarioId }]);
  });
});
