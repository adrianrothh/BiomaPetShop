// Integridade referencial no schema (BL-16). As cascatas que as rotas faziam com DELETEs
// manuais passam a ser do banco: excluir um cliente leva os pets, os agendamentos e os
// serviços deles; excluir um usuário leva o funcionário e deixa os agendamentos dele sem
// o vínculo. Também declara a FK de funcionarios.usuario_id, remove as colunas sem uso e
// tira agendamentos.cliente_id: o cliente do agendamento passa a ser o tutor atual do pet (N5).
//
// O SQLite não altera constraints de uma tabela existente. pets, agendamentos e
// funcionarios são recriadas pelo procedimento oficial, com as chaves desligadas:
// CREATE TABLE x_nova, copia as linhas, DROP TABLE x e ALTER TABLE x_nova RENAME TO x.
// A tabela antiga nunca é renomeada: com o legacy_alter_table desligado, o SQLite
// reescreveria as FKs das outras tabelas para o nome novo e elas quebrariam no DROP.
//
// Antes de recriar, trata os registros que violariam as constraints novas e avisa no log
// quantas linhas cada passo mexeu. `npm run diagnostico` mostra esses registros antes.

// Avisa no log quantas linhas o passo mexeu, só quando mexeu em alguma
function avisar(quantidade, descricao) {
  if (quantidade > 0) console.warn(`Migration 002_integridade: ${descricao}: ${quantidade}`);
}

// Na ordem: cada passo já considera o que os anteriores removeram. Os agendamentos de um
// pet removido ficam sem pet válido no passo 2, e os serviços deles no passo 3.
async function tratarOrfaos({ run, get }) {
  // 1. Pets sem cliente válido (cliente_id nulo ou de cliente que não existe)
  const pets = await run(`
    DELETE FROM pets
    WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id = pets.cliente_id)
  `);
  avisar(pets.changes, 'pets sem cliente válido removidos');

  // 2. Agendamentos sem pet válido
  const agendamentos = await run(`
    DELETE FROM agendamentos
    WHERE NOT EXISTS (SELECT 1 FROM pets p WHERE p.id = agendamentos.pet_id)
  `);
  avisar(agendamentos.changes, 'agendamentos sem pet válido removidos');

  // 3. Serviços de agendamento sem agendamento ou sem serviço válido
  const servicosDoAgendamento = await run(`
    DELETE FROM agendamento_servicos
    WHERE NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.id = agendamento_servicos.agendamento_id)
       OR NOT EXISTS (SELECT 1 FROM servicos s WHERE s.id = agendamento_servicos.servico_id)
  `);
  avisar(servicosDoAgendamento.changes, 'agendamento_servicos sem agendamento ou serviço válido removidos');

  // 4. Funcionários sem usuário válido. Os agendamentos deles ficam sem funcionário no passo 6.
  const funcionarios = await run(`
    DELETE FROM funcionarios
    WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = funcionarios.usuario_id)
  `);
  avisar(funcionarios.changes, 'funcionarios sem usuário válido removidos');

  // 5. Funcionários com usuario_id repetido: fica o de menor id, e os agendamentos dos
  // outros passam para ele, porque é a mesma pessoa
  const repassados = await run(`
    UPDATE agendamentos
    SET funcionario_id = (
      SELECT MIN(f2.id) FROM funcionarios f2
      WHERE f2.usuario_id = (SELECT f.usuario_id FROM funcionarios f WHERE f.id = agendamentos.funcionario_id)
    )
    WHERE funcionario_id IN (
      SELECT f.id FROM funcionarios f
      WHERE f.id > (SELECT MIN(f2.id) FROM funcionarios f2 WHERE f2.usuario_id = f.usuario_id)
    )
  `);
  avisar(repassados.changes, 'agendamentos passados para o funcionário de menor id do mesmo usuário');
  const repetidos = await run(`
    DELETE FROM funcionarios
    WHERE id > (SELECT MIN(f2.id) FROM funcionarios f2 WHERE f2.usuario_id = funcionarios.usuario_id)
  `);
  avisar(repetidos.changes, 'funcionarios com usuario_id repetido removidos');

  // 6. Agendamentos com funcionário que não existe: perdem só o vínculo
  const semFuncionario = await run(`
    UPDATE agendamentos SET funcionario_id = NULL
    WHERE funcionario_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM funcionarios f WHERE f.id = agendamentos.funcionario_id)
  `);
  avisar(semFuncionario.changes, 'agendamentos com funcionário inexistente, funcionario_id anulado');

  // 7. Serviços com pré-requisito que não existe. A FK é da 001 e não muda aqui, mas o
  // foreign_key_check do fim confere o banco inteiro.
  const semPreRequisito = await run(`
    UPDATE servicos SET pre_requisito_id = NULL
    WHERE pre_requisito_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM servicos pre WHERE pre.id = servicos.pre_requisito_id)
  `);
  avisar(semPreRequisito.changes, 'servicos com pré-requisito inexistente, pre_requisito_id anulado');

  // N5: não há o que corrigir, a coluna sai. Só avisa quantos agendamentos passam a
  // mostrar outro cliente, o tutor atual do pet.
  const { total } = await get(`
    SELECT COUNT(*) AS total FROM agendamentos a
    JOIN pets p ON p.id = a.pet_id
    WHERE a.cliente_id IS NOT p.cliente_id
  `);
  avisar(total, 'agendamentos com cliente diferente do tutor do pet, que passam a mostrar o tutor atual');
}

// Cria a x_nova pelo SQL recebido, copia as colunas, apaga a x e renomeia a x_nova para x
async function recriarTabela({ run }, tabela, sqlCriacao, colunas) {
  await run(sqlCriacao);
  await run(`INSERT INTO ${tabela}_nova (${colunas}) SELECT ${colunas} FROM ${tabela}`);
  await run(`DROP TABLE ${tabela}`);
  await run(`ALTER TABLE ${tabela}_nova RENAME TO ${tabela}`);
}

async function up(consulta) {
  const { run, get, all, transacao } = consulta;

  // Só tem efeito fora de transação: o runner chama esta migration sem abrir uma
  await run('PRAGMA foreign_keys = OFF');
  try {
    // Com as chaves ligadas, o DROP TABLE agendamentos apagaria em cascata todo o
    // agendamento_servicos. Se o PRAGMA não pegou, para antes de mexer em qualquer coisa.
    const { foreign_keys: chavesLigadas } = await get('PRAGMA foreign_keys');
    if (chavesLigadas) {
      throw new Error('A 002_integridade precisa das chaves estrangeiras desligadas: rode-a fora de transação');
    }

    await transacao(async () => {
      await tratarOrfaos(consulta);

      // O DROP TABLE apaga a linha da tabela em sqlite_sequence e a tabela nova começa
      // do maior id copiado. Guarda o valor antigo para um id apagado não ser reaproveitado.
      const sequencias = await all(
        "SELECT name, seq FROM sqlite_sequence WHERE name IN ('funcionarios', 'pets', 'agendamentos')"
      );

      await recriarTabela(consulta, 'funcionarios', `
        CREATE TABLE funcionarios_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          telefone TEXT,
          ativo INTEGER DEFAULT 1,
          usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, 'id, nome, telefone, ativo, usuario_id, criado_em');

      await recriarTabela(consulta, 'pets', `
        CREATE TABLE pets_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          especie TEXT NOT NULL,
          raca TEXT,
          porte TEXT,
          cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE
        )
      `, 'id, nome, especie, raca, porte, cliente_id');

      await recriarTabela(consulta, 'agendamentos', `
        CREATE TABLE agendamentos_nova (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
          data_hora DATETIME NOT NULL,
          status TEXT DEFAULT 'pendente',
          observacoes TEXT,
          valor REAL,
          desconto REAL DEFAULT 0,
          funcionario_id INTEGER REFERENCES funcionarios(id) ON DELETE SET NULL
        )
      `, 'id, pet_id, data_hora, status, observacoes, valor, desconto, funcionario_id');

      // Coluna sem constraint: o DROP COLUMN basta, sem recriar a tabela
      await run('ALTER TABLE usuarios DROP COLUMN senha_texto');

      for (const { name, seq } of sequencias) {
        const atualizada = await run('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [seq, name]);
        if (atualizada.changes === 0) {
          await run('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [name, seq]);
        }
      }

      const quebradas = await all('PRAGMA foreign_key_check');
      if (quebradas.length) {
        const lista = quebradas.map(q => `${q.table} rowid ${q.rowid} -> ${q.parent}`).join(', ');
        throw new Error(`Chave estrangeira quebrada depois da 002_integridade: ${lista}`);
      }
    });
  } finally {
    await run('PRAGMA foreign_keys = ON');
  }
}

module.exports = { up, transacao: false };
