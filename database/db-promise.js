const db = require('./db');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    // function() necessário: this.lastID e this.changes não existem em arrow function
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function dbTransaction(fn) {
  await dbRun('BEGIN TRANSACTION');
  try {
    const result = await fn();
    await dbRun('COMMIT');
    return result;
  } catch (err) {
    await dbRun('ROLLBACK');
    throw err;
  }
}

module.exports = { dbGet, dbAll, dbRun, dbTransaction };
