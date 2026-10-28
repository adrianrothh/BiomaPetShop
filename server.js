require('dotenv').config();

const app = require('./app');
const bancoPronto = require('./database/init');

const PORT = process.env.PORT || 3000;

// Só aceita conexões depois que tabelas, serviços padrão e admin existem
bancoPronto
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar o banco:', err);
    process.exit(1);
  });
