require('dotenv').config();
const { criarConsulta } = require('../db-promise');
const semearServicos = require('./servicos');
const semearAdmin = require('./admin');

// Dados que todo banco precisa ter para o sistema funcionar. Os seeds só inserem o
// que falta, então rodam a cada boot sem duplicar nem alterar nada. Precisam do
// schema pronto: rodam depois das migrations.
// Mesma ordem do init.js antigo: serviços antes do admin.
async function semear(conexao) {
  const consulta = criarConsulta(conexao);
  const servicos = await semearServicos(consulta);
  const admin = await semearAdmin(consulta);
  return { servicos, admin };
}

// Permite rodar sozinho com `npm run seed`, no banco do app
if (require.main === module) {
  const db = require('../db');
  semear(db)
    .then(({ servicos, admin }) => {
      if (servicos.length === 0 && !admin) console.log('Nada a semear: serviços padrão e admin já existem.');
      if (servicos.length > 0) console.log(`Serviços padrão inseridos: ${servicos.join(', ')}`);
      if (admin) console.log('Admin criado: admin@biomapet.com');
      db.close();
    })
    .catch(err => {
      console.error('Erro ao rodar os seeds:', err);
      process.exit(1);
    });
}

module.exports = semear;
