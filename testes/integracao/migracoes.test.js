const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const migrar = require('../../database/migrar');
const semear = require('../../database/seeds');
const migration001 = require('../../database/migrations/001_schema_inicial');
const { criarConsulta } = require('../../database/db-promise');

// Migrations e seeds (BL-15). Cada teste abre a própria conexão SQLite em memória, e
// não usa a do app. As migrations de teste ficam em pastas temporárias fora do projeto.

const EMAIL_ADMIN = 'admin@biomapet.com';

const conexoes = [];
const pastasTemporarias = [];

afterEach(async () => {
  while (conexoes.length) {
    const conexao = conexoes.pop();
    await new Promise((resolve, reject) => conexao.close(err => (err ? reject(err) : resolve())));
  }
});
afterAll(() => {
  for (const pasta of pastasTemporarias) fs.rmSync(pasta, { recursive: true, force: true });
});

// Banco em memória com as chaves estrangeiras ligadas, como no database/db.js
async function abrirBanco() {
  const conexao = new sqlite3.Database(':memory:');
  conexoes.push(conexao);
  const consulta = criarConsulta(conexao);
  await consulta.run('PRAGMA foreign_keys = ON');
  return { conexao, consulta };
}

// Pasta temporária com as migrations de teste, no formato { 'NNN_nome.js': 'código' }
function criarPastaMigrations(arquivos) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'biomapet-migracoes-'));
  pastasTemporarias.push(pasta);
  for (const [nome, codigo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(pasta, nome), codigo);
  }
  return pasta;
}

// Troca variáveis de ambiente só durante fn e depois restaura; undefined apaga a variável
async function comAmbiente(variaveis, fn) {
  const originais = {};
  for (const [nome, valor] of Object.entries(variaveis)) {
    originais[nome] = process.env[nome];
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  try {
    return await fn();
  } finally {
    for (const [nome, valor] of Object.entries(originais)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
}

// SQL de cada objeto do banco e, por tabela, colunas, índices e chaves estrangeiras
async function retratoSchema({ all }) {
  const objetos = await all('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
  const tabelas = {};
  for (const { name } of objetos.filter(o => o.type === 'table')) {
    tabelas[name] = {
      colunas: await all(`PRAGMA table_info(${name})`),
      indices: await all(`PRAGMA index_list(${name})`),
      chaves: await all(`PRAGMA foreign_key_list(${name})`)
    };
  }
  return { objetos, tabelas };
}

// O retrato sem a tabela schema_migrations e o índice da chave primária dela
function semSchemaMigrations({ objetos, tabelas }) {
  const { schema_migrations: _, ...outras } = tabelas;
  return { objetos: objetos.filter(o => o.tbl_name !== 'schema_migrations'), tabelas: outras };
}

// Todas as linhas de todas as tabelas, menos schema_migrations
async function lerDados({ all }) {
  const tabelas = await all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' ORDER BY name"
  );
  const dados = {};
  for (const { name } of tabelas) {
    dados[name] = await all(`SELECT * FROM ${name} ORDER BY rowid`);
  }
  return dados;
}

function semColunas(linhas, ...colunas) {
  return linhas.map(linha => {
    const copia = { ...linha };
    for (const coluna of colunas) delete copia[coluna];
    return copia;
  });
}

async function idsRegistrados({ all }) {
  const linhas = await all('SELECT id FROM schema_migrations ORDER BY id');
  return linhas.map(l => l.id);
}

async function tabelaExiste({ get }, nome) {
  return Boolean(await get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [nome]));
}

async function nomesDasColunas({ all }, tabela) {
  const colunas = await all(`PRAGMA table_info(${tabela})`);
  return colunas.map(c => c.name);
}

// Cliente, pet, funcionário com usuário, agendamentos e os serviços de cada um.
// Precisa dos serviços Banho e Tosa no banco.
async function inserirDados({ run }) {
  const ana = await run("INSERT INTO clientes (nome, telefone, email) VALUES ('Ana', '11999990001', 'ana@teste.com')");
  const bruno = await run("INSERT INTO clientes (nome, telefone, email) VALUES ('Bruno', '11999990002', '')");
  const rex = await run(
    "INSERT INTO pets (nome, especie, raca, porte, cliente_id) VALUES ('Rex', 'cachorro', 'SRD', 'medio', ?)",
    [ana.lastID]
  );
  const mia = await run(
    "INSERT INTO pets (nome, especie, porte, cliente_id) VALUES ('Mia', 'gato', 'pequeno', ?)",
    [bruno.lastID]
  );
  const usuario = await run(
    "INSERT INTO usuarios (nome, email, senha, permissoes) VALUES ('Carla', 'carla@teste.com', '$2b$04$hash.qualquer', 'funcionario')"
  );
  const carla = await run(
    "INSERT INTO funcionarios (nome, telefone, cpf, email, usuario_id) VALUES ('Carla', '11988887777', '12345678900', 'carla@teste.com', ?)",
    [usuario.lastID]
  );
  const primeiro = await run(
    "INSERT INTO agendamentos (cliente_id, pet_id, data_hora, valor, funcionario_id) VALUES (?, ?, '2026-11-02 10:00', 100, ?)",
    [ana.lastID, rex.lastID, carla.lastID]
  );
  const segundo = await run(
    "INSERT INTO agendamentos (cliente_id, pet_id, data_hora, status, valor, observacoes) VALUES (?, ?, '2026-11-03 14:00', 'concluido', 30, 'tranquila')",
    [bruno.lastID, mia.lastID]
  );
  await run(
    `INSERT INTO agendamento_servicos (agendamento_id, servico_id, valor) VALUES
      (?, (SELECT id FROM servicos WHERE nome = 'Banho'), 45),
      (?, (SELECT id FROM servicos WHERE nome = 'Tosa'), 55),
      (?, (SELECT id FROM servicos WHERE nome = 'Banho'), 30)`,
    [primeiro.lastID, primeiro.lastID, segundo.lastID]
  );
}

// Schema de antes do BL-09 e do BL-23: usuarios sem deve_trocar_senha, servicos sem
// pre_requisito_id e clientes sem os índices únicos
async function criarSchemaAntigo({ run }) {
  await run(`CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL, permissoes TEXT NOT NULL, senha_texto TEXT, reset_token TEXT,
    reset_token_expiry INTEGER)`);
  await run(`CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, telefone TEXT, email TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, especie TEXT NOT NULL, raca TEXT,
    porte TEXT, cliente_id INTEGER, FOREIGN KEY (cliente_id) REFERENCES clientes(id))`);
  await run(`CREATE TABLE servicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, duracao_min INTEGER DEFAULT 60,
    preco_pequeno REAL DEFAULT 0, preco_medio REAL DEFAULT 0, preco_grande REAL DEFAULT 0)`);
  await run(`CREATE TABLE funcionarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, telefone TEXT, ativo INTEGER DEFAULT 1,
    cpf TEXT, email TEXT, usuario_id INTEGER, criado_em DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER, pet_id INTEGER, servico_id INTEGER,
    data_hora DATETIME NOT NULL, status TEXT DEFAULT 'pendente', observacoes TEXT, valor REAL,
    desconto REAL DEFAULT 0, funcionario_id INTEGER,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id), FOREIGN KEY (pet_id) REFERENCES pets(id),
    FOREIGN KEY (servico_id) REFERENCES servicos(id))`);
  await run(`CREATE TABLE agendamento_servicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agendamento_id INTEGER NOT NULL, servico_id INTEGER NOT NULL,
    valor REAL DEFAULT 0,
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
    FOREIGN KEY (servico_id) REFERENCES servicos(id))`);
}

// Banco antigo com dados: os 5 serviços sem pré-requisito (o Banho com preço editado),
// o admin com a senha informada e senha_texto preenchida em todos os usuários
async function criarBancoAntigo(consulta, senhaAdmin) {
  const { run } = consulta;
  await criarSchemaAntigo(consulta);
  await run(`INSERT INTO servicos (nome, duracao_min, preco_pequeno, preco_medio, preco_grande) VALUES
    ('Banho', 60, 35, 45, 60),
    ('Tosa', 90, 40, 55, 70),
    ('Hidratação', 45, 25, 35, 50),
    ('Consulta Básica', 30, 50, 50, 50),
    ('Corte de Unhas', 20, 15, 20, 25)`);
  // Custo baixo no bcrypt só para o teste ser rápido
  const senhaHash = await bcrypt.hash(senhaAdmin, 4);
  await run(
    "INSERT INTO usuarios (nome, email, senha, permissoes, senha_texto) VALUES ('Administrador', ?, ?, 'administrador', ?)",
    [EMAIL_ADMIN, senhaHash, senhaAdmin]
  );
  await inserirDados(consulta);
  await run("UPDATE usuarios SET senha_texto = 'senha-da-carla' WHERE email = 'carla@teste.com'");
}

// Serviços com o nome do pré-requisito no lugar do id
function listarServicos({ all }) {
  return all(`
    SELECT s.nome, s.duracao_min, s.preco_pequeno, s.preco_medio, s.preco_grande, p.nome AS pre_requisito
    FROM servicos s LEFT JOIN servicos p ON p.id = s.pre_requisito_id
    ORDER BY s.id
  `);
}

function buscarUsuario({ get }, email) {
  return get('SELECT * FROM usuarios WHERE email = ?', [email]);
}

describe('banco vazio', () => {
  test('o runner aplica a 001 e registra uma linha em schema_migrations', async () => {
    const { conexao, consulta } = await abrirBanco();

    expect(await migrar(conexao)).toEqual(['001_schema_inicial']);

    const registro = await consulta.all('SELECT id, nome, aplicada_em FROM schema_migrations');
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({ id: '001', nome: 'schema_inicial' });
    expect(registro[0].aplicada_em).toBeTruthy();

    const tabelas = await consulta.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tabelas.map(t => t.name)).toEqual([
      'agendamento_servicos', 'agendamentos', 'clientes', 'funcionarios', 'pets',
      'schema_migrations', 'servicos', 'sqlite_sequence', 'usuarios'
    ]);
  });

  test('rodar de novo não aplica nada nem muda o schema', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);
    const antes = await retratoSchema(consulta);

    expect(await migrar(conexao)).toEqual([]);

    expect(await retratoSchema(consulta)).toEqual(antes);
    expect(await idsRegistrados(consulta)).toEqual(['001']);
  });
});

describe('seeds', () => {
  test('em banco migrado, criam os 5 serviços com o pré-requisito e o admin com a flag 1', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);

    expect(await semear(conexao)).toEqual({
      servicos: ['Banho', 'Tosa', 'Hidratação', 'Consulta Básica', 'Corte de Unhas'],
      admin: true
    });

    expect(await listarServicos(consulta)).toEqual([
      { nome: 'Banho', duracao_min: 60, preco_pequeno: 30, preco_medio: 45, preco_grande: 60, pre_requisito: null },
      { nome: 'Tosa', duracao_min: 90, preco_pequeno: 40, preco_medio: 55, preco_grande: 70, pre_requisito: 'Banho' },
      { nome: 'Hidratação', duracao_min: 45, preco_pequeno: 25, preco_medio: 35, preco_grande: 50, pre_requisito: 'Banho' },
      { nome: 'Consulta Básica', duracao_min: 30, preco_pequeno: 50, preco_medio: 50, preco_grande: 50, pre_requisito: null },
      { nome: 'Corte de Unhas', duracao_min: 20, preco_pequeno: 15, preco_medio: 20, preco_grande: 25, pre_requisito: null }
    ]);

    const admin = await buscarUsuario(consulta, EMAIL_ADMIN);
    expect(admin).toMatchObject({ nome: 'Administrador', permissoes: 'administrador', deve_trocar_senha: 1 });
    expect(await bcrypt.compare(process.env.ADMIN_INITIAL_PASSWORD, admin.senha)).toBe(true);
  });

  test('rodar de novo não duplica nada nem muda a senha do admin', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);
    await semear(conexao);
    const antes = await lerDados(consulta);

    // Mesmo com outra senha no ambiente, o admin que já existe não muda
    const resultado = await comAmbiente({ ADMIN_INITIAL_PASSWORD: 'outra-senha-456' }, () => semear(conexao));

    expect(resultado).toEqual({ servicos: [], admin: false });
    expect(await lerDados(consulta)).toEqual(antes);
  });

  test('em produção, sem ADMIN_INITIAL_PASSWORD e sem admin, falham com a mensagem atual', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);

    await comAmbiente({ NODE_ENV: 'production', ADMIN_INITIAL_PASSWORD: undefined }, async () => {
      await expect(semear(conexao)).rejects.toThrow(
        'ADMIN_INITIAL_PASSWORD não definida. Defina a senha inicial do admin no ambiente.'
      );
    });

    expect(await buscarUsuario(consulta, EMAIL_ADMIN)).toBeUndefined();
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.ADMIN_INITIAL_PASSWORD).toBe('admin-teste-123');
  });

  test('em desenvolvimento, sem ADMIN_INITIAL_PASSWORD, criam o admin com 123456 e avisam no console', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // O mockRestore apaga as chamadas registradas: a conferência vem antes dele
    try {
      await comAmbiente({ NODE_ENV: 'development', ADMIN_INITIAL_PASSWORD: undefined }, () => semear(conexao));
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('ADMIN_INITIAL_PASSWORD não definida'));
    } finally {
      aviso.mockRestore();
    }

    const admin = await buscarUsuario(consulta, EMAIL_ADMIN);
    expect(await bcrypt.compare('123456', admin.senha)).toBe(true);
    expect(admin.deve_trocar_senha).toBe(1);
  });
});

describe('banco criado antes das migrations', () => {
  test('o runner registra a 001 e não perde nem altera dados', async () => {
    const { conexao, consulta } = await abrirBanco();
    // O init.js antigo fazia os mesmos passos da 001 e os seeds, sem registrar nada
    await migration001.up(consulta);
    await semear(conexao);
    await inserirDados(consulta);
    expect(await tabelaExiste(consulta, 'schema_migrations')).toBe(false);
    const dadosAntes = await lerDados(consulta);
    const schemaAntes = await retratoSchema(consulta);

    expect(await migrar(conexao)).toEqual(['001_schema_inicial']);
    expect(await semear(conexao)).toEqual({ servicos: [], admin: false });

    expect(await idsRegistrados(consulta)).toEqual(['001']);
    expect(await lerDados(consulta)).toEqual(dadosAntes);
    expect(semSchemaMigrations(await retratoSchema(consulta))).toEqual(schemaAntes);
  });
});

describe('banco antigo, sem pre_requisito_id e sem deve_trocar_senha', () => {
  test('ganha as colunas e os ajustes, sem perder nem alterar os outros dados', async () => {
    const { conexao, consulta } = await abrirBanco();
    await criarBancoAntigo(consulta, '123456');
    const antes = await lerDados(consulta);

    expect(await migrar(conexao)).toEqual(['001_schema_inicial']);
    expect(await semear(conexao)).toEqual({ servicos: [], admin: false });

    expect(await nomesDasColunas(consulta, 'usuarios')).toContain('deve_trocar_senha');
    expect(await nomesDasColunas(consulta, 'servicos')).toContain('pre_requisito_id');
    const indices = await consulta.all('PRAGMA index_list(clientes)');
    expect(indices.map(i => i.name).sort()).toEqual(['idx_clientes_email', 'idx_clientes_telefone']);

    // Tosa e Hidratação apontam para o Banho, e o preço editado do Banho continua
    expect(await listarServicos(consulta)).toEqual([
      { nome: 'Banho', duracao_min: 60, preco_pequeno: 35, preco_medio: 45, preco_grande: 60, pre_requisito: null },
      { nome: 'Tosa', duracao_min: 90, preco_pequeno: 40, preco_medio: 55, preco_grande: 70, pre_requisito: 'Banho' },
      { nome: 'Hidratação', duracao_min: 45, preco_pequeno: 25, preco_medio: 35, preco_grande: 50, pre_requisito: 'Banho' },
      { nome: 'Consulta Básica', duracao_min: 30, preco_pequeno: 50, preco_medio: 50, preco_grande: 50, pre_requisito: null },
      { nome: 'Corte de Unhas', duracao_min: 20, preco_pequeno: 15, preco_medio: 20, preco_grande: 25, pre_requisito: null }
    ]);

    // O admin ainda usa 123456: troca obrigatória. A Carla fica com o padrão 0.
    expect((await buscarUsuario(consulta, EMAIL_ADMIN)).deve_trocar_senha).toBe(1);
    expect((await buscarUsuario(consulta, 'carla@teste.com')).deve_trocar_senha).toBe(0);

    const senhasLegiveis = await consulta.all('SELECT email FROM usuarios WHERE senha_texto IS NOT NULL');
    expect(senhasLegiveis).toEqual([]);

    const depois = await lerDados(consulta);
    expect(semColunas(depois.usuarios, 'senha_texto', 'deve_trocar_senha'))
      .toEqual(semColunas(antes.usuarios, 'senha_texto'));
    expect(semColunas(depois.servicos, 'pre_requisito_id')).toEqual(antes.servicos);
    for (const tabela of Object.keys(antes).filter(t => t !== 'usuarios' && t !== 'servicos')) {
      expect(depois[tabela]).toEqual(antes[tabela]);
    }
  });

  test('se o admin já trocou a senha 123456, a flag dele fica 0', async () => {
    const { conexao, consulta } = await abrirBanco();
    await criarBancoAntigo(consulta, 'senha-escolhida-789');

    await migrar(conexao);
    await semear(conexao);

    expect((await buscarUsuario(consulta, EMAIL_ADMIN)).deve_trocar_senha).toBe(0);
  });
});

describe('falha numa migration', () => {
  test('faz rollback, não registra a migration e propaga o erro', async () => {
    const { conexao, consulta } = await abrirBanco();
    const pasta = criarPastaMigrations({
      '001_cria_e_falha.js': `
        exports.up = async ({ run }) => {
          await run('CREATE TABLE tabela_da_falha (id INTEGER)');
          throw new Error('falha proposital');
        };
      `
    });

    const erro = await migrar(conexao, pasta).catch(err => err);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe('falha proposital');
    expect(erro.migration).toBe('001_cria_e_falha');
    expect(await tabelaExiste(consulta, 'tabela_da_falha')).toBe(false);
    expect(await idsRegistrados(consulta)).toEqual([]);
  });

  test('as migrations anteriores à que falhou continuam aplicadas e registradas', async () => {
    const { conexao, consulta } = await abrirBanco();
    const pasta = criarPastaMigrations({
      '001_cria_tabela.js': "exports.up = ({ run }) => run('CREATE TABLE tabela_ok (id INTEGER)');",
      '002_falha.js': "exports.up = async () => { throw new Error('falha proposital'); };"
    });

    await expect(migrar(conexao, pasta)).rejects.toThrow('falha proposital');

    expect(await tabelaExiste(consulta, 'tabela_ok')).toBe(true);
    expect(await idsRegistrados(consulta)).toEqual(['001']);
  });
});

describe('transacao: false', () => {
  // Grava o valor de PRAGMA foreign_keys depois de desligar e depois de religar
  const migrationDoPragma = `
    exports.up = async ({ run, get }) => {
      await run('PRAGMA foreign_keys = OFF');
      const desligado = await get('PRAGMA foreign_keys');
      await run('PRAGMA foreign_keys = ON');
      const religado = await get('PRAGMA foreign_keys');
      await run('CREATE TABLE resultado_pragma (desligado INTEGER, religado INTEGER)');
      await run('INSERT INTO resultado_pragma VALUES (?, ?)', [desligado.foreign_keys, religado.foreign_keys]);
    };
  `;

  test('a migration roda fora da transação, desliga e religa as chaves estrangeiras e é registrada', async () => {
    const { conexao, consulta } = await abrirBanco();
    const pasta = criarPastaMigrations({
      '001_desliga_chaves.js': `exports.transacao = false;\n${migrationDoPragma}`
    });

    expect(await migrar(conexao, pasta)).toEqual(['001_desliga_chaves']);

    expect(await consulta.get('SELECT * FROM resultado_pragma')).toEqual({ desligado: 0, religado: 1 });
    expect(await idsRegistrados(consulta)).toEqual(['001']);
  });

  test('sem a opção, a migration roda na transação e o PRAGMA foreign_keys = OFF não tem efeito', async () => {
    const { conexao, consulta } = await abrirBanco();
    const pasta = criarPastaMigrations({ '001_desliga_chaves.js': migrationDoPragma });

    await migrar(conexao, pasta);

    expect(await consulta.get('SELECT * FROM resultado_pragma')).toEqual({ desligado: 1, religado: 1 });
  });
});

describe('arquivos da pasta de migrations', () => {
  test('aplica em ordem numérica e ignora o que não é .js', async () => {
    const { conexao, consulta } = await abrirBanco();
    const registrar = nome => `exports.up = ({ run }) => run("INSERT INTO ordem (nome) VALUES ('${nome}')");`;
    const pasta = criarPastaMigrations({
      '010_terceira.js': registrar('terceira'),
      '002_segunda.js': registrar('segunda'),
      '001_primeira.js': "exports.up = ({ run }) => run('CREATE TABLE ordem (nome TEXT)');",
      'LEIA-ME.txt': 'não é migration'
    });

    expect(await migrar(conexao, pasta)).toEqual(['001_primeira', '002_segunda', '010_terceira']);

    const ordem = await consulta.all('SELECT nome FROM ordem ORDER BY rowid');
    expect(ordem.map(o => o.nome)).toEqual(['segunda', 'terceira']);
  });

  test.each([
    ['nome fora do padrão', { '1_sem_zeros.js': '' }, 'Migration com nome fora do padrão NNN_nome.js: 1_sem_zeros.js'],
    ['número repetido', { '002_uma.js': '', '002_outra.js': '' }, 'Duas migrations com o número 002']
  ])('recusa a pasta com %s sem aplicar nada', async (_, arquivos, mensagem) => {
    const { conexao, consulta } = await abrirBanco();
    const pasta = criarPastaMigrations({
      '001_cria_tabela.js': "exports.up = ({ run }) => run('CREATE TABLE tabela_ok (id INTEGER)');",
      ...arquivos
    });

    await expect(migrar(conexao, pasta)).rejects.toThrow(mensagem);

    expect(await tabelaExiste(consulta, 'tabela_ok')).toBe(false);
    expect(await idsRegistrados(consulta)).toEqual([]);
  });
});
