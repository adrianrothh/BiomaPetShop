require('dotenv').config();
const db = require('./db');
const migrar = require('./migrar');
const semear = require('./seeds');

// Prepara o banco do app: aplica as migrations pendentes (database/migrations) e
// depois os seeds (database/seeds), que inserem os serviços padrão e o admin se faltarem.
async function inicializarBanco() {
  await migrar(db);
  await semear(db);
}

const bancoPronto = inicializarBanco();

// Permite rodar sozinho com `npm run init-db`
if (require.main === module) {
  bancoPronto
    .then(() => {
      console.log('Banco inicializado.');
      db.close();
    })
    .catch(err => {
      console.error('Erro ao inicializar o banco:', err);
      process.exit(1);
    });
}

module.exports = bancoPronto;