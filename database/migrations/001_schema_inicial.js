const bcrypt = require('bcrypt');

// Schema inicial: o que o database/init.js fazia antes das migrations (BL-15).
// Em banco novo cria tudo. Em banco criado por versões anteriores, os IF NOT EXISTS
// não mexem no que já existe, o passo 3 completa as colunas que faltam e o passo 4
// faz os ajustes que só cabem uma vez por banco.
// Os dados que todo banco precisa (serviços padrão e admin) ficam em database/seeds.

// Adiciona a coluna só se ela ainda não existir. Serve para atualizar bancos
// criados por versões antigas do sistema, sem esconder erros reais.
async function adicionarColunaSeFaltar({ all, run }, tabela, coluna, tipo) {
  const colunas = await all(`PRAGMA table_info(${tabela})`);
  if (!colunas.some(c => c.name === coluna)) {
    await run(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
    return true;
  }
  return false;
}

async function up(consulta) {
  const { run, get } = consulta;

  // 1. Tabelas
  await run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      permissoes TEXT NOT NULL,
      senha_texto TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER,
      deve_trocar_senha INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT,
      email TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
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

  await run(`
    CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      duracao_min INTEGER DEFAULT 60,
      preco_pequeno REAL DEFAULT 0,
      preco_medio REAL DEFAULT 0,
      preco_grande REAL DEFAULT 0,
      pre_requisito_id INTEGER REFERENCES servicos(id)
    )
  `);

  await run(`
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

  await run(`
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

  await run(`
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
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email) WHERE email IS NOT NULL AND email != ''`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone) WHERE telefone IS NOT NULL AND telefone != ''`);

  // 3. Colunas que bancos antigos podem não ter
  await adicionarColunaSeFaltar(consulta, 'servicos', 'preco_pequeno', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar(consulta, 'servicos', 'preco_medio', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar(consulta, 'servicos', 'preco_grande', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar(consulta, 'usuarios', 'senha_texto', 'TEXT');
  await adicionarColunaSeFaltar(consulta, 'usuarios', 'reset_token', 'TEXT');
  await adicionarColunaSeFaltar(consulta, 'usuarios', 'reset_token_expiry', 'INTEGER');
  await adicionarColunaSeFaltar(consulta, 'agendamentos', 'observacoes', 'TEXT');
  await adicionarColunaSeFaltar(consulta, 'agendamentos', 'valor', 'REAL');
  await adicionarColunaSeFaltar(consulta, 'agendamentos', 'desconto', 'REAL DEFAULT 0');
  await adicionarColunaSeFaltar(consulta, 'agendamentos', 'funcionario_id', 'INTEGER');
  await adicionarColunaSeFaltar(consulta, 'funcionarios', 'cpf', 'TEXT');
  await adicionarColunaSeFaltar(consulta, 'funcionarios', 'email', 'TEXT');
  await adicionarColunaSeFaltar(consulta, 'funcionarios', 'usuario_id', 'INTEGER');
  const colunaTrocaSenhaNova = await adicionarColunaSeFaltar(consulta, 'usuarios', 'deve_trocar_senha', 'INTEGER DEFAULT 0');
  const colunaPreRequisitoNova = await adicionarColunaSeFaltar(consulta, 'servicos', 'pre_requisito_id', 'INTEGER');

  // 4. Ajustes de bancos antigos
  // Na primeira vez que a coluna é criada, aplica a RN04 que antes estava fixa no
  // código (Tosa e Hidratação exigem Banho). Em banco novo o seed de serviços já
  // insere os dois com o pré-requisito.
  if (colunaPreRequisitoNova) {
    const banho = await get('SELECT id FROM servicos WHERE nome = ?', ['Banho']);
    if (banho) {
      await run(
        "UPDATE servicos SET pre_requisito_id = ? WHERE nome IN ('Tosa', 'Hidratação')",
        [banho.id]
      );
    }
  }

  // Apaga as senhas legíveis gravadas por versões antigas (RNF04)
  await run('UPDATE usuarios SET senha_texto = NULL WHERE senha_texto IS NOT NULL');

  // Se o admin já existe e ainda usa a senha padrão, obriga a troca no próximo login.
  // Em banco novo o admin ainda não existe: o seed cria com deve_trocar_senha = 1.
  if (colunaTrocaSenhaNova) {
    const admin = await get('SELECT id, senha FROM usuarios WHERE email = ?', ['admin@biomapet.com']);
    if (admin && await bcrypt.compare('123456', admin.senha)) {
      await run('UPDATE usuarios SET deve_trocar_senha = 1 WHERE id = ?', [admin.id]);
    }
  }
}

module.exports = { up };
