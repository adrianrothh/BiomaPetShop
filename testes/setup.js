// Carregado pelo Jest antes de cada arquivo de teste (setupFiles do jest.config.js).
// As variáveis precisam existir antes do primeiro require do app: o database/db.js
// abre a conexão assim que é carregado e o app.js encerra o processo sem SESSION_SECRET.
// Os valores daqui prevalecem sobre o .env, porque o dotenv não sobrescreve
// variáveis que já estão definidas.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'segredo-usado-so-nos-testes';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_INITIAL_PASSWORD = 'admin-teste-123';
