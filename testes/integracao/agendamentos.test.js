const { prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirFuncionario } = require('../helpers/dados');
const { dbGet, dbAll, dbRun } = require('../../database/db-promise');

// Regras de agenda (RN02, RN03, RN04, RN05, RF12 e RF13) testadas pelas rotas HTTP.
// O banco só prepara dados e confere o resultado, para que o BL-19 possa refatorar o
// módulo sem mexer nestes testes. Os asserts não leem agendamentos.cliente_id nem
// agendamentos.servico_id, que o BL-16 pode remover.
//
// Os formulários respondem 302 no sucesso e 200 no erro, com a tela renderizada de
// novo e a mensagem no alerta. As rotas JSON respondem { ok: true }.
//
// A data passada é comparada com o "hoje" em UTC (débito N4, corrigido no BL-13).
// Por isso as datas daqui ficam a 45 dias ou mais no futuro, calculadas na hora, e a
// data passada é bem antiga: nenhum teste depende de hoje ou amanhã.

// Data a `dias` dias de hoje, em AAAA-MM-DD
function dataFutura(dias) {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().split('T')[0];
}

const DATA = dataFutura(45);
const DATA_PASSADA = '2020-01-01';

const LOTADO = 'Horário lotado! Já existem 3 agendamentos nesse horário. Escolha outro.';
const DUPLICADO = 'Este pet já possui agendamento com o(s) mesmo(s) serviço(s) nesse dia e horário.';

const COLUNAS = 'pet_id, data_hora, status, observacoes, valor, funcionario_id';

let agente;
let servicosOriginais;

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
  servicosOriginais = await dbAll('SELECT * FROM servicos');
});
beforeEach(async () => {
  await limparBanco();
  await restaurarServicos();
});
afterAll(fecharBanco);

// Alguns testes renomeiam serviços ou mudam preços. Volta todos ao estado semeado
// para que cada teste comece igual, em qualquer ordem.
async function restaurarServicos() {
  for (const s of servicosOriginais) {
    await dbRun(
      'UPDATE servicos SET nome = ?, preco_pequeno = ?, preco_medio = ?, preco_grande = ?, pre_requisito_id = ? WHERE id = ?',
      [s.nome, s.preco_pequeno, s.preco_medio, s.preco_grande, s.pre_requisito_id, s.id]
    );
  }
}

// Id do serviço pelo nome semeado. Continua valendo depois que um teste renomeia o serviço.
function idServico(nome) {
  return servicosOriginais.find(s => s.nome === nome).id;
}

// Cada pet com o próprio cliente
async function novoPet(dados = {}) {
  const cliente = await inserirCliente();
  return inserirPet(cliente.id, dados);
}

async function novosPets(quantidade) {
  const pets = [];
  for (let i = 0; i < quantidade; i++) pets.push(await novoPet());
  return pets;
}

// Corpo do formulário como o navegador manda: um par por serviço marcado
// (servicos=1&servicos=2). Os serviços vêm pelo nome e viram o id.
function formulario({ servicos = [], ...campos }) {
  const corpo = new URLSearchParams();
  for (const [campo, valor] of Object.entries(campos)) {
    if (valor !== undefined) corpo.append(campo, String(valor));
  }
  servicos.forEach(nome => corpo.append('servicos', String(idServico(nome))));
  return corpo.toString();
}

function camposAgendamento(pet, dados = {}) {
  return { pet_id: pet.id, data: DATA, hora: '10:00', servicos: ['Banho'], ...dados };
}

function criar(campos) {
  return agente.post('/agendamentos').type('form').send(formulario(campos));
}

function editar(id, campos) {
  return agente.post(`/agendamentos/${id}/editar`).type('form').send(formulario({ status: 'confirmado', ...campos }));
}

// Texto do alerta de erro das telas novo e editar
function mensagemDaTela(res) {
  const alerta = /alert-danger[^>]*><i [^>]*><\/i>([^<]*)<\/div>/.exec(res.text || '');
  return alerta ? alerta[1].trim() : null;
}

// Prepara um agendamento pela rota e devolve o id. Se a rota recusar, falha com a
// mensagem da tela, para o erro de preparação não parecer erro do cenário.
async function agendar(pet, dados = {}) {
  const res = await criar(camposAgendamento(pet, dados));
  if (res.status !== 302) {
    throw new Error(
      `Preparação falhou: POST /agendamentos respondeu ${res.status}. Mensagem da tela: "${mensagemDaTela(res)}".`
    );
  }
  const linha = await dbGet('SELECT MAX(id) AS id FROM agendamentos');
  return { id: linha.id };
}

// O cancelamento aqui é só preparação, por isso vai direto no banco
function cancelarNoBanco(id) {
  return dbRun("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?", [id]);
}

function buscarAgendamento(id) {
  return dbGet(`SELECT ${COLUNAS} FROM agendamentos WHERE id = ?`, [id]);
}

function listarAgendamentos() {
  return dbAll(`SELECT id, ${COLUNAS} FROM agendamentos ORDER BY id`);
}

// Serviços gravados no agendamento com o preço de cada um, em ordem alfabética
function servicosDoAgendamento(id) {
  return dbAll(
    `SELECT s.nome, ag_s.valor
     FROM agendamento_servicos ag_s
     JOIN servicos s ON s.id = ag_s.servico_id
     WHERE ag_s.agendamento_id = ?
     ORDER BY s.nome`,
    [id]
  );
}

async function estadoDoBanco() {
  return {
    agendamentos: await listarAgendamentos(),
    servicos: await dbAll('SELECT id, agendamento_id, servico_id, valor FROM agendamento_servicos ORDER BY id')
  };
}

function esperarCriado(res) {
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/agendamentos?sucesso=criado');
}

function esperarEditado(res) {
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/agendamentos?sucesso=editado');
}

// Erro de formulário: 200 com a tela renderizada de novo, a mensagem no alerta e o
// banco igual ao de antes do envio
async function esperarRecusa(res, mensagem, estadoAntes) {
  expect(res.status).toBe(200);
  expect(mensagemDaTela(res)).toBe(mensagem);
  expect(await estadoDoBanco()).toEqual(estadoAntes);
}

describe('POST /agendamentos: criação (RF12)', () => {
  test('cria o agendamento confirmado com os serviços escolhidos', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const funcionario = await inserirFuncionario();

    const res = await criar(camposAgendamento(pet, {
      servicos: ['Banho', 'Corte de Unhas'],
      observacoes: 'Cuidado com as orelhas',
      funcionario_id: funcionario.funcionarioId
    }));
    esperarCriado(res);

    const agendamentos = await listarAgendamentos();
    expect(agendamentos).toEqual([{
      id: expect.any(Number),
      pet_id: pet.id,
      data_hora: `${DATA} 10:00:00`,
      status: 'confirmado',
      observacoes: 'Cuidado com as orelhas',
      valor: 65,
      funcionario_id: funcionario.funcionarioId
    }]);
    expect(await servicosDoAgendamento(agendamentos[0].id)).toEqual([
      { nome: 'Banho', valor: 45 },
      { nome: 'Corte de Unhas', valor: 20 }
    ]);
  });

  test('mostra na listagem o cliente do pet, o pet e o valor', async () => {
    const cliente = await inserirCliente({ nome: 'Ana Ribeiro' });
    const pet = await inserirPet(cliente.id, { nome: 'Bolinha', porte: 'Pequeno' });
    await agendar(pet, { servicos: ['Banho', 'Tosa'] });

    const res = await agente.get('/agendamentos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ana Ribeiro');
    expect(res.text).toContain('Bolinha');
    expect(res.text).toContain('R$ 70,00');
  });

  test('recusa data no passado', async () => {
    const pet = await novoPet();

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet, { data: DATA_PASSADA }));
    await esperarRecusa(res, 'A data do agendamento não pode ser no passado.', antes);
  });

  test.each([
    ['sem pet', { pet_id: '' }, 'Selecione o pet.'],
    ['sem serviço', { servicos: [] }, 'Selecione ao menos um serviço.'],
    ['sem data', { data: '' }, 'Informe a data e o horário do agendamento.'],
    ['sem hora', { hora: '' }, 'Informe a data e o horário do agendamento.']
  ])('recusa campo obrigatório faltando: %s', async (_, campos, mensagem) => {
    const pet = await novoPet();

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet, campos));
    await esperarRecusa(res, mensagem, antes);
  });

  test('recusa pet inexistente', async () => {
    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento({ id: 999999 }));
    await esperarRecusa(res, 'Pet não encontrado.', antes);
  });

  // Comportamento atual: um id de serviço que não existe, enviado junto com um que
  // existe, é ignorado sem aviso e o agendamento sai só com o serviço válido
  test('ignora um serviço inexistente enviado junto com um que existe', async () => {
    const pet = await novoPet({ porte: 'Médio' });

    const res = await agente
      .post('/agendamentos')
      .type('form')
      .send(`${formulario(camposAgendamento(pet))}&servicos=999999`);
    esperarCriado(res);

    const [agendamento] = await listarAgendamentos();
    expect(agendamento.valor).toBe(45);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([{ nome: 'Banho', valor: 45 }]);
  });

  // Comportamento atual: a data só é comparada como texto com o "hoje", sem conferir
  // o formato. 31/12/2030 passa porque "3" vem depois de "2" na comparação.
  test('aceita data fora do formato AAAA-MM-DD', async () => {
    const pet = await novoPet();

    const res = await criar(camposAgendamento(pet, { data: '31/12/2030' }));
    esperarCriado(res);

    const [agendamento] = await listarAgendamentos();
    expect(agendamento.data_hora).toBe('31/12/2030 10:00:00');
  });
});

// Comportamento atual: no máximo 3 agendamentos por hora no total, sem olhar o
// serviço (DT-11). A regra vai mudar com a decisão do cliente no BL-21.
describe('RN02: limite de agendamentos por hora', () => {
  test('aceita três agendamentos de pets diferentes na mesma hora e recusa o quarto', async () => {
    const pets = await novosPets(4);

    for (const pet of pets.slice(0, 3)) {
      esperarCriado(await criar(camposAgendamento(pet)));
    }
    expect((await listarAgendamentos()).map(a => a.pet_id)).toEqual(pets.slice(0, 3).map(p => p.id));

    // O quarto pede outro serviço e é recusado mesmo assim: a conta não olha o serviço
    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pets[3], { servicos: ['Consulta Básica'] }));
    await esperarRecusa(res, LOTADO, antes);
  });

  test('conta minutos diferentes da mesma hora como o mesmo horário', async () => {
    const pets = await novosPets(4);
    esperarCriado(await criar(camposAgendamento(pets[0], { hora: '10:00' })));
    esperarCriado(await criar(camposAgendamento(pets[1], { hora: '10:15' })));
    esperarCriado(await criar(camposAgendamento(pets[2], { hora: '10:45' })));

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pets[3], { hora: '10:59' }));
    await esperarRecusa(res, LOTADO, antes);
  });

  test('não conta agendamento cancelado', async () => {
    const pets = await novosPets(4);
    const cancelado = await agendar(pets[0]);
    await agendar(pets[1]);
    await agendar(pets[2]);
    await cancelarNoBanco(cancelado.id);

    esperarCriado(await criar(camposAgendamento(pets[3])));

    const agendamentos = await listarAgendamentos();
    expect(agendamentos.map(a => [a.pet_id, a.status])).toEqual([
      [pets[0].id, 'cancelado'],
      [pets[1].id, 'confirmado'],
      [pets[2].id, 'confirmado'],
      [pets[3].id, 'confirmado']
    ]);
  });

  test('aceita outra hora do mesmo dia com a hora anterior lotada', async () => {
    const pets = await novosPets(4);
    await agendar(pets[0]);
    await agendar(pets[1]);
    await agendar(pets[2]);

    esperarCriado(await criar(camposAgendamento(pets[3], { hora: '11:00' })));

    const agendamentos = await listarAgendamentos();
    expect(agendamentos).toHaveLength(4);
    expect(agendamentos[3]).toMatchObject({ pet_id: pets[3].id, data_hora: `${DATA} 11:00:00` });
  });

  test('na edição, ignora o próprio agendamento ao contar a hora lotada', async () => {
    const pets = await novosPets(3);
    const primeiro = await agendar(pets[0]);
    await agendar(pets[1]);
    await agendar(pets[2]);

    const res = await editar(primeiro.id, camposAgendamento(pets[0], { hora: '10:30', observacoes: 'Chega 10h30' }));
    esperarEditado(res);

    expect(await buscarAgendamento(primeiro.id)).toMatchObject({
      data_hora: `${DATA} 10:30:00`,
      observacoes: 'Chega 10h30'
    });
  });

  // A mensagem da edição não tem o "Escolha outro." que a criação mostra
  test('na edição, recusa mudar para uma hora lotada', async () => {
    const pets = await novosPets(4);
    await agendar(pets[0]);
    await agendar(pets[1]);
    await agendar(pets[2]);
    const quarto = await agendar(pets[3], { hora: '11:00' });

    const antes = await estadoDoBanco();
    const res = await editar(quarto.id, camposAgendamento(pets[3], { hora: '10:00' }));
    await esperarRecusa(res, 'Horário lotado! Já existem 3 agendamentos nesse horário.', antes);
  });
});

describe('RN03: conflito do mesmo pet e serviço na mesma hora', () => {
  test('recusa o mesmo pet com o mesmo serviço na mesma hora, em outro minuto', async () => {
    const pet = await novoPet();
    await agendar(pet, { hora: '10:00' });

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet, { hora: '10:40' }));
    await esperarRecusa(res, DUPLICADO, antes);
  });

  test('recusa quando só um dos serviços se repete', async () => {
    const pet = await novoPet();
    await agendar(pet, { servicos: ['Banho'] });

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet, { servicos: ['Banho', 'Corte de Unhas'] }));
    await esperarRecusa(res, DUPLICADO, antes);
  });

  test('aceita o mesmo pet com serviço diferente na mesma hora', async () => {
    const pet = await novoPet();
    const primeiro = await agendar(pet, { servicos: ['Banho'] });

    esperarCriado(await criar(camposAgendamento(pet, { servicos: ['Consulta Básica'] })));

    const agendamentos = await listarAgendamentos();
    expect(agendamentos.map(a => a.pet_id)).toEqual([pet.id, pet.id]);
    expect(agendamentos[0].id).toBe(primeiro.id);
    expect(await servicosDoAgendamento(agendamentos[1].id)).toEqual([{ nome: 'Consulta Básica', valor: 50 }]);
  });

  test('aceita outro pet com o mesmo serviço na mesma hora', async () => {
    const [pet, outroPet] = await novosPets(2);
    await agendar(pet);

    esperarCriado(await criar(camposAgendamento(outroPet)));

    expect((await listarAgendamentos()).map(a => a.pet_id)).toEqual([pet.id, outroPet.id]);
  });

  test('não conta agendamento cancelado', async () => {
    const pet = await novoPet();
    const cancelado = await agendar(pet);
    await cancelarNoBanco(cancelado.id);

    esperarCriado(await criar(camposAgendamento(pet)));

    expect((await listarAgendamentos()).map(a => a.status)).toEqual(['cancelado', 'confirmado']);
  });

  // A RN02 vem antes: com a hora lotada, a mensagem é a da capacidade mesmo com o
  // serviço repetido
  test('confere a lotação da hora antes do conflito', async () => {
    const [pet, segundo, terceiro] = await novosPets(3);
    await agendar(pet);
    await agendar(segundo);
    await agendar(terceiro);

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet));
    await esperarRecusa(res, LOTADO, antes);
  });

  test('na edição, aceita salvar sem mudar horário nem serviços', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const agendamento = await agendar(pet, { servicos: ['Banho', 'Corte de Unhas'] });

    const res = await editar(agendamento.id, camposAgendamento(pet, { servicos: ['Banho', 'Corte de Unhas'] }));
    esperarEditado(res);

    expect(await listarAgendamentos()).toHaveLength(1);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: 45 },
      { nome: 'Corte de Unhas', valor: 20 }
    ]);
  });
});

describe('RN04: serviço com pré-requisito', () => {
  test.each([
    ['Tosa sozinha', ['Tosa'], 'Tosa'],
    ['Hidratação sozinha', ['Hidratação'], 'Hidratação'],
    ['Tosa com Corte de Unhas', ['Tosa', 'Corte de Unhas'], 'Tosa']
  ])('recusa sem Banho: %s', async (_, servicos, nome) => {
    const pet = await novoPet();

    const antes = await estadoDoBanco();
    const res = await criar(camposAgendamento(pet, { servicos }));
    await esperarRecusa(res, `${nome} só pode ser agendado junto com Banho.`, antes);
  });

  test.each([
    ['Tosa', 55],
    ['Hidratação', 35]
  ])('aceita %s com Banho', async (nome, preco) => {
    const pet = await novoPet({ porte: 'Médio' });

    esperarCriado(await criar(camposAgendamento(pet, { servicos: ['Banho', nome] })));

    const [agendamento] = await listarAgendamentos();
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: 45 },
      { nome, valor: preco }
    ]);
  });

  test('na edição, recusa tirar o Banho e manter a Tosa', async () => {
    const pet = await novoPet();
    const agendamento = await agendar(pet, { servicos: ['Banho', 'Tosa'] });

    const antes = await estadoDoBanco();
    const res = await editar(agendamento.id, camposAgendamento(pet, { servicos: ['Tosa'] }));
    await esperarRecusa(res, 'Tosa só pode ser agendado junto com Banho.', antes);
  });

  // Critério do BL-23: o pré-requisito vem de servicos.pre_requisito_id e a mensagem
  // usa o nome que está no banco, sem depender do texto "Banho"
  describe('com o Banho renomeado para "Banho completo" (BL-23)', () => {
    beforeEach(async () => {
      await dbRun('UPDATE servicos SET nome = ? WHERE id = ?', ['Banho completo', idServico('Banho')]);
    });

    test('recusa Tosa sozinha citando o nome novo', async () => {
      const pet = await novoPet();

      const antes = await estadoDoBanco();
      const res = await criar(camposAgendamento(pet, { servicos: ['Tosa'] }));
      await esperarRecusa(res, 'Tosa só pode ser agendado junto com Banho completo.', antes);
    });

    test('aceita Tosa com o Banho completo', async () => {
      const pet = await novoPet({ porte: 'Médio' });

      esperarCriado(await criar(camposAgendamento(pet, { servicos: ['Banho', 'Tosa'] })));

      const [agendamento] = await listarAgendamentos();
      expect(await servicosDoAgendamento(agendamento.id)).toEqual([
        { nome: 'Banho completo', valor: 45 },
        { nome: 'Tosa', valor: 55 }
      ]);
    });
  });
});

describe('RF13: valor pelo porte do pet', () => {
  test.each([
    ['Pequeno', 85, { banho: 30, unhas: 15, tosa: 40 }],
    ['Médio', 120, { banho: 45, unhas: 20, tosa: 55 }],
    ['Grande', 155, { banho: 60, unhas: 25, tosa: 70 }]
  ])('soma os preços do porte %s', async (porte, total, precos) => {
    const pet = await novoPet({ porte });

    esperarCriado(await criar(camposAgendamento(pet, { servicos: ['Banho', 'Tosa', 'Corte de Unhas'] })));

    const [agendamento] = await listarAgendamentos();
    expect(agendamento.valor).toBe(total);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: precos.banho },
      { nome: 'Corte de Unhas', valor: precos.unhas },
      { nome: 'Tosa', valor: precos.tosa }
    ]);
  });

  test('mantém o valor gravado depois que o preço do serviço muda', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const agendamento = await agendar(pet, { servicos: ['Banho', 'Tosa'] });

    const res = await agente
      .put(`/servicos/${idServico('Banho')}`)
      .send({ preco_pequeno: 35, preco_medio: 50, preco_grande: 65 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect((await buscarAgendamento(agendamento.id)).valor).toBe(100);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: 45 },
      { nome: 'Tosa', valor: 55 }
    ]);

    // Um agendamento novo já sai com o preço novo
    const outroPet = await novoPet({ porte: 'Médio' });
    const novo = await agendar(outroPet, { servicos: ['Banho', 'Tosa'] });
    expect((await buscarAgendamento(novo.id)).valor).toBe(105);
  });
});

describe('POST /agendamentos/:id/editar', () => {
  test('grava os campos editados e redireciona', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const funcionario = await inserirFuncionario();
    const agendamento = await agendar(pet);
    const outraData = dataFutura(50);

    const res = await editar(agendamento.id, camposAgendamento(pet, {
      data: outraData,
      hora: '15:30',
      status: 'concluido',
      observacoes: 'Remarcado pelo cliente',
      funcionario_id: funcionario.funcionarioId
    }));
    esperarEditado(res);

    expect(await buscarAgendamento(agendamento.id)).toEqual({
      pet_id: pet.id,
      data_hora: `${outraData} 15:30:00`,
      status: 'concluido',
      observacoes: 'Remarcado pelo cliente',
      valor: 45,
      funcionario_id: funcionario.funcionarioId
    });
  });

  test('troca os serviços e recalcula o valor', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const agendamento = await agendar(pet, { servicos: ['Banho'] });

    const res = await editar(agendamento.id, camposAgendamento(pet, { servicos: ['Banho', 'Hidratação', 'Corte de Unhas'] }));
    esperarEditado(res);

    expect((await buscarAgendamento(agendamento.id)).valor).toBe(100);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: 45 },
      { nome: 'Corte de Unhas', valor: 20 },
      { nome: 'Hidratação', valor: 35 }
    ]);
  });

  test('troca o pet por outro de porte diferente e recalcula o valor', async () => {
    const petPequeno = await novoPet({ porte: 'Pequeno' });
    const petGrande = await novoPet({ porte: 'Grande' });
    const agendamento = await agendar(petPequeno, { servicos: ['Banho', 'Tosa'] });
    expect((await buscarAgendamento(agendamento.id)).valor).toBe(70);

    const res = await editar(agendamento.id, camposAgendamento(petGrande, { servicos: ['Banho', 'Tosa'] }));
    esperarEditado(res);

    expect(await buscarAgendamento(agendamento.id)).toMatchObject({ pet_id: petGrande.id, valor: 130 });
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([
      { nome: 'Banho', valor: 60 },
      { nome: 'Tosa', valor: 70 }
    ]);
  });

  // Comportamento atual: a edição recalcula com o preço atual dos serviços e troca o
  // preço gravado na criação, mesmo sem mudar nada no agendamento
  test('recalcula com o preço atual, não com o gravado na criação', async () => {
    const pet = await novoPet({ porte: 'Médio' });
    const agendamento = await agendar(pet, { servicos: ['Banho'] });
    const preco = await agente
      .put(`/servicos/${idServico('Banho')}`)
      .send({ preco_pequeno: 35, preco_medio: 50, preco_grande: 65 });
    expect(preco.body).toEqual({ ok: true });

    const res = await editar(agendamento.id, camposAgendamento(pet, { servicos: ['Banho'] }));
    esperarEditado(res);

    expect((await buscarAgendamento(agendamento.id)).valor).toBe(50);
    expect(await servicosDoAgendamento(agendamento.id)).toEqual([{ nome: 'Banho', valor: 50 }]);
  });

  // Comportamento atual, que vira validação no BL-13: a edição não barra data passada
  test('aceita data no passado', async () => {
    const pet = await novoPet();
    const agendamento = await agendar(pet);

    const res = await editar(agendamento.id, camposAgendamento(pet, { data: DATA_PASSADA }));
    esperarEditado(res);

    expect((await buscarAgendamento(agendamento.id)).data_hora).toBe(`${DATA_PASSADA} 10:00:00`);
  });
});

describe('RN05: exclusão do pet pela rota DELETE /pets/:id', () => {
  // Dois pets com agendamentos criados pela rota, cada um com mais de um serviço
  async function prepararDoisPets() {
    const excluido = await novoPet();
    const outro = await novoPet();
    const agendamentosDoExcluido = [
      await agendar(excluido, { hora: '10:00', servicos: ['Banho', 'Tosa'] }),
      await agendar(excluido, { hora: '14:00', servicos: ['Consulta Básica', 'Corte de Unhas'] })
    ];
    const agendamentoDoOutro = await agendar(outro, { hora: '10:00', servicos: ['Banho', 'Hidratação'] });
    return { excluido, agendamentosDoExcluido, agendamentoDoOutro };
  }

  function servicosDos(agendamentos) {
    const ids = agendamentos.map(a => a.id);
    return dbAll(
      `SELECT id FROM agendamento_servicos WHERE agendamento_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }

  test('remove os agendamentos do pet excluído e os serviços deles', async () => {
    const { excluido, agendamentosDoExcluido } = await prepararDoisPets();
    expect(await servicosDos(agendamentosDoExcluido)).toHaveLength(4);

    const res = await agente.delete(`/pets/${excluido.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await dbAll('SELECT id FROM agendamentos WHERE pet_id = ?', [excluido.id])).toEqual([]);
    expect(await servicosDos(agendamentosDoExcluido)).toEqual([]);
  });

  test('preserva os agendamentos e os serviços de outro pet', async () => {
    const { excluido, agendamentoDoOutro } = await prepararDoisPets();
    const agendamentoAntes = await buscarAgendamento(agendamentoDoOutro.id);
    const servicosAntes = await servicosDoAgendamento(agendamentoDoOutro.id);
    expect(servicosAntes).toHaveLength(2);

    const res = await agente.delete(`/pets/${excluido.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect((await listarAgendamentos()).map(a => a.id)).toEqual([agendamentoDoOutro.id]);
    expect(await buscarAgendamento(agendamentoDoOutro.id)).toEqual(agendamentoAntes);
    expect(await servicosDoAgendamento(agendamentoDoOutro.id)).toEqual(servicosAntes);
  });
});

describe('POST /agendamentos/:id/concluir', () => {
  test('grava o status concluido', async () => {
    const pet = await novoPet();
    const agendamento = await agendar(pet);

    const res = await agente.post(`/agendamentos/${agendamento.id}/concluir`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await buscarAgendamento(agendamento.id)).status).toBe('concluido');
  });

  // Comportamento atual, que vira validação no BL-13: o concluir não olha o status atual
  test('conclui também um agendamento cancelado', async () => {
    const pet = await novoPet();
    const agendamento = await agendar(pet);
    await cancelarNoBanco(agendamento.id);

    const res = await agente.post(`/agendamentos/${agendamento.id}/concluir`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await buscarAgendamento(agendamento.id)).status).toBe('concluido');
  });

  // Comportamento atual: responde ok mesmo sem agendamento com esse id
  test('responde ok para um id sem agendamento', async () => {
    const res = await agente.post('/agendamentos/999999/concluir');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await listarAgendamentos()).toEqual([]);
  });
});

describe('DELETE /agendamentos/:id', () => {
  test('remove o agendamento e os serviços dele, sem mexer nos outros', async () => {
    const [pet, outroPet] = await novosPets(2);
    const agendamento = await agendar(pet, { servicos: ['Banho', 'Tosa'] });
    const outro = await agendar(outroPet, { servicos: ['Banho', 'Hidratação'] });
    const servicosDoOutro = await servicosDoAgendamento(outro.id);

    const res = await agente.delete(`/agendamentos/${agendamento.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await buscarAgendamento(agendamento.id)).toBeUndefined();
    expect(await dbAll('SELECT id FROM agendamento_servicos WHERE agendamento_id = ?', [agendamento.id])).toEqual([]);
    expect((await listarAgendamentos()).map(a => a.id)).toEqual([outro.id]);
    expect(await servicosDoAgendamento(outro.id)).toEqual(servicosDoOutro);
  });

  // Comportamento atual: responde ok mesmo sem agendamento com esse id
  test('responde ok para um id sem agendamento', async () => {
    const res = await agente.delete('/agendamentos/999999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
