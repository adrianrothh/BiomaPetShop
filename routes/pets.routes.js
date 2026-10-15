const express = require('express');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { capitalize } = require('../utils/helpers');

const router = express.Router();

router.get('/pets', verificarAutenticacao, async (req, res) => {
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
    console.error('Erro ao listar pets:', err);
    res.render('pets/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'pets',
      pets: [],
      clientes: [],
      sucesso: null
    });
  }
});

router.post('/pets', verificarAutenticacao, async (req, res) => {
  const { nome, especie, raca, porte, cliente_id } = req.body;
  if (!nome || !nome.trim() || !especie || !raca || !raca.trim() || !porte || !cliente_id) {
    return res.json({ ok: false, erro: 'Campos obrigatórios faltando' });
  }
  try {
    await dbRun(
      'INSERT INTO pets (nome, especie, raca, porte, cliente_id) VALUES (?, ?, ?, ?, ?)',
      [capitalize(nome), especie, raca ? capitalize(raca) : null, porte || null, cliente_id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao criar pet:', err);
    res.json({ ok: false });
  }
});

router.put('/pets/:id', verificarAutenticacao, async (req, res) => {
  const { nome, especie, raca, porte, cliente_id } = req.body;
  if (!nome || !nome.trim() || !especie || !raca || !raca.trim() || !porte || !cliente_id) {
    return res.json({ ok: false, erro: 'Campos obrigatórios faltando' });
  }
  try {
    await dbRun(
      'UPDATE pets SET nome = ?, especie = ?, raca = ?, porte = ?, cliente_id = ? WHERE id = ?',
      [capitalize(nome), especie, raca ? capitalize(raca) : null, porte || null, cliente_id || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao editar pet:', err);
    res.json({ ok: false });
  }
});

router.delete('/pets/:id', verificarAutenticacao, async (req, res) => {
  const id = req.params.id;
  try {
    // Ordem importa: agendamento_servicos → agendamentos → pet (sem CASCADE nessa direção)
    await dbTransaction(async () => {
      await dbRun(
        'DELETE FROM agendamento_servicos WHERE agendamento_id IN (SELECT id FROM agendamentos WHERE pet_id = ?)',
        [id]
      );
      await dbRun('DELETE FROM agendamentos WHERE pet_id = ?', [id]);
      await dbRun('DELETE FROM pets WHERE id = ?', [id]);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir pet:', err);
    res.json({ ok: false });
  }
});

module.exports = router;

