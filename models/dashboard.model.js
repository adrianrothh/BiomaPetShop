const { dbGet, dbAll } = require('../database/db-promise');

async function contarTotais() {
  const [clientes, pets, servicos] = await Promise.all([
    dbGet('SELECT COUNT(*) AS total FROM clientes'),
    dbGet('SELECT COUNT(*) AS total FROM pets'),
    dbGet('SELECT COUNT(*) AS total FROM servicos')
  ]);
  return {
    clientes: clientes ? clientes.total : 0,
    pets: pets ? pets.total : 0,
    servicos: servicos ? servicos.total : 0
  };
}

function listarClientesRecentes(limite) {
  return dbAll('SELECT nome, criado_em FROM clientes ORDER BY criado_em DESC, id DESC LIMIT ?', [limite]);
}

function listarPetsRecentes(limite) {
  return dbAll(`
    SELECT p.nome, p.especie, p.raca, c.nome AS cliente_nome
    FROM pets p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    ORDER BY p.id DESC
    LIMIT ?
  `, [limite]);
}

function listarFuncionarios(limite) {
  return dbAll(`
    SELECT u.nome, u.email, f.telefone, f.ativo
    FROM usuarios u
    LEFT JOIN funcionarios f ON f.usuario_id = u.id
    ORDER BY u.nome ASC
    LIMIT ?
  `, [limite]);
}

module.exports = { contarTotais, listarClientesRecentes, listarPetsRecentes, listarFuncionarios };
