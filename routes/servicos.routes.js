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

  const precos = [preco_pequeno, preco_medio, preco_grande];
  const invalido = precos.some(v => v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0);
  if (invalido) {
    return res.status(400).json({ ok: false, erro: 'preco_invalido' });
  }

  try {
    const resultado = await dbRun(
      'UPDATE servicos SET preco_pequeno = ?, preco_medio = ?, preco_grande = ? WHERE id = ?',
      [Number(preco_pequeno), Number(preco_medio), Number(preco_grande), req.params.id]
    );
    if (resultado.changes === 0) {
      return res.status(404).json({ ok: false, erro: 'servico_nao_encontrado' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao atualizar serviço:', err);
    res.status(500).json({ ok: false, erro: 'erro_db' });
  }
});

module.exports = router;

