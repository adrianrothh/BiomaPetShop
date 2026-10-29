const express = require('express');
const { dbGet, dbAll, dbRun } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const { capitalize } = require('../utils/helpers');

const router = express.Router();

router.get('/pets', verificarAutenticacao, asyncHandler(async (req, res, next) => {
  try {
    const [pets, clientes] = await Promise.all([
      dbAll(`
        SELECT p.*, c.nome AS cliente_nome
        FROM pets p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        ORDER BY p.nome ASC
      `),
      dbAll('SELECT id, nome FROM clientes ORDER BY nome ASC')
    ]);
    res.render('pets/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'pets',
      pets: pets || [],
      clientes: clientes || [],
      sucesso: req.query.sucesso || null
    });
  } catch (err) {
    next(err);
  }
}));

router.post('/pets', verificarAutenticacao, asyncHandler(async (req, res) => {
  const { nome, especie, raca, porte, cliente_id } = req.body;
  if (!nome || !nome.trim() || !especie || !raca || !raca.trim() || !porte || !cliente_id) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios faltando' });
  }
  try {
    await dbRun(
      'INSERT INTO pets (nome, especie, raca, porte, cliente_id) VALUES (?, ?, ?, ?, ?)',
      [capitalize(nome), especie, raca ? capitalize(raca) : null, porte || null, cliente_id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.status(500).json({ ok: false });
  }
}));

router.put('/pets/:id', verificarAutenticacao, asyncHandler(async (req, res) => {
  const { nome, especie, raca, porte, cliente_id } = req.body;
  if (!nome || !nome.trim() || !especie || !raca || !raca.trim() || !porte || !cliente_id) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios faltando' });
  }
  try {
    await dbRun(
      'UPDATE pets SET nome = ?, especie = ?, raca = ?, porte = ?, cliente_id = ? WHERE id = ?',
      [capitalize(nome), especie, raca ? capitalize(raca) : null, porte || null, cliente_id || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao editar pet:', err);
    res.status(500).json({ ok: false });
  }
}));

router.delete('/pets/:id', verificarAutenticacao, asyncHandler(async (req, res) => {
  const id = req.params.id;
  try {
    // Os agendamentos do pet e os serviços deles saem em cascata (ON DELETE CASCADE, BL-16)
    await dbRun('DELETE FROM pets WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.status(500).json({ ok: false });
  }
}));

module.exports = router;

