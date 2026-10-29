const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const migrar = require('../../database/migrar');
const semear = require('../../database/seeds');
const migration001 = require('../../database/migrations/001_schema_inicial');
const migration002 = require('../../database/migrations/002_integridade');
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

// Pasta temporária só com a 001, para os testes dela não dependerem das migrations
// seguintes. O arquivo carrega a 001 do projeto: uma cópia fora do projeto não acharia
// o bcrypt que ela usa.
function pastaSo001() {
  const caminho001 = require.resolve('../../database/migrations/001_schema_inicial');
  return criarPastaMigrations({
    '001_schema_inicial.js': `module.exports = require(${JSON.stringify(caminho001)});`
  });
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

// Colunas na ordem da tabela, como no CREATE TABLE: nome, tipo, NOT NULL e DEFAULT
async function descreverColunas({ all }, tabela) {
  const colunas = await all(`PRAGMA table_info(${tabela})`);
  return colunas.map(c => [
    c.name,
    c.type,
    c.notnull ? 'NOT NULL' : '',
    c.dflt_value === null ? '' : `DEFAULT ${c.dflt_value}`
  ].filter(Boolean).join(' '));
}

// Chaves estrangeiras com a ação do ON DELETE, em ordem alfabética
async function descreverChaves({ all }, tabela) {
  const chaves = await all(`PRAGMA foreign_key_list(${tabela})`);
  return chaves.map(c => `${c.from} -> ${c.table}(${c.to}) ON DELETE ${c.on_delete}`).sort();
}

async function sequencias({ all }) {
  const linhas = await all('SELECT name, seq FROM sqlite_sequence ORDER BY name');
  return Object.fromEntries(linhas.map(l => [l.name, l.seq]));
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

    expect(await migrar(conexao, pastaSo001())).toEqual(['001_schema_inicial']);

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
    const pasta = pastaSo001();
    await migrar(conexao, pasta);
    const antes = await retratoSchema(consulta);

    expect(await migrar(conexao, pasta)).toEqual([]);

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

    expect(await migrar(conexao, pastaSo001())).toEqual(['001_schema_inicial']);
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

    expect(await migrar(conexao, pastaSo001())).toEqual(['001_schema_inicial']);
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

    await migrar(conexao, pastaSo001());
    await semear(conexao);

    expect((await buscarUsuario(consulta, EMAIL_ADMIN)).deve_trocar_senha).toBe(0);
  });
});

// Banco com a 001 e os seeds onde a 002 ainda não rodou
async function abrirBancoNa001() {
  const banco = await abrirBanco();
  await migrar(banco.conexao, pastaSo001());
  await semear(banco.conexao);
  return banco;
}

// Um caso de cada tipo de órfão, gravado com as chaves desligadas, além de dados válidos.
// Os ids são fixos para os asserts. Precisa dos serviços padrão no banco.
async function inserirOrfaos({ run }) {
  await run('PRAGMA foreign_keys = OFF');
  await run("INSERT INTO clientes (id, nome) VALUES (1, 'Ana'), (2, 'Bia')");
  await run("INSERT INTO usuarios (id, nome, email, senha, permissoes) VALUES (10, 'Carla', 'carla@teste.com', 'hash', 'funcionario')");
  // Pets 1 e 2 válidos; o 3 sem cliente e o 4 com cliente que não existe
  await run(`INSERT INTO pets (id, nome, especie, cliente_id) VALUES
    (1, 'Rex', 'cao', 1), (2, 'Tom', 'gato', 2), (3, 'Sem Dono', 'cao', NULL), (4, 'Dono Sumiu', 'cao', 999)`);
  // Funcionário 1 válido; o 2 sem usuário, o 3 com usuário que não existe e o 4 repete o usuário do 1
  await run(`INSERT INTO funcionarios (id, nome, usuario_id) VALUES
    (1, 'Carla', 10), (2, 'Sem Usuario', NULL), (3, 'Usuario Sumiu', 999), (4, 'Carla de Novo', 10)`);
  // Agendamento 1 válido; 2 sem pet; 3 com pet que não existe; 4 do pet sem cliente válido;
  // 5 do funcionário repetido; 6 do funcionário sem usuário; 7 com funcionário que não
  // existe; 8 com a Ana como cliente, mas o Tom é da Bia (N5)
  await run(`INSERT INTO agendamentos (id, cliente_id, pet_id, data_hora, funcionario_id) VALUES
    (1, 1, 1, '2030-01-01 10:00:00', 1),
    (2, 1, NULL, '2030-01-02 10:00:00', NULL),
    (3, 1, 999, '2030-01-03 10:00:00', NULL),
    (4, 1, 4, '2030-01-04 10:00:00', NULL),
    (5, 1, 1, '2030-01-05 10:00:00', 4),
    (6, 1, 1, '2030-01-06 10:00:00', 2),
    (7, 1, 1, '2030-01-07 10:00:00', 999),
    (8, 1, 2, '2030-01-08 10:00:00', NULL)`);
  // Serviço 1 válido; o 2 é do agendamento do pet sem cliente; o 3 de agendamento que não
  // existe; o 4 de serviço que não existe
  await run(`INSERT INTO agendamento_servicos (id, agendamento_id, servico_id) VALUES
    (1, 1, (SELECT id FROM servicos WHERE nome = 'Banho')),
    (2, 4, (SELECT id FROM servicos WHERE nome = 'Banho')),
    (3, 999, (SELECT id FROM servicos WHERE nome = 'Banho')),
    (4, 1, 999)`);
  await run("UPDATE servicos SET pre_requisito_id = 999 WHERE nome = 'Consulta Básica'");
  await run('PRAGMA foreign_keys = ON');
}

describe('002_integridade', () => {
  test('em banco vazio, cria as chaves novas e tira as colunas removidas', async () => {
    const { conexao, consulta } = await abrirBanco();

    expect(await migrar(conexao)).toEqual(['001_schema_inicial', '002_integridade']);

    expect(await descreverColunas(consulta, 'pets')).toEqual([
      'id INTEGER', 'nome TEXT NOT NULL', 'especie TEXT NOT NULL', 'raca TEXT', 'porte TEXT',
      'cliente_id INTEGER NOT NULL'
    ]);
    expect(await descreverChaves(consulta, 'pets')).toEqual(['cliente_id -> clientes(id) ON DELETE CASCADE']);

    expect(await descreverColunas(consulta, 'agendamentos')).toEqual([
      'id INTEGER', 'pet_id INTEGER NOT NULL', 'data_hora DATETIME NOT NULL', "status TEXT DEFAULT 'pendente'",
      'observacoes TEXT', 'valor REAL', 'desconto REAL DEFAULT 0', 'funcionario_id INTEGER'
    ]);
    expect(await descreverChaves(consulta, 'agendamentos')).toEqual([
      'funcionario_id -> funcionarios(id) ON DELETE SET NULL',
      'pet_id -> pets(id) ON DELETE CASCADE'
    ]);

    expect(await descreverColunas(consulta, 'funcionarios')).toEqual([
      'id INTEGER', 'nome TEXT NOT NULL', 'telefone TEXT', 'ativo INTEGER DEFAULT 1',
      'usuario_id INTEGER NOT NULL', 'criado_em DATETIME DEFAULT CURRENT_TIMESTAMP'
    ]);
    expect(await descreverChaves(consulta, 'funcionarios')).toEqual(['usuario_id -> usuarios(id) ON DELETE CASCADE']);
    // O UNIQUE de usuario_id vira um índice único automático sobre a coluna
    const [indice, ...outros] = await consulta.all('PRAGMA index_list(funcionarios)');
    expect(outros).toEqual([]);
    expect(indice).toMatchObject({ unique: 1, origin: 'u' });
    expect((await consulta.all(`PRAGMA index_info(${indice.name})`)).map(c => c.name)).toEqual(['usuario_id']);

    expect(await descreverColunas(consulta, 'usuarios')).toEqual([
      'id INTEGER', 'nome TEXT NOT NULL', 'email TEXT NOT NULL', 'senha TEXT NOT NULL', 'permissoes TEXT NOT NULL',
      'reset_token TEXT', 'reset_token_expiry INTEGER', 'deve_trocar_senha INTEGER DEFAULT 0'
    ]);

    // Recriar a agendamentos não muda a chave que aponta para ela
    expect(await descreverChaves(consulta, 'agendamento_servicos')).toEqual([
      'agendamento_id -> agendamentos(id) ON DELETE CASCADE',
      'servico_id -> servicos(id) ON DELETE NO ACTION'
    ]);
  });

  test('não muda clientes, servicos e agendamento_servicos', async () => {
    const so001 = await abrirBanco();
    await migrar(so001.conexao, pastaSo001());
    const completo = await abrirBanco();
    await migrar(completo.conexao);

    const antes = await retratoSchema(so001.consulta);
    const depois = await retratoSchema(completo.consulta);
    for (const tabela of ['clientes', 'servicos', 'agendamento_servicos']) {
      expect(depois.tabelas[tabela]).toEqual(antes.tabelas[tabela]);
      const objetosDa = retrato => retrato.objetos.filter(o => o.tbl_name === tabela);
      expect(objetosDa(depois)).toEqual(objetosDa(antes));
    }
  });

  test('num banco populado depois da 001, preserva os dados e só tira as colunas removidas', async () => {
    const { conexao, consulta } = await abrirBancoNa001();
    await inserirDados(consulta);
    const antes = await lerDados(consulta);
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // O mockRestore apaga as chamadas registradas: a conferência vem antes dele
    try {
      expect(await migrar(conexao)).toEqual(['002_integridade']);
      expect(aviso).not.toHaveBeenCalled();
    } finally {
      aviso.mockRestore();
    }

    const depois = await lerDados(consulta);
    expect(depois.agendamentos).toEqual(semColunas(antes.agendamentos, 'cliente_id', 'servico_id'));
    expect(depois.funcionarios).toEqual(semColunas(antes.funcionarios, 'cpf', 'email'));
    expect(depois.usuarios).toEqual(semColunas(antes.usuarios, 'senha_texto'));
    for (const tabela of ['clientes', 'pets', 'servicos', 'agendamento_servicos']) {
      expect(depois[tabela]).toEqual(antes[tabela]);
    }
    expect(await consulta.all('PRAGMA foreign_key_check')).toEqual([]);
  });

  test('trata cada tipo de órfão na ordem e avisa quantas linhas cada passo mexeu', async () => {
    const { conexao, consulta } = await abrirBancoNa001();
    await inserirOrfaos(consulta);
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(await migrar(conexao)).toEqual(['002_integridade']);
      expect(aviso.mock.calls.map(c => c[0])).toEqual([
        'Migration 002_integridade: pets sem cliente válido removidos: 2',
        'Migration 002_integridade: agendamentos sem pet válido removidos: 3',
        'Migration 002_integridade: agendamento_servicos sem agendamento ou serviço válido removidos: 3',
        'Migration 002_integridade: funcionarios sem usuário válido removidos: 2',
        'Migration 002_integridade: agendamentos passados para o funcionário de menor id do mesmo usuário: 1',
        'Migration 002_integridade: funcionarios com usuario_id repetido removidos: 1',
        'Migration 002_integridade: agendamentos com funcionário inexistente, funcionario_id anulado: 2',
        'Migration 002_integridade: servicos com pré-requisito inexistente, pre_requisito_id anulado: 1',
        'Migration 002_integridade: agendamentos com cliente diferente do tutor do pet, que passam a mostrar o tutor atual: 1'
      ]);
    } finally {
      aviso.mockRestore();
    }

    expect(await consulta.all('SELECT id FROM pets ORDER BY id')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await consulta.all('SELECT id, usuario_id FROM funcionarios ORDER BY id')).toEqual([{ id: 1, usuario_id: 10 }]);
    // O 5 passou para a Carla de menor id; o 6 e o 7 perderam o funcionário
    expect(await consulta.all('SELECT id, pet_id, funcionario_id FROM agendamentos ORDER BY id')).toEqual([
      { id: 1, pet_id: 1, funcionario_id: 1 },
      { id: 5, pet_id: 1, funcionario_id: 1 },
      { id: 6, pet_id: 1, funcionario_id: null },
      { id: 7, pet_id: 1, funcionario_id: null },
      { id: 8, pet_id: 2, funcionario_id: null }
    ]);
    expect(await consulta.all('SELECT id FROM agendamento_servicos ORDER BY id')).toEqual([{ id: 1 }]);
    expect(await listarServicos(consulta)).toEqual([
      expect.objectContaining({ nome: 'Banho', pre_requisito: null }),
      expect.objectContaining({ nome: 'Tosa', pre_requisito: 'Banho' }),
      expect.objectContaining({ nome: 'Hidratação', pre_requisito: 'Banho' }),
      expect.objectContaining({ nome: 'Consulta Básica', pre_requisito: null }),
      expect.objectContaining({ nome: 'Corte de Unhas', pre_requisito: null })
    ]);
    expect(await consulta.get("SELECT pre_requisito_id FROM servicos WHERE nome = 'Consulta Básica'"))
      .toEqual({ pre_requisito_id: null });

    expect(await consulta.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await consulta.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  test('preserva o sqlite_sequence: um insert novo não reaproveita id apagado', async () => {
    const { conexao, consulta } = await abrirBancoNa001();
    const { run } = consulta;
    await inserirDados(consulta);
    // Apaga os agendamentos, a Mia e a Carla: as três tabelas recriadas ficam com o
    // sqlite_sequence acima do maior id, e agendamentos e funcionarios ficam vazias
    await run('DELETE FROM agendamentos');
    await run("DELETE FROM pets WHERE nome = 'Mia'");
    await run('DELETE FROM funcionarios');
    const antes = await sequencias(consulta);
    expect(antes).toMatchObject({ pets: 2, agendamentos: 2, funcionarios: 1 });

    await migrar(conexao);

    expect(await sequencias(consulta)).toEqual(antes);
    const pet = await run("INSERT INTO pets (nome, especie, cliente_id) VALUES ('Thor', 'cao', (SELECT id FROM clientes WHERE nome = 'Ana'))");
    expect(pet.lastID).toBe(antes.pets + 1);
    const agendamento = await run("INSERT INTO agendamentos (pet_id, data_hora) VALUES (?, '2030-01-01 10:00:00')", [pet.lastID]);
    expect(agendamento.lastID).toBe(antes.agendamentos + 1);
    const funcionario = await run("INSERT INTO funcionarios (nome, usuario_id) VALUES ('Carla', (SELECT id FROM usuarios WHERE email = 'carla@teste.com'))");
    expect(funcionario.lastID).toBe(antes.funcionarios + 1);
  });

  test('rodar de novo não aplica nada nem muda o schema', async () => {
    const { conexao, consulta } = await abrirBanco();
    await migrar(conexao);
    const antes = await retratoSchema(consulta);

    expect(await migrar(conexao)).toEqual([]);

    expect(await retratoSchema(consulta)).toEqual(antes);
    expect(await idsRegistrados(consulta)).toEqual(['001', '002']);
  });

  test('com uma chave quebrada que ela não trata, desfaz tudo, não registra e religa as chaves', async () => {
    const { conexao, consulta } = await abrirBancoNa001();
    const { run } = consulta;
    await inserirDados(consulta);
    // Tabela fora do schema do app com uma chave quebrada: só o foreign_key_check do fim a vê
    await run('CREATE TABLE extra (cliente_id INTEGER REFERENCES clientes(id))');
    await run('PRAGMA foreign_keys = OFF');
    await run('INSERT INTO extra (cliente_id) VALUES (999)');
    await run('PRAGMA foreign_keys = ON');
    const dadosAntes = await lerDados(consulta);
    const schemaAntes = await retratoSchema(consulta);

    const erro = await migrar(conexao).catch(err => err);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe('Chave estrangeira quebrada depois da 002_integridade: extra rowid 1 -> clientes');
    expect(erro.migration).toBe('002_integridade');
    expect(await idsRegistrados(consulta)).toEqual(['001']);
    expect(await retratoSchema(consulta)).toEqual(schemaAntes);
    expect(await lerDados(consulta)).toEqual(dadosAntes);
    expect(await consulta.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  test('dentro de uma transação, para antes de mexer em qualquer coisa', async () => {
    const { consulta } = await abrirBancoNa001();
    await inserirDados(consulta);
    const dadosAntes = await lerDados(consulta);

    // Na transação o PRAGMA foreign_keys = OFF não tem efeito, e o DROP TABLE
    // agendamentos apagaria o agendamento_servicos em cascata
    await expect(consulta.transacao(() => migration002.up(consulta)))
      .rejects.toThrow('A 002_integridade precisa das chaves estrangeiras desligadas');

    expect(await lerDados(consulta)).toEqual(dadosAntes);
    expect(await consulta.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
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
