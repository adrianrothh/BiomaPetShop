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

  // A coluna deve_trocar_senha vem do BL-09 e o admin nasce com ela ligada. Sem zerar,
  // todo login dele seria redirecionado para /trocar-senha, então o helper zera a flag
  // para os testes que entram como admin.
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

// Token anti-CSRF da página (BL-10): o do <input name="_csrf"> dos formulários ou o da
// <meta name="csrf-token"> do layout principal
function tokenDaPagina(html, rota) {
  const achado = /name="_csrf" value="([^"]+)"/.exec(html || '') ||
    /name="csrf-token" content="([^"]+)"/.exec(html || '');
  if (!achado) throw new Error(`A página ${rota} não tem token anti-CSRF`);
  return achado[1];
}

// Abre a página e faz o agente enviar o token dela no header X-CSRF-Token em todas as
// requisições seguintes (o agente.set do superagent vale para as próximas requisições)
async function usarTokenDaPagina(agente, rota) {
  const res = await agente.get(rota);
  agente.set('X-CSRF-Token', tokenDaPagina(res.text, rota));
  return agente;
}

// POST /login como o navegador faz: abre a tela de login, que cria a sessão com o token,
// e envia o token no campo _csrf. Precisa de um request.agent, que guarda o cookie.
async function enviarLogin(agente, email, senha) {
  const pagina = await agente.get('/login');
  return agente.post('/login').type('form').send({ email, senha, _csrf: tokenDaPagina(pagina.text, '/login') });
}

// Faz o login e devolve um agente do supertest que guarda o cookie da sessão e envia o
// token anti-CSRF em toda requisição. Sem email e senha, entra como o admin semeado.
async function login(email = EMAIL_ADMIN, senha = SENHA_ADMIN) {
  const agente = request.agent(app);
  const res = await enviarLogin(agente, email, senha);

  if (res.status !== 302 || res.headers.location !== '/dashboard') {
    const destino = res.headers.location ? ` para ${res.headers.location}` : '';
    const alerta = /alert-danger[^>]*>([^<]*)</.exec(res.text || '');
    const motivo = alerta ? ` Mensagem da tela: "${alerta[1].trim()}".` : '';
    throw new Error(
      `Login de ${email} falhou: esperado 302 para /dashboard, recebido ${res.status}${destino}.${motivo}`
    );
  }
  // O login troca a sessão e, com ela, o token: o token novo vem do dashboard
  return usarTokenDaPagina(agente, '/dashboard');
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
  tokenDaPagina,
  usarTokenDaPagina,
  enviarLogin,
  login,
  fecharBanco
};
