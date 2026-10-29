const express = require('express');
const bcrypt = require('bcrypt');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');
const { verificarAutenticacao, verificarAdmin } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const { capitalize } = require('../utils/helpers');
const Agendamento = require('../models/agendamentos.model');

const router = express.Router();

router.get('/funcionarios', verificarAutenticacao, verificarAdmin, asyncHandler(async (req, res, next) => {
  try {
    const usuarios = await dbAll(`
      SELECT u.id, u.nome, u.email, u.permissoes,
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
    next(err);
  }
}));

router.post('/funcionarios', verificarAutenticacao, verificarAdmin, asyncHandler(async (req, res) => {
  const { nome, telefone, email, senha } = req.body;

  if (!nome || !nome.trim())      return res.status(400).json({ ok: false, erro: 'nome_obrigatorio' });
  if (!email || !email.trim())    return res.status(400).json({ ok: false, erro: 'email_obrigatorio' });
  if (!senha || senha.length < 6) return res.status(400).json({ ok: false, erro: 'senha_curta' });

  try {
    const existente = await dbGet('SELECT id FROM usuarios WHERE email = ?', [email.trim()]);
    if (existente) return res.status(409).json({ ok: false, erro: 'email_duplicado' });

    const senhaHash = await bcrypt.hash(senha, 10);

    await dbTransaction(async () => {
      const result = await dbRun(
        'INSERT INTO usuarios (nome, email, senha, permissoes) VALUES (?, ?, ?, ?)',
        [capitalize(nome), email.trim(), senhaHash, 'funcionario']
      );
      await dbRun(
        'INSERT INTO funcionarios (nome, telefone, usuario_id, ativo) VALUES (?, ?, ?, 1)',
        [capitalize(nome), telefone ? telefone.trim() : null, result.lastID]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao criar funcionário:', err);
    res.status(500).json({ ok: false, erro: 'erro_db' });
  }
}));

router.put('/funcionarios/:id', verificarAutenticacao, verificarAdmin, asyncHandler(async (req, res) => {
  const { nome, telefone, ativo, nova_senha } = req.body;
  const usuarioId = req.params.id;

  if (!nome || !nome.trim()) return res.status(400).json({ ok: false, erro: 'nome_obrigatorio' });

  try {
    await dbRun('UPDATE usuarios SET nome = ? WHERE id = ?', [capitalize(nome), usuarioId]);

    if (nova_senha && nova_senha.length >= 6) {
      const hash = await bcrypt.hash(nova_senha, 10);
      await dbRun('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, usuarioId]);
    }

    await dbRun(
      'UPDATE funcionarios SET nome = ?, telefone = ?, ativo = ? WHERE usuario_id = ?',
      [capitalize(nome), telefone ? telefone.trim() : null, ativo !== undefined ? ativo : 1, usuarioId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao editar funcionário:', err);
    res.status(500).json({ ok: false });
  }
}));

router.get('/funcionarios/:id/agendamentos', verificarAutenticacao, verificarAdmin, asyncHandler(async (req, res) => {
  try {
    const func = await dbGet('SELECT id FROM funcionarios WHERE usuario_id = ?', [req.params.id]);
    if (!func) return res.json({ ok: true, agendamentos: [] });

    const agendamentos = await Agendamento.listarAtivosDoFuncionario(func.id);

    res.json({ ok: true, agendamentos: agendamentos || [] });
  } catch (err) {
    console.error('Erro ao buscar agendamentos do funcionário:', err);
    res.status(500).json({ ok: false, agendamentos: [] });
  }
}));

router.delete('/funcionarios/:id', verificarAutenticacao, verificarAdmin, asyncHandler(async (req, res) => {
  const usuarioId = req.params.id;
  try {
    const alvo = await dbGet('SELECT email FROM usuarios WHERE id = ?', [usuarioId]);
    if (alvo && alvo.email === 'admin@biomapet.com') {
      return res.status(403).json({ ok: false, erro: 'nao_pode_excluir_admin' });
    }

    // O funcionário sai em cascata com o usuário (ON DELETE CASCADE) e os agendamentos dele
    // ficam sem o vínculo (ON DELETE SET NULL), o que preserva o histórico (BL-16)
    await dbRun('DELETE FROM usuarios WHERE id = ?', [usuarioId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir funcionário:', err);
    res.status(500).json({ ok: false });
  }
}));

module.exports = router;