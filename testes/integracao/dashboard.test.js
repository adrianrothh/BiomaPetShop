const { prepararBanco, limparBanco, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbRun } = require('../../database/db-promise');
const { LIMITE_LISTAS } = require('../../controllers/dashboard.controller');

let agente;

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
});
beforeEach(limparBanco);
afterAll(fecharBanco);

function diaLocal(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function contadores(html) {
  const [clientes, pets, hoje, servicos] = [...html.matchAll(/class="stat-value">\s*(\d+)\s*</g)].map(m => Number(m[1]));
  return { clientes, pets, hoje, servicos };
}

function card(html, titulo) {
  const inicio = html.indexOf(titulo);
  if (inicio < 0) throw new Error(`O dashboard não tem o card "${titulo}"`);
  const fim = html.indexOf('class="section-title"', inicio);
  return html.slice(inicio, fim < 0 ? undefined : fim);
}

function itensDoCard(html, titulo) {
  return (card(html, titulo).match(/class="dash-list-item"/g) || []).length;
}

async function cancelar(id) {
  await dbRun("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?", [id]);
}

test('responde 200 com Cache-Control: no-store', async () => {
  const res = await agente.get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
});

test('mostra os totais de clientes, pets e serviços', async () => {
  const cliente = await inserirCliente();
  await inserirCliente();
  await inserirPet(cliente.id);
  const servicos = await dbGet('SELECT COUNT(*) AS total FROM servicos');

  const res = await agente.get('/dashboard');
  expect(contadores(res.text)).toMatchObject({ clientes: 2, pets: 1, servicos: servicos.total });
});

test('conta em "Agendamentos hoje" só os não cancelados de hoje', async () => {
  const cliente = await inserirCliente();
  const pet = await inserirPet(cliente.id);
  await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal()} 09:00:00` });
  await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal()} 15:30:00` });
  const cancelado = await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal()} 11:00:00` });
  await cancelar(cancelado.id);
  await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal(-1)} 10:00:00` });
  await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal(1)} 10:00:00` });

  const res = await agente.get('/dashboard');
  expect(contadores(res.text).hoje).toBe(2);
});

test('lista os clientes mais recentes, no máximo LIMITE_LISTAS', async () => {
  for (let i = 1; i <= LIMITE_LISTAS + 2; i++) {
    await inserirCliente({ nome: `Recente ${String(i).padStart(2, '0')}` });
  }

  const res = await agente.get('/dashboard');
  const clientes = card(res.text, 'Clientes Cadastrados');
  expect(itensDoCard(res.text, 'Clientes Cadastrados')).toBe(LIMITE_LISTAS);
  expect(clientes).toContain(`Recente ${String(LIMITE_LISTAS + 2).padStart(2, '0')}`);
  expect(clientes).not.toContain('Recente 01');
  expect(clientes).not.toContain('Recente 02');
  expect(contadores(res.text).clientes).toBe(LIMITE_LISTAS + 2);
});

test('lista os pets mais recentes, no máximo LIMITE_LISTAS', async () => {
  const cliente = await inserirCliente();
  for (let i = 1; i <= LIMITE_LISTAS + 2; i++) {
    await inserirPet(cliente.id, { nome: `Bicho ${String(i).padStart(2, '0')}` });
  }

  const res = await agente.get('/dashboard');
  const pets = card(res.text, 'Pets Cadastrados');
  expect(itensDoCard(res.text, 'Pets Cadastrados')).toBe(LIMITE_LISTAS);
  expect(pets).toContain(`Bicho ${String(LIMITE_LISTAS + 2).padStart(2, '0')}`);
  expect(pets).not.toContain('Bicho 01');
});

describe('Próximos Agendamentos', () => {
  test('não mostra agendamentos passados nem cancelados', async () => {
    const cliente = await inserirCliente();
    const passado = await inserirPet(cliente.id, { nome: 'Passado' });
    const cancelado = await inserirPet(cliente.id, { nome: 'Cancelado' });
    const futuro = await inserirPet(cliente.id, { nome: 'Futuro' });
    await inserirAgendamento({ petId: passado.id, dataHora: `${diaLocal(-1)} 10:00:00` });
    const ag = await inserirAgendamento({ petId: cancelado.id, dataHora: `${diaLocal(2)} 10:00:00` });
    await cancelar(ag.id);
    await inserirAgendamento({ petId: futuro.id, dataHora: `${diaLocal(2)} 10:00:00` });

    const res = await agente.get('/dashboard');
    const agendamentos = card(res.text, 'Próximos Agendamentos');
    expect(itensDoCard(res.text, 'Próximos Agendamentos')).toBe(1);
    expect(agendamentos).toContain('Futuro');
    expect(agendamentos).not.toContain('Passado');
    expect(agendamentos).not.toContain('Cancelado');
  });

  test('mostra os de hoje e os seguintes, do mais próximo ao mais distante, no máximo LIMITE_LISTAS', async () => {
    const cliente = await inserirCliente();
    for (let dias = LIMITE_LISTAS + 1; dias >= 0; dias--) {
      const pet = await inserirPet(cliente.id, { nome: `Dia ${String(dias).padStart(2, '0')}` });
      await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal(dias)} 10:00:00` });
    }

    const res = await agente.get('/dashboard');
    const agendamentos = card(res.text, 'Próximos Agendamentos');
    expect(itensDoCard(res.text, 'Próximos Agendamentos')).toBe(LIMITE_LISTAS);
    const nomes = [...agendamentos.matchAll(/class="nome-destaque">(Dia \d\d)</g)].map(m => m[1]);
    expect(nomes[0]).toBe('Dia 00');
    expect(nomes).toEqual([...nomes].sort());
    expect(nomes).not.toContain(`Dia ${String(LIMITE_LISTAS + 1).padStart(2, '0')}`);
  });

  test('mostra todos os serviços do agendamento', async () => {
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const ag = await inserirAgendamento({ petId: pet.id, dataHora: `${diaLocal(1)} 10:00:00` });
    const tosa = await dbGet("SELECT id FROM servicos WHERE nome = 'Tosa'");
    await dbRun('INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, 0)', [ag.id, tosa.id]);

    const res = await agente.get('/dashboard');
    const agendamentos = card(res.text, 'Próximos Agendamentos');
    expect(agendamentos).toMatch(/Banho, Tosa|Tosa, Banho/);
  });
});
