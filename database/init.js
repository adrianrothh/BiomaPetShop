const bcrypt = require('bcrypt');
const db = require('./db');

// serialize() garante execução sequencial — sem isso o SQLite executa as queries em paralelo
db.serialize(async () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      permissoes TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      email TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      duracao_min INTEGER DEFAULT 60,
      preco_pequeno REAL DEFAULT 0,
      preco_medio REAL DEFAULT 0,
      preco_grande REAL DEFAULT 0
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email) WHERE email IS NOT NULL AND email != ''`, () => {});
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone) WHERE telefone IS NOT NULL AND telefone != ''`, () => {});

  // SQLite não suporta IF NOT EXISTS em ALTER TABLE — callback vazio ignora o erro se a coluna já existir
  db.run(`ALTER TABLE servicos ADD COLUMN preco_pequeno REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE servicos ADD COLUMN preco_medio REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE servicos ADD COLUMN preco_grande REAL DEFAULT 0`, () => {});

  db.run(`ALTER TABLE usuarios ADD COLUMN senha_texto TEXT`, () => {});

  db.run(`ALTER TABLE usuarios ADD COLUMN reset_token TEXT`, () => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN reset_token_expiry INTEGER`, () => {});

  db.run(`ALTER TABLE agendamentos ADD COLUMN observacoes TEXT`, () => {});
  db.run(`ALTER TABLE agendamentos ADD COLUMN valor REAL`, () => {});
  db.run(`ALTER TABLE agendamentos ADD COLUMN desconto REAL DEFAULT 0`, () => {});
  db.run(`ALTER TABLE agendamentos ADD COLUMN funcionario_id INTEGER`, () => {});

  db.run(`ALTER TABLE funcionarios ADD COLUMN cpf TEXT`, () => {});
  db.run(`ALTER TABLE funcionarios ADD COLUMN email TEXT`, () => {});
  db.run(`ALTER TABLE funcionarios ADD COLUMN usuario_id INTEGER`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agendamento_servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agendamento_id INTEGER NOT NULL,
      servico_id INTEGER NOT NULL,
      valor REAL DEFAULT 0,
      FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
      FOREIGN KEY (servico_id) REFERENCES servicos(id)
    )
  `);

  const servicosPadrao = [
    { nome: 'Banho', duracao_min: 60, preco_pequeno: 30, preco_medio: 45, preco_grande: 60 },
    { nome: 'Tosa', duracao_min: 90, preco_pequeno: 40, preco_medio: 55, preco_grande: 70 },
    { nome: 'Hidratação', duracao_min: 45, preco_pequeno: 25, preco_medio: 35, preco_grande: 50 },
    { nome: 'Consulta Básica', duracao_min: 30, preco_pequeno: 50, preco_medio: 50, preco_grande: 50 },
    { nome: 'Corte de Unhas', duracao_min: 20, preco_pequeno: 15, preco_medio: 20, preco_grande: 25 },
  ];

  servicosPadrao.forEach(s => {
    db.get('SELECT id FROM servicos WHERE nome = ?', [s.nome], (err, row) => {
      if (!row) {
        db.run(
          'INSERT INTO servicos (nome, duracao_min, preco_pequeno, preco_medio, preco_grande) VALUES (?, ?, ?, ?, ?)',
          [s.nome, s.duracao_min, s.preco_pequeno, s.preco_medio, s.preco_grande]
        );
      }
    });
  });

  db.run(`
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

  const senhaHash = await bcrypt.hash('123456', 10);

  db.get('select * from usuarios where email = ?', ['admin@biomapet.com'], (err, row) => {
    if (err) {
      console.error('Erro ao buscar usuário:', err.message);
      return;
    }

    if (!row) {
      db.run(
        'insert into usuarios (nome, email, senha, permissoes) values (?, ?, ?, ?)',
        ['Administrador', 'admin@biomapet.com', senhaHash, 'administrador'],
        (insertErr) => {
          if (insertErr) {
            console.error('Erro ao inserir usuário inicial:', insertErr.message);
          }
        }
      );
    }
  });
});
