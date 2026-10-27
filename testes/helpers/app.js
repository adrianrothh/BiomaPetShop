const request = require('supertest');
const app = require('../../app');
const bancoPronto = require('../../database/init');
const db = require('../../database/db');
const { dbAll, dbRun } = require('../../database/db-promise');

const EMAIL_ADMIN = 'admin@biomapet.com';
const SENHA_ADMIN = process.env.ADMIN_INITIAL_PASSWORD;

// Espera o init.js criar o schema, os serviços padrão e o admin no banco em memória
async function prepararBanco() {
  await bancoPronto;

  // A coluna deve_trocar_senha chega com o BL-09 (branch fix/bl09-troca-senha-obrigatoria,
  // ainda não mergeada). Lá o admin nasce com deve_trocar_senha = 1 e, sem zerar,
  // todo login dele seria redirecionado para /trocar-senha.
  const colunas = await dbAll('PRAGMA table_info(usuarios)');
  if (colunas.some(c => c.name === 'deve_trocar_senha')) {
    await dbRun('UPDATE usuarios SET deve_trocar_senha = 0 WHERE email = ?', [EMAIL_ADMIN]);
  }
}

// Apaga o que os testes criaram. Serviços padrão e admin continuam no banco.
async function limparBanco() {
  // Dos filhos para os pais, por causa das chaves estrangeiras
  await dbRun('DELETE FROM agendamento_servicos');
  await dbRun('DELETE FROM agendamentos');
  await dbRun('DELETE FROM pets');
  await dbRun('DELETE FROM clientes');
  await dbRun('DELETE FROM funcionarios');
  await dbRun('DELETE FROM usuarios WHERE email != ?', [EMAIL_ADMIN]);
}

// Faz o login e devolve um agente do supertest que guarda o cookie da sessão.
// Sem email e senha, entra como o admin semeado.
async function login(email = EMAIL_ADMIN, senha = SENHA_ADMIN) {
  const agente = request.agent(app);
  const res = await agente.post('/login').type('form').send({ email, senha });

  if (res.status !== 302 || res.headers.location !== '/dashboard') {
    const destino = res.headers.location ? ` para ${res.headers.location}` : '';
    const alerta = /alert-danger[^>]*>([^<]*)</.exec(res.text || '');
    const motivo = alerta ? ` Mensagem da tela: "${alerta[1].trim()}".` : '';
    throw new Error(
      `Login de ${email} falhou: esperado 302 para /dashboard, recebido ${res.status}${destino}.${motivo}`
    );
  }
  return agente;
}

// Fecha a conexão do banco em memória do arquivo de teste
function fecharBanco() {
  return new Promise((resolve, reject) => {
    db.close(err => (err ? reject(err) : resolve()));
  });
}

module.exports = {
  app,
  request,
  EMAIL_ADMIN,
  SENHA_ADMIN,
  prepararBanco,
  limparBanco,
  login,
  fecharBanco
};
