const db = require('./db');

// Monta run, get, all e transacao com promises para uma conexão qualquer. O app usa a
// conexão do db.js; as migrations e os seeds recebem esse objeto, o que permite
// rodá-los também num banco de teste.
function criarConsulta(conexao) {
  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      conexao.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      conexao.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      // function() necessário: this.lastID e this.changes não existem em arrow function
      conexao.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  async function transacao(fn) {
    await run('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await run('COMMIT');
      return result;
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  }

  return { run, get, all, transacao };
}

const consultaApp = criarConsulta(db);

module.exports = {
  dbGet: consultaApp.get,
  dbAll: consultaApp.all,
  dbRun: consultaApp.run,
  dbTransaction: consultaApp.transacao,
  criarConsulta
};
