const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');

const SELECT_COM_SERVICOS = `
  SELECT a.id, a.pet_id, a.data_hora, a.status, a.observacoes, a.valor, a.desconto, a.funcionario_id,
         c.nome AS cliente_nome,
         p.nome AS pet_nome,
         p.porte AS pet_porte,
         GROUP_CONCAT(s.nome, ', ') AS servicos_nomes,
         f.nome AS funcionario_nome
  FROM agendamentos a
  LEFT JOIN pets p ON a.pet_id = p.id
  LEFT JOIN clientes c ON p.cliente_id = c.id
  LEFT JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
  LEFT JOIN servicos s ON s.id = ag_s.servico_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;

function listarComServicos({ filtro = null, params = [], ordem = 'ASC', limite = null, offset = 0 } = {}) {
  const where = filtro ? `WHERE ${filtro}` : '';
  const direcao = ordem === 'DESC' ? 'DESC' : 'ASC';
  const paginacao = limite ? 'LIMIT ? OFFSET ?' : '';
  return dbAll(
    `${SELECT_COM_SERVICOS} ${where} GROUP BY a.id ORDER BY a.data_hora ${direcao} ${paginacao}`,
    limite ? [...params, limite, offset] : params
  );
}

function contar() {
  return dbGet('SELECT COUNT(*) AS total FROM agendamentos').then(row => (row ? row.total : 0));
}

function listarPagina(limite, offset) {
  return listarComServicos({ ordem: 'DESC', limite, offset });
}

function listarPorPeriodo(inicio, fim) {
  return listarComServicos({
    filtro: 'date(a.data_hora) >= ? AND date(a.data_hora) < ?',
    params: [inicio, fim]
  });
}

function listarAtivosDoFuncionario(funcionarioId) {
  return listarComServicos({
    filtro: "a.funcionario_id = ? AND a.status != 'cancelado'",
    params: [funcionarioId]
  });
}

function listarProximos(aPartirDe, limite) {
  return listarComServicos({
    filtro: "date(a.data_hora) >= ? AND a.status != 'cancelado'",
    params: [aPartirDe],
    limite
  });
}

function contarAtivosNoDia(dia) {
  return dbGet(
    "SELECT COUNT(*) AS total FROM agendamentos WHERE date(data_hora) = ? AND status != 'cancelado'",
    [dia]
  ).then(row => (row ? row.total : 0));
}

function buscarPorId(id) {
  return dbGet('SELECT * FROM agendamentos WHERE id = ?', [id]);
}

async function listarIdsDosServicos(agendamentoId) {
  const linhas = await dbAll('SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ?', [agendamentoId]);
  return (linhas || []).map(r => r.servico_id);
}

function contarNaHora(slotHora, ignorarId = null) {
  const params = [slotHora];
  let sql = "SELECT COUNT(*) AS count FROM agendamentos WHERE strftime('%Y-%m-%d %H', data_hora) = ? AND status != 'cancelado'";
  if (ignorarId) {
    sql += ' AND id != ?';
    params.push(ignorarId);
  }
  return dbGet(sql, params).then(row => (row ? row.count : 0));
}

function contarConflitos(petId, slotHora, servicosIds, ignorarId = null) {
  // SQLite não aceita arrays como parâmetro — monta os '?' dinamicamente para o IN
  const placeholders = servicosIds.map(() => '?').join(',');
  const params = [petId, slotHora, ...servicosIds];
  let sql = `
    SELECT COUNT(*) AS count
    FROM agendamentos a
    JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
    WHERE a.pet_id = ?
      AND strftime('%Y-%m-%d %H', a.data_hora) = ?
      AND ag_s.servico_id IN (${placeholders})
      AND a.status != 'cancelado'`;
  if (ignorarId) {
    sql += ' AND a.id != ?';
    params.push(ignorarId);
  }
  return dbGet(sql, params).then(row => (row ? row.count : 0));
}

async function inserirServicos(agendamentoId, itens) {
  for (const item of itens) {
    await dbRun(
      'INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, ?)',
      [agendamentoId, item.servico_id, item.valor]
    );
  }
}

function criar(dados, itens) {
  return dbTransaction(async () => {
    const ag = await dbRun(
      "INSERT INTO agendamentos (pet_id, data_hora, status, observacoes, valor, desconto, funcionario_id) VALUES (?, ?, 'confirmado', ?, ?, ?, ?)",
      [dados.pet_id, dados.data_hora, dados.observacoes, dados.valor, dados.desconto, dados.funcionario_id]
    );
    await inserirServicos(ag.lastID, itens);
    return ag.lastID;
  });
}

function atualizar(id, dados, itens) {
  return dbTransaction(async () => {
    await dbRun(
      'UPDATE agendamentos SET pet_id=?, data_hora=?, status=?, observacoes=?, valor=?, desconto=?, funcionario_id=? WHERE id=?',
      [dados.pet_id, dados.data_hora, dados.status, dados.observacoes, dados.valor, dados.desconto, dados.funcionario_id, id]
    );
    await dbRun('DELETE FROM agendamento_servicos WHERE agendamento_id = ?', [id]);
    await inserirServicos(id, itens);
  });
}

function concluir(id) {
  return dbRun("UPDATE agendamentos SET status = 'concluido' WHERE id = ?", [id]);
}

// Os serviços do agendamento saem em cascata (ON DELETE CASCADE)
function excluir(id) {
  return dbRun('DELETE FROM agendamentos WHERE id = ?', [id]);
}

async function carregarOpcoesDoFormulario() {
  const [pets, servicos, funcionarios] = await Promise.all([
    dbAll(`
      SELECT p.id, p.nome, p.porte, p.especie, c.nome AS cliente_nome, c.id AS cliente_id
      FROM pets p LEFT JOIN clientes c ON p.cliente_id = c.id ORDER BY p.nome ASC
    `),
    dbAll('SELECT * FROM servicos ORDER BY nome ASC'),
    dbAll('SELECT f.* FROM funcionarios f INNER JOIN usuarios u ON u.id = f.usuario_id WHERE f.ativo = 1 ORDER BY f.nome ASC')
  ]);
  return { pets: pets || [], servicos: servicos || [], funcionarios: funcionarios || [] };
}

function buscarPet(id) {
  return dbGet('SELECT p.*, c.id AS cliente_id FROM pets p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?', [id]);
}

async function listarServicosPorIds(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return (await dbAll(`SELECT * FROM servicos WHERE id IN (${placeholders})`, ids)) || [];
}

async function buscarNomeDoServico(id) {
  const row = await dbGet('SELECT nome FROM servicos WHERE id = ?', [id]);
  return row ? row.nome : null;
}

module.exports = {
  contar,
  listarPagina,
  listarPorPeriodo,
  listarAtivosDoFuncionario,
  listarProximos,
  contarAtivosNoDia,
  buscarPorId,
  listarIdsDosServicos,
  contarNaHora,
  contarConflitos,
  criar,
  atualizar,
  concluir,
  excluir,
  carregarOpcoesDoFormulario,
  buscarPet,
  listarServicosPorIds,
  buscarNomeDoServico
};
