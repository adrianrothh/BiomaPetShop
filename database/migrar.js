require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { criarConsulta } = require('./db-promise');

const PASTA_MIGRATIONS = path.join(__dirname, 'migrations');

// NNN_nome.js: os três dígitos definem a ordem e viram o id em schema_migrations
const NOME_MIGRATION = /^(\d{3})_([a-z0-9_]+)\.js$/;

// Lista as migrations da pasta em ordem. Um .js fora do padrão ou um número repetido
// interrompe tudo, para nenhuma migration ser pulada sem aviso.
function listarMigrations(pasta) {
  const migrations = fs.readdirSync(pasta)
    .filter(arquivo => arquivo.endsWith('.js'))
    .map(arquivo => {
      const partes = NOME_MIGRATION.exec(arquivo);
      if (!partes) {
        throw new Error(`Migration com nome fora do padrão NNN_nome.js: ${arquivo}`);
      }
      return { id: partes[1], nome: partes[2], arquivo: path.join(pasta, arquivo) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].id === migrations[i - 1].id) {
      throw new Error(`Duas migrations com o número ${migrations[i].id}`);
    }
  }
  return migrations;
}

// Aplica, em ordem, as migrations da pasta que ainda não estão em schema_migrations e
// devolve os nomes das que aplicou. Cada uma roda numa transação junto com o próprio
// registro: se falhar, o ROLLBACK desfaz tudo, nada é registrado e o erro sobe.
// Com `transacao: false` a migration roda fora da transação automática, porque
// PRAGMA foreign_keys = OFF não tem efeito dentro de uma, e cuida da própria transação.
async function migrar(conexao, pasta = PASTA_MIGRATIONS) {
  const consulta = criarConsulta(conexao);
  await consulta.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      aplicada_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const registradas = await consulta.all('SELECT id FROM schema_migrations');
  const jaAplicadas = new Set(registradas.map(m => m.id));
  const pendentes = listarMigrations(pasta).filter(m => !jaAplicadas.has(m.id));

  const aplicadas = [];
  for (const m of pendentes) {
    const nomeCompleto = `${m.id}_${m.nome}`;
    try {
      const migration = require(m.arquivo);
      const aplicar = async () => {
        await migration.up(consulta);
        await consulta.run('INSERT INTO schema_migrations (id, nome) VALUES (?, ?)', [m.id, m.nome]);
      };
      if (migration.transacao === false) await aplicar();
      else await consulta.transacao(aplicar);
    } catch (err) {
      // O erro sobe como veio, só com a migration que falhou anotada para o log
      err.migration = nomeCompleto;
      throw err;
    }
    aplicadas.push(nomeCompleto);
  }
  return aplicadas;
}

// Permite rodar sozinho com `npm run migrate`, no banco do app
if (require.main === module) {
  const db = require('./db');
  migrar(db)
    .then(aplicadas => {
      if (aplicadas.length === 0) console.log('Nenhuma migration pendente.');
      for (const nome of aplicadas) console.log(`Migration aplicada: ${nome}`);
      db.close();
    })
    .catch(err => {
      console.error('Erro ao aplicar as migrations:', err);
      process.exit(1);
    });
}

module.exports = migrar;
