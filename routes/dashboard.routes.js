const express = require('express');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const dashboard = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/dashboard', verificarAutenticacao, asyncHandler(dashboard.exibir));

module.exports = router;
