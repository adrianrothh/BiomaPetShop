// Serviços padrão. Insere só os que faltam, pelo nome, já com o pré-requisito (RN04).
// Um serviço que já existe não é alterado: os preços podem ter sido editados na tela.
const SERVICOS_PADRAO = [
  { nome: 'Banho', duracao_min: 60, preco_pequeno: 30, preco_medio: 45, preco_grande: 60 },
  { nome: 'Tosa', duracao_min: 90, preco_pequeno: 40, preco_medio: 55, preco_grande: 70, pre_requisito: 'Banho' },
  { nome: 'Hidratação', duracao_min: 45, preco_pequeno: 25, preco_medio: 35, preco_grande: 50, pre_requisito: 'Banho' },
  { nome: 'Consulta Básica', duracao_min: 30, preco_pequeno: 50, preco_medio: 50, preco_grande: 50 },
  { nome: 'Corte de Unhas', duracao_min: 20, preco_pequeno: 15, preco_medio: 20, preco_grande: 25 },
];

// Devolve os nomes dos serviços inseridos
async function semearServicos({ get, run }) {
  const inseridos = [];
  for (const s of SERVICOS_PADRAO) {
    const existe = await get('SELECT id FROM servicos WHERE nome = ?', [s.nome]);
    if (!existe) {
      const pre = s.pre_requisito
        ? await get('SELECT id FROM servicos WHERE nome = ?', [s.pre_requisito])
        : null;
      await run(
        'INSERT INTO servicos (nome, duracao_min, preco_pequeno, preco_medio, preco_grande, pre_requisito_id) VALUES (?, ?, ?, ?, ?, ?)',
        [s.nome, s.duracao_min, s.preco_pequeno, s.preco_medio, s.preco_grande, pre ? pre.id : null]
      );
      inseridos.push(s.nome);
    }
  }
  return inseridos;
}

module.exports = semearServicos;
