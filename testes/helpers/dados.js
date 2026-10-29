const bcrypt = require('bcrypt');
const { dbGet, dbRun } = require('../../database/db-promise');

// Insere direto no banco os dados de que um teste precisa, sem passar pelas rotas.
// Os valores padrão usam um contador para que duas chamadas não colidam nos
// índices únicos de telefone e email.
let contador = 0;

function proximoNumero() {
  contador += 1;
  return contador;
}

async function inserirCliente(dados = {}) {
  const n = proximoNumero();
  const cliente = {
    nome: `Cliente ${n}`,
    telefone: `(11) 9${String(n).padStart(4, '0')}-0000`,
    email: `cliente${n}@teste.com`,
    ...dados
  };
  const resultado = await dbRun(
    'INSERT INTO clientes (nome, telefone, email) VALUES (?, ?, ?)',
    [cliente.nome, cliente.telefone, cliente.email]
  );
  return { id: resultado.lastID, ...cliente };
}

async function inserirPet(clienteId, dados = {}) {
  const pet = {
    nome: `Pet ${proximoNumero()}`,
    especie: 'cao',
    raca: 'Vira-lata',
    porte: 'Médio',
    ...dados
  };
  const resultado = await dbRun(
    'INSERT INTO pets (nome, especie, raca, porte, cliente_id) VALUES (?, ?, ?, ?, ?)',
    [pet.nome, pet.especie, pet.raca, pet.porte, clienteId]
  );
  return { id: resultado.lastID, cliente_id: clienteId, ...pet };
}

// Cria a linha em usuarios e a linha vinculada em funcionarios, como a rota faz
async function inserirFuncionario(dados = {}) {
  const n = proximoNumero();
  const funcionario = {
    nome: `Funcionario ${n}`,
    email: `funcionario${n}@teste.com`,
    senha: 'senha-func-123',
    telefone: null,
    ativo: 1,
    ...dados
  };
  // Custo 4 só para acelerar os testes: o bcrypt.compare lê o custo do próprio hash
  const hash = await bcrypt.hash(funcionario.senha, 4);
  const usuario = await dbRun(
    'INSERT INTO usuarios (nome, email, senha, permissoes) VALUES (?, ?, ?, ?)',
    [funcionario.nome, funcionario.email, hash, 'funcionario']
  );
  const linhaFuncionario = await dbRun(
    'INSERT INTO funcionarios (nome, telefone, usuario_id, ativo) VALUES (?, ?, ?, ?)',
    [funcionario.nome, funcionario.telefone, usuario.lastID, funcionario.ativo]
  );
  return { usuarioId: usuario.lastID, funcionarioId: linhaFuncionario.lastID, ...funcionario };
}

// Agendamento com um serviço, gravado como a rota grava. Serve para os cenários
// de exclusão; as regras de agendamento são testadas pelas rotas no BL-04.
// O cliente do agendamento é o tutor do pet (BL-16): um clienteId passado é ignorado.
async function inserirAgendamento({ petId, funcionarioId = null, servico = 'Banho', dataHora = '2030-01-15 10:00:00' }) {
  const linhaServico = await dbGet('SELECT id, preco_medio FROM servicos WHERE nome = ?', [servico]);
  const agendamento = await dbRun(
    "INSERT INTO agendamentos (pet_id, data_hora, status, valor, funcionario_id) VALUES (?, ?, 'confirmado', ?, ?)",
    [petId, dataHora, linhaServico.preco_medio, funcionarioId]
  );
  await dbRun(
    'INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, ?)',
    [agendamento.lastID, linhaServico.id, linhaServico.preco_medio]
  );
  return { id: agendamento.lastID };
}

module.exports = { inserirCliente, inserirPet, inserirFuncionario, inserirAgendamento };
