const bcrypt = require('bcrypt');
const db = require('./db');
const { dbGet, dbAll, dbRun } = require('./db-promise');

// Adiciona a coluna só se ela ainda não existir. Serve para atualizar bancos
// criados por versões antigas do sistema, sem esconder erros reais.
async function adicionarColunaSeFaltar(tabela, coluna, tipo) {
  const colunas = await dbAll(`PRAGMA table_info(${tabela})`);
  if (!colunas.some(c => c.name === coluna)) {
    await dbRun(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  }
}

async function inicializarBanco() {
  // 1. Tabelas
  await dbRun(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      permissoes TEXT NOT NULL,
      senha_texto TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      email TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      especie TEXT NOT NULL,
      raca TEXT,
      porte TEXT,
      cliente_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      duracao_min INTEGER DEFAULT 60,
      preco_pequeno REAL DEFAULT 0,
      preco_medio REAL DEFAULT 0,
      preco_grande REAL DEFAULT 0
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      ativo INTEGER DEFAULT 1,
      cpf TEXT,
      email TEXT,
      usuario_id INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      pet_id INTEGER,
      servico_id INTEGER,
      data_hora DATETIME NOT NULL,
      status TEXT DEFAULT 'pendente',
      observacoes TEXT,
      valor REAL,
      desconto REAL DEFAULT 0,
      funcionario_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (servico_id) REFERENCES servicos(id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS agendamento_servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agendamento_id INTEGER NOT NULL,
      servico_id INTEGER NOT NULL,
      valor REAL DEFAULT 0,
      FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
      FOREIGN KEY (servico_id) REFERENCES servicos(id)
    )
  `);

  // 2. Índices
  await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email) WHERE email IS NOT NULL AND email != ''`);
  await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone) WHERE telefone IS NOT NULL AND telefone != ''`);

  // 3. Colunas que bancos antigos podem não ter
  await adicionarColunaSeFaltar('servicos', 'preco_pequeno', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar('servicos', 'preco_medio', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar('servicos', 'preco_grande', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar('usuarios', 'senha_texto', 'TEXT');
  await adicionarColunaSeFaltar('usuarios', 'reset_token', 'TEXT');
  await adicionarColunaSeFaltar('usuarios', 'reset_token_expiry', 'INTEGER');
  await adicionarColunaSeFaltar('agendamentos', 'observacoes', 'TEXT');
  await adicionarColunaSeFaltar('agendamentos', 'valor', 'REAL');
  await adicionarColunaSeFaltar('agendamentos', 'desconto', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar('agendamentos', 'funcionario_id', 'INTEGER');
  await adicionarColunaSeFaltar('funcionarios', 'cpf', 'TEXT');
  await adicionarColunaSeFaltar('funcionarios', 'email', 'TEXT');
  await adicionarColunaSeFaltar('funcionarios', 'usuario_id', 'INTEGER');

  // 4. Serviços padrão
  const servicosPadrao = [
    { nome: 'Banho', duracao_min: 60, preco_pequeno: 30, preco_medio: 45, preco_grande: 60 },
    { nome: 'Tosa', duracao_min: 90, preco_pequeno: 40, preco_medio: 55, preco_grande: 70 },
    { nome: 'Hidratação', duracao_min: 45, preco_pequeno: 25, preco_medio: 35, preco_grande: 50 },
    { nome: 'Consulta Básica', duracao_min: 30, preco_pequeno: 50, preco_medio: 50, preco_grande: 50 },
    { nome: 'Corte de Unhas', duracao_min: 20, preco_pequeno: 15, preco_medio: 20, preco_grande: 25 },
  ];

  for (const s of servicosPadrao) {
    const existe = await dbGet('SELECT id FROM servicos WHERE nome = ?', [s.nome]);
    if (!existe) {
      await dbRun(
        'INSERT INTO servicos (nome, duracao_min, preco_pequeno, preco_medio, preco_grande) VALUES (?, ?, ?, ?, ?)',
        [s.nome, s.duracao_min, s.preco_pequeno, s.preco_medio, s.preco_grande]
      );
    }
  }

  // 5. Usuário admin inicial
  const admin = await dbGet('SELECT id FROM usuarios WHERE email = ?', ['admin@biomapet.com']);
  if (!admin) {
    const senhaHash = await bcrypt.hash('123456', 10);
    await dbRun(
      'INSERT INTO usuarios (nome, email, senha, permissoes) VALUES (?, ?, ?, ?)',
      ['Administrador', 'admin@biomapet.com', senhaHash, 'administrador']
    );
  }
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