const express = require('express');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { normalizarServicos, calcularValores, validarDependenciasServicos } = require('../utils/helpers');

const router = express.Router();

const LIMITE = 20;
const CAPACIDADE_MAX_POR_HORA = 3;

async function carregarFormData() {
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

router.get('/agendamentos', verificarAutenticacao, async (req, res) => {
  const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
  const offset = (pagina - 1) * LIMITE;

  try {
    const [totalRow, agendamentos] = await Promise.all([
      dbGet("SELECT COUNT(*) AS total FROM agendamentos"),
      dbAll(`
        SELECT a.*,
               c.nome AS cliente_nome,
               p.nome AS pet_nome,
               p.porte AS pet_porte,
               GROUP_CONCAT(s.nome, ', ') AS servicos_nomes,
               f.nome AS funcionario_nome
        FROM agendamentos a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN pets p ON a.pet_id = p.id
        LEFT JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
        LEFT JOIN servicos s ON s.id = ag_s.servico_id
        LEFT JOIN funcionarios f ON f.id = a.funcionario_id
        GROUP BY a.id
        ORDER BY a.data_hora DESC
        LIMIT ? OFFSET ?
      `, [LIMITE, offset])
    ]);

    const total = totalRow ? totalRow.total : 0;
    const totalPaginas = Math.ceil(total / LIMITE);

    res.render('agendamentos/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'agendamentos',
      agendamentos: agendamentos || [],
      pagina,
      totalPaginas,
      total,
      sucesso: req.query.sucesso || null
    });
  } catch (err) {
    console.error('Erro ao listar agendamentos:', err);
    res.render('agendamentos/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'agendamentos',
      agendamentos: [],
      pagina: 1,
      totalPaginas: 1,
      total: 0,
      sucesso: null
    });
  }
});

router.get('/agendamentos/novo', verificarAutenticacao, async (req, res) => {
  try {
    const { pets, servicos, funcionarios } = await carregarFormData();
    res.render('agendamentos/novo', {
      usuario: req.session.usuario,
      paginaAtiva: 'agendamentos',
      pets, servicos, funcionarios, erro: null
    });
  } catch (err) {
    console.error('Erro ao carregar form:', err);
    res.redirect('/agendamentos');
  }
});

router.post('/agendamentos', verificarAutenticacao, async (req, res) => {
  const { pet_id, data, hora, observacoes, funcionario_id } = req.body;
  const servicosIds = normalizarServicos(req.body.servicos);

  const renderErro = async (erro) => {
    const { pets, servicos, funcionarios } = await carregarFormData();
    res.render('agendamentos/novo', {
      usuario: req.session.usuario, paginaAtiva: 'agendamentos',
      pets, servicos, funcionarios, erro
    });
  };

  if (!pet_id) return renderErro('Selecione o pet.');
  if (servicosIds.length === 0) return renderErro('Selecione ao menos um serviço.');
  if (!data || !hora) return renderErro('Informe a data e o horário do agendamento.');

  const hoje = new Date().toISOString().split('T')[0];
  if (data < hoje) return renderErro('A data do agendamento não pode ser no passado.');

  const data_hora = `${data} ${hora}:00`;
  // Formato 'YYYY-MM-DD HH' para que o strftime agrupe qualquer minuto da mesma hora
  const slotHora = `${data} ${hora.split(':')[0]}`;

  try {
    const slotRow = await dbGet(
      `SELECT COUNT(*) AS count FROM agendamentos WHERE strftime('%Y-%m-%d %H', data_hora) = ? AND status != 'cancelado'`,
      [slotHora]
    );
    if (slotRow && slotRow.count >= CAPACIDADE_MAX_POR_HORA) {
      return renderErro('Horário lotado! Já existem 3 agendamentos nesse horário. Escolha outro.');
    }

    const placeholdersServ = servicosIds.map(() => '?').join(',');
    const dupRow = await dbGet(
      `SELECT COUNT(*) AS count
       FROM agendamentos a
       JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
       WHERE a.pet_id = ?
         AND strftime('%Y-%m-%d %H', a.data_hora) = ?
         AND ag_s.servico_id IN (${placeholdersServ})
         AND a.status != 'cancelado'`,
      [pet_id, slotHora, ...servicosIds]
    );
    if (dupRow && dupRow.count > 0) {
      return renderErro('Este pet já possui agendamento com o(s) mesmo(s) serviço(s) nesse dia e horário.');
    }

    const pet = await dbGet(
      'SELECT p.*, c.id AS cliente_id FROM pets p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?',
      [pet_id]
    );
    if (!pet) return renderErro('Pet não encontrado.');

    const placeholders = servicosIds.map(() => '?').join(',');
    const servicosSel = await dbAll(`SELECT * FROM servicos WHERE id IN (${placeholders})`, servicosIds);
    if (!servicosSel || !servicosSel.length) return renderErro('Serviço inválido.');

    const nomes = servicosSel.map(s => s.nome.toLowerCase().trim());
    if (!validarDependenciasServicos(nomes)) {
      return renderErro('Tosa e Hidratação só podem ser agendados junto com Banho.');
    }

    const { subtotal, desconto, valorFinal, campoPreco } = calcularValores(servicosSel, pet);
    const funcId = funcionario_id && parseInt(funcionario_id) > 0 ? parseInt(funcionario_id) : null;

    await dbTransaction(async () => {
      const ag = await dbRun(
        `INSERT INTO agendamentos (cliente_id, pet_id, data_hora, status, observacoes, valor, desconto, funcionario_id) VALUES (?, ?, ?, 'confirmado', ?, ?, ?, ?)`,
        [pet.cliente_id, pet_id, data_hora, observacoes || null, valorFinal, desconto, funcId]
      );
      for (const s of servicosSel) {
        await dbRun(
          `INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, ?)`,
          [ag.lastID, s.id, parseFloat(s[campoPreco]) || 0]
        );
      }
    });

    res.redirect('/agendamentos?sucesso=criado');
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    renderErro('Erro ao salvar. Tente novamente.');
  }
});

router.get('/agendamentos/calendario-dados', verificarAutenticacao, async (req, res) => {
  try {
    const inicio = req.query.inicio;
    const fim = req.query.fim;
    if (!inicio || !fim) return res.json({ ok: false, dados: [] });
    const dados = await dbAll(`
      SELECT a.id, a.data_hora, a.status, a.valor,
             c.nome AS cliente_nome, p.nome AS pet_nome,
             GROUP_CONCAT(s.nome, ', ') AS servicos_nomes,
             f.nome AS funcionario_nome
      FROM agendamentos a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN pets p ON a.pet_id = p.id
      LEFT JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ag_s.servico_id
      LEFT JOIN funcionarios f ON f.id = a.funcionario_id
      WHERE date(a.data_hora) >= ? AND date(a.data_hora) < ?
      GROUP BY a.id
      ORDER BY a.data_hora ASC
    `, [inicio, fim]);
    res.json({ ok: true, dados: dados || [] });
  } catch (err) {
    console.error('Erro calendario dados:', err);
    res.json({ ok: false, dados: [] });
  }
});

router.get('/agendamentos/:id/editar', verificarAutenticacao, async (req, res) => {
  try {
    const agendamento = await dbGet(`SELECT a.* FROM agendamentos a WHERE a.id = ?`, [req.params.id]);
    if (!agendamento) return res.redirect('/agendamentos');

    const [agServicos, { pets, servicos, funcionarios }] = await Promise.all([
      dbAll(`SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ?`, [agendamento.id]),
      carregarFormData()
    ]);

    const servicosSelecionadosIds = (agServicos || []).map(r => r.servico_id);
    const data = agendamento.data_hora.split(' ')[0] || agendamento.data_hora.split('T')[0];
    const hora = agendamento.data_hora.slice(11, 16);

    res.render('agendamentos/editar', {
      usuario: req.session.usuario,
      paginaAtiva: 'agendamentos',
      agendamento, pets, servicos, funcionarios,
      servicosSelecionadosIds, data, hora, erro: null
    });
  } catch (err) {
    console.error('Erro ao carregar form de edição:', err);
    res.redirect('/agendamentos');
  }
});

router.post('/agendamentos/:id/editar', verificarAutenticacao, async (req, res) => {
  const { pet_id, data, hora, status, observacoes, funcionario_id } = req.body;
  const servicosIds = normalizarServicos(req.body.servicos);
  const id = req.params.id;

  const renderErro = async (erro) => {
    const agendamento = await dbGet(`SELECT * FROM agendamentos WHERE id = ?`, [id]);
    const agServicos = await dbAll(`SELECT servico_id FROM agendamento_servicos WHERE agendamento_id = ?`, [id]);
    const servicosSelecionadosIds = (agServicos || []).map(r => r.servico_id);
    const { pets, servicos, funcionarios } = await carregarFormData();
    res.render('agendamentos/editar', {
      usuario: req.session.usuario, paginaAtiva: 'agendamentos',
      agendamento, pets, servicos, funcionarios, servicosSelecionadosIds,
      data: agendamento.data_hora.split(' ')[0],
      hora: agendamento.data_hora.slice(11, 16),
      erro
    });
  };

  if (!pet_id) return renderErro('Selecione o pet.');
  if (servicosIds.length === 0) return renderErro('Selecione ao menos um serviço.');
  if (!data || !hora) return renderErro('Informe a data e o horário do agendamento.');
  if (!status) return renderErro('Selecione o status do agendamento.');

  const data_hora = `${data} ${hora}:00`;
  const slotHora = `${data} ${hora.split(':')[0]}`;

  try {
    const slotRow = await dbGet(
      `SELECT COUNT(*) AS count FROM agendamentos WHERE strftime('%Y-%m-%d %H', data_hora) = ? AND status != 'cancelado' AND id != ?`,
      [slotHora, id]
    );
    if (slotRow && slotRow.count >= CAPACIDADE_MAX_POR_HORA) {
      return renderErro('Horário lotado! Já existem 3 agendamentos nesse horário.');
    }

    // SQLite não aceita arrays como parâmetro — monta os '?' dinamicamente para o IN
    const placeholdersServ = servicosIds.map(() => '?').join(',');
    const dupRow = await dbGet(
      `SELECT COUNT(*) AS count
       FROM agendamentos a
       JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
       WHERE a.pet_id = ?
         AND strftime('%Y-%m-%d %H', a.data_hora) = ?
         AND ag_s.servico_id IN (${placeholdersServ})
         AND a.status != 'cancelado'
         AND a.id != ?`,
      [pet_id, slotHora, ...servicosIds, id]
    );
    if (dupRow && dupRow.count > 0) {
      return renderErro('Este pet já possui agendamento com o(s) mesmo(s) serviço(s) nesse dia e horário.');
    }

    const pet = await dbGet(
      'SELECT p.*, c.id AS cliente_id FROM pets p LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?',
      [pet_id]
    );
    if (!pet) return renderErro('Pet não encontrado.');

    const placeholders = servicosIds.map(() => '?').join(',');
    const servicosSel = await dbAll(`SELECT * FROM servicos WHERE id IN (${placeholders})`, servicosIds);
    if (!servicosSel || !servicosSel.length) return renderErro('Serviço inválido.');

    const nomes = servicosSel.map(s => s.nome.toLowerCase().trim());
    if (!validarDependenciasServicos(nomes)) {
      return renderErro('Tosa e Hidratação só podem ser agendados junto com Banho.');
    }

    const { subtotal, desconto, valorFinal, campoPreco } = calcularValores(servicosSel, pet);
    const funcId = funcionario_id && parseInt(funcionario_id) > 0 ? parseInt(funcionario_id) : null;

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE agendamentos SET pet_id=?, cliente_id=?, data_hora=?, status=?, observacoes=?, valor=?, desconto=?, funcionario_id=? WHERE id=?`,
        [pet_id, pet.cliente_id, data_hora, status, observacoes || null, valorFinal, desconto, funcId, id]
      );
      await dbRun(`DELETE FROM agendamento_servicos WHERE agendamento_id = ?`, [id]);
      for (const s of servicosSel) {
        await dbRun(
          `INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES (?, ?, ?)`,
          [id, s.id, parseFloat(s[campoPreco]) || 0]
        );
      }
    });

    res.redirect('/agendamentos?sucesso=editado');
  } catch (err) {
    console.error('Erro ao editar agendamento:', err);
    renderErro('Erro ao salvar. Tente novamente.');
  }
});

router.post('/agendamentos/:id/concluir', verificarAutenticacao, async (req, res) => {
  try {
    await dbRun("UPDATE agendamentos SET status = 'concluido' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao concluir agendamento:', err);
    res.json({ ok: false });
  }
});

router.delete('/agendamentos/:id', verificarAutenticacao, async (req, res) => {
  try {
    await dbTransaction(async () => {
      await dbRun('DELETE FROM agendamento_servicos WHERE agendamento_id = ?', [req.params.id]);
      await dbRun('DELETE FROM agendamentos WHERE id = ?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir agendamento:', err);
    res.json({ ok: false });
  }
});

module.exports = router;

