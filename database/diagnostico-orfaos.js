require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3');

// Diagnóstico de órfãos (BL-16): conta os registros que a migration 002 precisa tratar
// antes de declarar as chaves estrangeiras. Só lê o banco, não altera nada.

const LIMITE_EXEMPLOS = 10;

// Cada verificação devolve os ids dos registros com problema, na coluna id.
// `requer` é a coluna sem a qual a verificação não se aplica.
const VERIFICACOES = [
  {
    titulo: 'pets com cliente_id nulo ou inexistente',
    sql: `
      SELECT p.id FROM pets p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE c.id IS NULL
    `
  },
  {
    titulo: 'agendamentos com pet_id nulo ou inexistente',
    sql: `
      SELECT a.id FROM agendamentos a
      LEFT JOIN pets p ON p.id = a.pet_id
      WHERE p.id IS NULL
    `
  },
  {
    titulo: 'agendamento_servicos com agendamento ou serviço inexistente',
    sql: `
      SELECT ag_s.id FROM agendamento_servicos ag_s
      LEFT JOIN agendamentos a ON a.id = ag_s.agendamento_id
      LEFT JOIN servicos s ON s.id = ag_s.servico_id
      WHERE a.id IS NULL OR s.id IS NULL
    `
  },
  {
    titulo: 'agendamentos com funcionario_id de funcionário inexistente',
    sql: `
      SELECT a.id FROM agendamentos a
      LEFT JOIN funcionarios f ON f.id = a.funcionario_id
      WHERE a.funcionario_id IS NOT NULL AND f.id IS NULL
    `
  },
  {
    titulo: 'funcionarios com usuario_id nulo ou inexistente',
    sql: `
      SELECT f.id FROM funcionarios f
      LEFT JOIN usuarios u ON u.id = f.usuario_id
      WHERE u.id IS NULL
    `
  },
  {
    // Só entre os que apontam para um usuário existente, para não contar duas vezes
    // os da verificação anterior. O de menor id de cada usuário não entra na lista.
    titulo: 'funcionarios com usuario_id repetido (fora o de menor id)',
    sql: `
      SELECT f.id FROM funcionarios f
      JOIN usuarios u ON u.id = f.usuario_id
      WHERE f.id > (SELECT MIN(f2.id) FROM funcionarios f2 WHERE f2.usuario_id = f.usuario_id)
    `
  },
  {
    // N5: o pet trocou de tutor e o agendamento ficou com o cliente antigo
    titulo: 'agendamentos cujo cliente_id difere do cliente do pet',
    requer: ['agendamentos', 'cliente_id'],
    sql: `
      SELECT a.id FROM agendamentos a
      JOIN pets p ON p.id = a.pet_id
      WHERE a.cliente_id IS NOT p.cliente_id
    `
  }
];

// Roda as verificações e devolve, para cada uma, o total e até 10 ids de exemplo.
// total null quando a coluna de `requer` não existe no banco.
async function diagnosticar({ all }) {
  const resultado = [];
  for (const v of VERIFICACOES) {
    if (v.requer) {
      const [tabela, coluna] = v.requer;
      const colunas = await all(`PRAGMA table_info(${tabela})`);
      if (!colunas.some(c => c.name === coluna)) {
        resultado.push({ titulo: v.titulo, total: null, exemplos: [], semColuna: `${tabela}.${coluna}` });
        continue;
      }
    }
    const [{ total }] = await all(`SELECT COUNT(*) AS total FROM (${v.sql})`);
    const exemplos = await all(`SELECT id FROM (${v.sql}) ORDER BY id LIMIT ${LIMITE_EXEMPLOS}`);
    resultado.push({ titulo: v.titulo, total, exemplos: exemplos.map(e => e.id) });
  }
  return resultado;
}

function formatar(item) {
  if (item.total === null) return `${item.titulo}: não se aplica (a coluna ${item.semColuna} não existe)`;
  if (item.total === 0) return `${item.titulo}: 0`;
  const reticencias = item.total > item.exemplos.length ? ', ...' : '';
  return `${item.titulo}: ${item.total} (ids ${item.exemplos.join(', ')}${reticencias})`;
}

// Permite rodar sozinho com `npm run diagnostico`, no banco do DB_PATH
if (require.main === module) {
  // Mesmo arquivo que o database/db.js abre: DB_PATH vazio usa database/biomapet.sqlite
  // e caminho relativo parte da raiz do projeto. Não usa o db.js, que abre o banco
  // para escrita e cria o arquivo se ele não existir.
  const caminho = path.resolve(__dirname, '..', process.env.DB_PATH || path.join('database', 'biomapet.sqlite'));
  const conexao = new sqlite3.Database(caminho, sqlite3.OPEN_READONLY, err => {
    if (err) {
      console.error(`Erro ao abrir ${caminho} para leitura:`, err.message);
      process.exit(1);
    }
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    conexao.all(sql, params, (err, linhas) => (err ? reject(err) : resolve(linhas)));
  });

  diagnosticar({ all })
    .then(resultado => {
      console.log(`Diagnóstico de órfãos em ${caminho} (somente leitura)\n`);
      for (const item of resultado) console.log(formatar(item));
      if (resultado.every(item => !item.total)) console.log('\nNenhum problema encontrado.');
      conexao.close();
    })
    .catch(err => {
      console.error('Erro ao rodar o diagnóstico:', err);
      process.exit(1);
    });
}

module.exports = diagnosticar;
