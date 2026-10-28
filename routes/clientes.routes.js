const express = require('express');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const { capitalize, telPattern, emailPattern } = require('../utils/helpers');

const router = express.Router();

router.get('/clientes', verificarAutenticacao, asyncHandler(async (req, res, next) => {
  try {
    const clientes = await dbAll(`
      SELECT c.*,
        COUNT(p.id) AS total_pets,
        GROUP_CONCAT(p.nome, ', ') AS nomes_pets
      FROM clientes c
      LEFT JOIN pets p ON p.cliente_id = c.id
      GROUP BY c.id
      ORDER BY c.nome ASC
    `);
    res.render('clientes/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'clientes',
      clientes: clientes || [],
      erro: req.query.erro || null,
      sucesso: req.query.sucesso || null
    });
  } catch (err) {
    next(err);
  }
}));

router.post('/clientes', verificarAutenticacao, asyncHandler(async (req, res) => {
  const { nome, telefone, email } = req.body;
  const telefoneSanitizado = telefone && telefone.trim() ? telefone.trim() : null;
  const emailSanitizado = email && email.trim() ? email.trim() : null;

  if (!nome || !nome.trim() || !telefoneSanitizado || !telPattern.test(telefoneSanitizado) || !emailSanitizado || !emailPattern.test(emailSanitizado)) {
    return res.status(400).json({ ok: false, erro: 'dados_invalidos' });
  }

  try {
    const dupTel = await dbGet('SELECT id FROM clientes WHERE telefone = ?', [telefoneSanitizado]);
    if (dupTel) return res.status(409).json({ ok: false, erro: 'telefone_duplicado' });

    const dupEmail = await dbGet('SELECT id FROM clientes WHERE email = ?', [emailSanitizado]);
    if (dupEmail) return res.status(409).json({ ok: false, erro: 'email_duplicado' });

    await dbRun('INSERT INTO clientes (nome, telefone, email) VALUES (?, ?, ?)', [capitalize(nome), telefoneSanitizado, emailSanitizado]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao criar cliente:', err);
    res.status(500).json({ ok: false, erro: 'erro_db' });
  }
}));

router.put('/clientes/:id', verificarAutenticacao, asyncHandler(async (req, res) => {
  const { nome, telefone, email } = req.body;
  const telefoneSanitizado = telefone && telefone.trim() ? telefone.trim() : null;
  const emailSanitizado = email && email.trim() ? email.trim() : null;

  if (!nome || !nome.trim() || !telefoneSanitizado || !telPattern.test(telefoneSanitizado) || !emailSanitizado || !emailPattern.test(emailSanitizado)) {
    return res.status(400).json({ ok: false, erro: 'dados_invalidos' });
  }

  try {
    const dupTel = await dbGet('SELECT id FROM clientes WHERE telefone = ? AND id != ?', [telefoneSanitizado, req.params.id]);
    if (dupTel) return res.status(409).json({ ok: false, erro: 'telefone_duplicado' });

    const dupEmail = await dbGet('SELECT id FROM clientes WHERE email = ? AND id != ?', [emailSanitizado, req.params.id]);
    if (dupEmail) return res.status(409).json({ ok: false, erro: 'email_duplicado' });

    await dbRun('UPDATE clientes SET nome = ?, telefone = ?, email = ? WHERE id = ?', [capitalize(nome), telefoneSanitizado, emailSanitizado, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao editar cliente:', err);
    res.status(500).json({ ok: false, erro: 'erro_db' });
  }
}));

router.get('/clientes/:id/pets', verificarAutenticacao, asyncHandler(async (req, res) => {
  try {
    const pets = await dbAll(
      'SELECT id, nome, especie, raca, porte FROM pets WHERE cliente_id = ? ORDER BY nome ASC',
      [req.params.id]
    );
    res.json({ ok: true, pets: pets || [] });
  } catch (err) {
    res.status(500).json({ ok: false, pets: [] });
  }
}));

router.delete('/clientes/:id', verificarAutenticacao, asyncHandler(async (req, res) => {
  const id = req.params.id;
  try {
    // Ordem importa: agendamento_servicos → agendamentos → pets → cliente (sem CASCADE nessa direção)
    await dbTransaction(async () => {
      await dbRun(`
        DELETE FROM agendamento_servicos WHERE agendamento_id IN (
          SELECT a.id FROM agendamentos a
          INNER JOIN pets p ON a.pet_id = p.id
          WHERE p.cliente_id = ?
        )
      `, [id]);
      await dbRun('DELETE FROM agendamentos WHERE pet_id IN (SELECT id FROM pets WHERE cliente_id = ?)', [id]);
      await dbRun('DELETE FROM pets WHERE cliente_id = ?', [id]);
      await dbRun('DELETE FROM clientes WHERE id = ?', [id]);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir cliente:', err);
    res.status(500).json({ ok: false });
  }
}));

module.exports = router;

