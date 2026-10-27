const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB_PATH troca o banco (ex.: ':memory:' nos testes). Vazio usa o arquivo padrão;
// caminho relativo é resolvido a partir da raiz do projeto, não da pasta de onde
// o processo foi iniciado.
function resolverCaminhoBanco(valor) {
  if (!valor) return path.join(__dirname, 'biomapet.sqlite');
  // ':memory:' é um nome especial do SQLite; resolvido viraria um arquivo com esse nome
  if (valor === ':memory:') return valor;
  if (path.isAbsolute(valor)) return valor;
  return path.resolve(__dirname, '..', valor);
}

const dbPath = resolverCaminhoBanco(process.env.DB_PATH);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar no SQLite:', err.message);
  } else {
    // SQLite desativa chaves estrangeiras por padrão em cada conexão
    db.run('PRAGMA foreign_keys = ON');
  }
});

module.exports = db;