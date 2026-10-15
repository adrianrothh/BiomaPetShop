const express = require('express');
const { dbAll, dbRun } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');

const router = express.Router();

router.get('/servicos', verificarAutenticacao, async (req, res) => {
  try {
    const servicos = await dbAll('SELECT * FROM servicos ORDER BY nome ASC');
    res.render('servicos/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'servicos',
      servicos: servicos || []
    });
  } catch (err) {
    console.error('Erro ao listar serviços:', err);
    res.render('servicos/index', {
      usuario: req.session.usuario,
      paginaAtiva: 'servicos',
      servicos: []
    });
  }
});

router.put('/servicos/:id', verificarAutenticacao, async (req, res) => {
  const { preco_pequeno, preco_medio, preco_grande } = req.body;
  try {
    await dbRun(
      'UPDATE servicos SET preco_pequeno = ?, preco_medio = ?, preco_grande = ? WHERE id = ?',
      [preco_pequeno, preco_medio, preco_grande, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar serviço:', err);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;

