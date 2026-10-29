const Dashboard = require('../models/dashboard.model');
const Agendamento = require('../models/agendamentos.model');

const LIMITE_LISTAS = 10;

// toISOString() retorna UTC — monta manualmente para não errar o dia no fuso horário local
function dataLocal(data) {
  return data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0');
}

async function exibir(req, res) {
  res.set('Cache-Control', 'no-store'); // impede que o browser exiba o dashboard após logout pelo botão voltar

  const hoje = dataLocal(new Date());
  const [totais, totalHoje, ultimosClientes, agendamentos, ultimosPets, ultimosFuncionarios] = await Promise.all([
    Dashboard.contarTotais(),
    Agendamento.contarAtivosNoDia(hoje),
    Dashboard.listarClientesRecentes(LIMITE_LISTAS),
    Agendamento.listarProximos(hoje, LIMITE_LISTAS),
    Dashboard.listarPetsRecentes(LIMITE_LISTAS),
    Dashboard.listarFuncionarios(LIMITE_LISTAS)
  ]);

  res.render('dashboard/dashboard', {
    paginaAtiva: 'dashboard',
    totalClientes: totais.clientes,
    totalPets: totais.pets,
    totalServicos: totais.servicos,
    totalHoje,
    ultimosClientes: ultimosClientes || [],
    agendamentos: agendamentos || [],
    ultimosPets: ultimosPets || [],
    ultimosFuncionarios: ultimosFuncionarios || []
  });
}

module.exports = { exibir, LIMITE_LISTAS };
