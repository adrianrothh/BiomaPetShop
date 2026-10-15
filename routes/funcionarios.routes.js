const express = require('express');
const bcrypt = require('bcrypt');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');
const { verificarAutenticacao, verificarAdmin } = require('../middlewares/autenticacao');
const { capitalize } = require('../utils/helpers');

const router = express.Router();

router.get('/funcionarios', verificarAutenticacao, verificarAdmin, async (req, res) => {
  try {
    const usuarios = await dbAll(`
      SELECT u.id, u.nome, u.email, u.senha_texto, u.permissoes,
             f.id AS func_id, f.telefone, f.ativo
      FROM usuarios u
      LEFT JOIN funcionarios f ON f.usuario_id = u.id
      ORDER BY u.nome ASC
    `);
    res.render('funcionarios/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'funcionarios',
      usuarios: usuarios || [],
      sucesso: req.query.sucesso || null
    });
  } catch (err) {
    console.error('Erro ao listar funcionários:', err);
    res.render('funcionarios/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'funcionarios',
      usuarios: [],
      sucesso: null
    });
  }
});

router.post('/funcionarios', verificarAutenticacao, verificarAdmin, async (req, res) => {
  const { nome, telefone, email, senha } = req.body;

  if (!nome || !nome.trim())      return res.json({ ok: false, erro: 'nome_obrigatorio' });
  if (!email || !email.trim())    return res.json({ ok: false, erro: 'email_obrigatorio' });
  if (!senha || senha.length < 6) return res.json({ ok: false, erro: 'senha_curta' });

  try {
    const existente = await dbGet('SELECT id FROM usuarios WHERE email = ?', [email.trim()]);
    if (existente) return res.json({ ok: false, erro: 'email_duplicado' });

    const senhaHash = await bcrypt.hash(senha, 10);

    await dbTransaction(async () => {
      // senha_texto armazena a senha legível para o botão "ver senha" no painel admin
      const result = await dbRun(
        'INSERT INTO usuarios (nome, email, senha, senha_texto, permissoes) VALUES (?, ?, ?, ?, ?)',
        [capitalize(nome), email.trim(), senhaHash, senha, 'funcionario']
      );
      await dbRun(
        'INSERT INTO funcionarios (nome, telefone, email, usuario_id, ativo) VALUES (?, ?, ?, ?, 1)',
        [capitalize(nome), telefone ? telefone.trim() : null, email.trim(), result.lastID]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao criar funcionário:', err);
    res.json({ ok: false, erro: 'erro_db' });
  }
});

router.put('/funcionarios/:id', verificarAutenticacao, verificarAdmin, async (req, res) => {
  const { nome, telefone, ativo, nova_senha } = req.body;
  const usuarioId = req.params.id;

  if (!nome || !nome.trim()) return res.json({ ok: false, erro: 'nome_obrigatorio' });

  try {
    await dbRun('UPDATE usuarios SET nome = ? WHERE id = ?', [capitalize(nome), usuarioId]);

    if (nova_senha && nova_senha.length >= 6) {
      const hash = await bcrypt.hash(nova_senha, 10);
      await dbRun('UPDATE usuarios SET senha = ?, senha_texto = ? WHERE id = ?', [hash, nova_senha, usuarioId]);
    }

    await dbRun(
      'UPDATE funcionarios SET nome = ?, telefone = ?, ativo = ? WHERE usuario_id = ?',
      [capitalize(nome), telefone ? telefone.trim() : null, ativo !== undefined ? ativo : 1, usuarioId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao editar funcionário:', err);
    res.json({ ok: false });
  }
});

router.get('/funcionarios/:id/agendamentos', verificarAutenticacao, verificarAdmin, async (req, res) => {
  try {
    const func = await dbGet('SELECT id FROM funcionarios WHERE usuario_id = ?', [req.params.id]);
    if (!func) return res.json({ ok: true, agendamentos: [] });

    const agendamentos = await dbAll(`
      SELECT a.id, a.data_hora, a.status,
             c.nome AS cliente_nome,
             p.nome AS pet_nome,
             GROUP_CONCAT(s.nome, ', ') AS servicos_nomes
      FROM agendamentos a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN pets p ON a.pet_id = p.id
      LEFT JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
      LEFT JOIN servicos s ON s.id = ag_s.servico_id
      WHERE a.funcionario_id = ? AND a.status != 'cancelado'
      GROUP BY a.id
      ORDER BY a.data_hora ASC
    `, [func.id]);

    res.json({ ok: true, agendamentos: agendamentos || [] });
  } catch (err) {
    console.error('Erro ao buscar agendamentos do funcionário:', err);
    res.json({ ok: false, agendamentos: [] });
  }
});

router.delete('/funcionarios/:id', verificarAutenticacao, verificarAdmin, async (req, res) => {
  const usuarioId = req.params.id;
  try {
    await dbTransaction(async () => {
      const func = await dbGet('SELECT id FROM funcionarios WHERE usuario_id = ?', [usuarioId]);
      if (func) {
        // Preserva o histórico de agendamentos — apenas desvincula o funcionário
        await dbRun('UPDATE agendamentos SET funcionario_id = NULL WHERE funcionario_id = ?', [func.id]);
        await dbRun('DELETE FROM funcionarios WHERE id = ?', [func.id]);
      }
      await dbRun('DELETE FROM usuarios WHERE id = ?', [usuarioId]);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir funcionário:', err);
    res.json({ ok: false });
  }
});

module.exports = router;

