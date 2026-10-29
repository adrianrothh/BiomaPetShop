const { prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirFuncionario, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbRun } = require('../../database/db-promise');
const Agendamento = require('../../models/agendamentos.model');
const { aplicarRegras } = require('../../controllers/agendamentos.controller');

beforeAll(prepararBanco);
beforeEach(limparBanco);
afterAll(fecharBanco);

async function idServico(nome) {
  return (await dbGet('SELECT id FROM servicos WHERE nome = ?', [nome])).id;
}

async function cancelar(id) {
  await dbRun("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?", [id]);
}

describe('consulta única de agendamentos com os serviços', () => {
  test('listagem, calendário, dashboard e agenda do funcionário devolvem as mesmas colunas', async () => {
    const funcionario = await inserirFuncionario();
    const cliente = await inserirCliente({ nome: 'Tutor' });
    const pet = await inserirPet(cliente.id, { nome: 'Rex', porte: 'Grande' });
    const ag = await inserirAgendamento({ petId: pet.id, funcionarioId: funcionario.funcionarioId, dataHora: '2030-01-15 10:00:00' });
    await dbRun('INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, 0)', [ag.id, await idServico('Tosa')]);

    const resultados = [
      await Agendamento.listarPagina(20, 0),
      await Agendamento.listarPorPeriodo('2030-01-01', '2030-02-01'),
      await Agendamento.listarProximos('2030-01-01', 10),
      await Agendamento.listarAtivosDoFuncionario(funcionario.funcionarioId)
    ];

    for (const linhas of resultados) {
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({
        id: ag.id,
        data_hora: '2030-01-15 10:00:00',
        status: 'confirmado',
        cliente_nome: 'Tutor',
        pet_nome: 'Rex',
        pet_porte: 'Grande',
        funcionario_nome: funcionario.nome
      });
      expect(linhas[0].servicos_nomes.split(', ').sort()).toEqual(['Banho', 'Tosa']);
    }
    const colunas = resultados.map(linhas => Object.keys(linhas[0]).sort());
    colunas.forEach(c => expect(c).toEqual(colunas[0]));
  });

  test('listarPagina vai do mais novo para o mais antigo e respeita limite e offset', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    for (const dia of ['10', '11', '12', '13']) {
      await inserirAgendamento({ petId: pet.id, dataHora: `2030-01-${dia} 10:00:00` });
    }

    const pagina = await Agendamento.listarPagina(2, 1);
    expect(pagina.map(a => a.data_hora)).toEqual(['2030-01-12 10:00:00', '2030-01-11 10:00:00']);
    expect(await Agendamento.contar()).toBe(4);
  });

  test('listarPorPeriodo inclui o início e exclui o fim', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    for (const dia of ['2030-01-31', '2030-02-01', '2030-02-28', '2030-03-01']) {
      await inserirAgendamento({ petId: pet.id, dataHora: `${dia} 10:00:00` });
    }

    const linhas = await Agendamento.listarPorPeriodo('2030-02-01', '2030-03-01');
    expect(linhas.map(a => a.data_hora)).toEqual(['2030-02-01 10:00:00', '2030-02-28 10:00:00']);
  });

  test('listarAtivosDoFuncionario ignora cancelados e agendamentos de outro funcionário', async () => {
    const ana = await inserirFuncionario();
    const bia = await inserirFuncionario();
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const daAna = await inserirAgendamento({ petId: pet.id, funcionarioId: ana.funcionarioId, dataHora: '2030-01-15 10:00:00' });
    const cancelado = await inserirAgendamento({ petId: pet.id, funcionarioId: ana.funcionarioId, dataHora: '2030-01-16 10:00:00' });
    await cancelar(cancelado.id);
    await inserirAgendamento({ petId: pet.id, funcionarioId: bia.funcionarioId, dataHora: '2030-01-17 10:00:00' });

    const linhas = await Agendamento.listarAtivosDoFuncionario(ana.funcionarioId);
    expect(linhas.map(a => a.id)).toEqual([daAna.id]);
  });
});

describe('contarNaHora e contarConflitos', () => {
  test('contam a hora inteira, sem os cancelados e sem o agendamento ignorado', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const primeiro = await inserirAgendamento({ petId: pet.id, dataHora: '2030-01-15 10:00:00' });
    await inserirAgendamento({ petId: pet.id, dataHora: '2030-01-15 10:45:00' });
    const cancelado = await inserirAgendamento({ petId: pet.id, dataHora: '2030-01-15 10:30:00' });
    await cancelar(cancelado.id);

    expect(await Agendamento.contarNaHora('2030-01-15 10')).toBe(2);
    expect(await Agendamento.contarNaHora('2030-01-15 10', primeiro.id)).toBe(1);

    const banho = await idServico('Banho');
    expect(await Agendamento.contarConflitos(pet.id, '2030-01-15 10', [banho])).toBe(2);
    expect(await Agendamento.contarConflitos(pet.id, '2030-01-15 10', [banho], primeiro.id)).toBe(1);
    expect(await Agendamento.contarConflitos(pet.id, '2030-01-15 10', [await idServico('Tosa')])).toBe(0);
  });
});

describe('aplicarRegras, sem req nem res', () => {
  const base = { data: '2030-01-15', hora: '10:00', mensagemLotado: 'lotado' };

  test('devolve o valor pelo porte do pet e os itens com o preço de cada serviço', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id, { porte: 'Grande' });
    const banho = await dbGet("SELECT id, preco_grande FROM servicos WHERE nome = 'Banho'");

    const regras = await aplicarRegras({ ...base, petId: pet.id, servicosIds: [banho.id] });
    expect(regras).toEqual({
      valor: banho.preco_grande,
      desconto: 0,
      itens: [{ servico_id: banho.id, valor: banho.preco_grande }]
    });
  });

  test('devolve a mensagem de lotação recebida quando a hora está cheia', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    for (let i = 0; i < 3; i++) {
      const outro = await inserirPet(cliente.id);
      await inserirAgendamento({ petId: outro.id, dataHora: '2030-01-15 10:00:00' });
    }

    const regras = await aplicarRegras({ ...base, petId: pet.id, servicosIds: [await idServico('Banho')] });
    expect(regras).toEqual({ erro: 'lotado' });
  });

  test('recusa pet inexistente', async () => {
    const regras = await aplicarRegras({ ...base, petId: 999999, servicosIds: [await idServico('Banho')] });
    expect(regras).toEqual({ erro: 'Pet não encontrado.' });
  });
});

describe('GET /funcionarios/:id/agendamentos', () => {
  test('responde a agenda do funcionário pela consulta única, com os serviços', async () => {
    const agente = await login();
    const funcionario = await inserirFuncionario();
    const cliente = await inserirCliente({ nome: 'Tutor' });
    const pet = await inserirPet(cliente.id, { nome: 'Rex' });
    const ag = await inserirAgendamento({ petId: pet.id, funcionarioId: funcionario.funcionarioId });

    const res = await agente.get(`/funcionarios/${funcionario.usuarioId}/agendamentos`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agendamentos).toHaveLength(1);
    expect(res.body.agendamentos[0]).toMatchObject({
      id: ag.id, cliente_nome: 'Tutor', pet_nome: 'Rex', servicos_nomes: 'Banho', status: 'confirmado'
    });
  });
});
