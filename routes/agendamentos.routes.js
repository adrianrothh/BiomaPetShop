const express = require('express');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const agendamentos = require('../controllers/agendamentos.controller');

const router = express.Router();

router.get('/agendamentos', verificarAutenticacao, asyncHandler(agendamentos.listar));
router.get('/agendamentos/novo', verificarAutenticacao, asyncHandler(agendamentos.novo));
router.post('/agendamentos', verificarAutenticacao, asyncHandler(agendamentos.criar));
router.get('/agendamentos/calendario-dados', verificarAutenticacao, asyncHandler(agendamentos.calendarioDados));
router.get('/agendamentos/:id/editar', verificarAutenticacao, asyncHandler(agendamentos.editarForm));
router.post('/agendamentos/:id/editar', verificarAutenticacao, asyncHandler(agendamentos.editar));
router.post('/agendamentos/:id/concluir', verificarAutenticacao, asyncHandler(agendamentos.concluir));
router.delete('/agendamentos/:id', verificarAutenticacao, asyncHandler(agendamentos.excluir));

module.exports = router;
