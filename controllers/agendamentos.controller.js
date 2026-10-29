const Agendamento = require('../models/agendamentos.model');
const { normalizarServicos, calcularValores, servicoSemPreRequisito } = require('../utils/helpers');

const LIMITE = 20;
const CAPACIDADE_MAX_POR_HORA = 3;

const LOTADO_NA_CRIACAO = 'Horário lotado! Já existem 3 agendamentos nesse horário. Escolha outro.';
const LOTADO_NA_EDICAO = 'Horário lotado! Já existem 3 agendamentos nesse horário.';

async function aplicarRegras({ petId, data, hora, servicosIds, ignorarId = null, mensagemLotado }) {
  // Formato 'YYYY-MM-DD HH' para que o strftime agrupe qualquer minuto da mesma hora
  const slotHora = `${data} ${hora.split(':')[0]}`;

  if (await Agendamento.contarNaHora(slotHora, ignorarId) >= CAPACIDADE_MAX_POR_HORA) {
    return { erro: mensagemLotado };
  }

  if (await Agendamento.contarConflitos(petId, slotHora, servicosIds, ignorarId) > 0) {
    return { erro: 'Este pet já possui agendamento com o(s) mesmo(s) serviço(s) nesse dia e horário.' };
  }

  const pet = await Agendamento.buscarPet(petId);
  if (!pet) return { erro: 'Pet não encontrado.' };

  const servicosSel = await Agendamento.listarServicosPorIds(servicosIds);
  if (!servicosSel.length) return { erro: 'Serviço inválido.' };

  const semPreRequisito = servicoSemPreRequisito(servicosSel);
  if (semPreRequisito) {
    const nomePre = await Agendamento.buscarNomeDoServico(semPreRequisito.pre_requisito_id);
    return { erro: `${semPreRequisito.nome} só pode ser agendado junto com ${nomePre || 'o serviço pré-requisito'}.` };
  }

  const { desconto, valorFinal, campoPreco } = calcularValores(servicosSel, pet);
  const itens = servicosSel.map(s => ({ servico_id: s.id, valor: parseFloat(s[campoPreco]) || 0 }));
  return { valor: valorFinal, desconto, itens };
}

function idDoFuncionario(funcionarioId) {
  return funcionarioId && parseInt(funcionarioId) > 0 ? parseInt(funcionarioId) : null;
}

async function renderNovo(res, erro = null) {
  const opcoes = await Agendamento.carregarOpcoesDoFormulario();
  res.render('agendamentos/novo', { paginaAtiva: 'agendamentos', ...opcoes, erro });
}

async function renderEditar(res, agendamento, erro = null) {
  const [servicosSelecionadosIds, opcoes] = await Promise.all([
    Agendamento.listarIdsDosServicos(agendamento.id),
    Agendamento.carregarOpcoesDoFormulario()
  ]);
  res.render('agendamentos/editar', {
    paginaAtiva: 'agendamentos',
    agendamento,
    ...opcoes,
    servicosSelecionadosIds,
    data: agendamento.data_hora.split(' ')[0],
    hora: agendamento.data_hora.slice(11, 16),
    erro
  });
}

async function listar(req, res) {
  const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
  const [total, agendamentos] = await Promise.all([
    Agendamento.contar(),
    Agendamento.listarPagina(LIMITE, (pagina - 1) * LIMITE)
  ]);

  res.render('agendamentos/index', {
    paginaAtiva: 'agendamentos',
    agendamentos: agendamentos || [],
    pagina,
    totalPaginas: Math.ceil(total / LIMITE),
    total,
    sucesso: req.query.sucesso || null
  });
}

function novo(req, res) {
  return renderNovo(res);
}

async function criar(req, res) {
  const { pet_id, data, hora, observacoes, funcionario_id } = req.body;
  const servicosIds = normalizarServicos(req.body.servicos);

  if (!pet_id) return renderNovo(res, 'Selecione o pet.');
  if (servicosIds.length === 0) return renderNovo(res, 'Selecione ao menos um serviço.');
  if (!data || !hora) return renderNovo(res, 'Informe a data e o horário do agendamento.');

  const hoje = new Date().toISOString().split('T')[0];
  if (data < hoje) return renderNovo(res, 'A data do agendamento não pode ser no passado.');

  try {
    const regras = await aplicarRegras({ petId: pet_id, data, hora, servicosIds, mensagemLotado: LOTADO_NA_CRIACAO });
    if (regras.erro) return renderNovo(res, regras.erro);

    await Agendamento.criar({
      pet_id,
      data_hora: `${data} ${hora}:00`,
      observacoes: observacoes || null,
      valor: regras.valor,
      desconto: regras.desconto,
      funcionario_id: idDoFuncionario(funcionario_id)
    }, regras.itens);

    res.redirect('/agendamentos?sucesso=criado');
  } catch (err) {
    console.error('Erro ao criar agendamento:', err);
    // Decisão consciente: o erro volta no próprio formulário, com a mensagem. Com o
    // return, uma falha dentro do renderNovo chega ao handler central.
    return renderNovo(res, 'Erro ao salvar. Tente novamente.');
  }
}

async function calendarioDados(req, res) {
  try {
    const { inicio, fim } = req.query;
    if (!inicio || !fim) return res.status(400).json({ ok: false, dados: [] });
    const dados = await Agendamento.listarPorPeriodo(inicio, fim);
    res.json({ ok: true, dados: dados || [] });
  } catch (err) {
    console.error('Erro calendario dados:', err);
    res.status(500).json({ ok: false, dados: [] });
  }
}

async function editarForm(req, res) {
  const agendamento = await Agendamento.buscarPorId(req.params.id);
  if (!agendamento) return res.redirect('/agendamentos');
  return renderEditar(res, agendamento);
}

async function editar(req, res) {
  const { pet_id, data, hora, status, observacoes, funcionario_id } = req.body;
  const servicosIds = normalizarServicos(req.body.servicos);
  const id = req.params.id;

  const renderErro = async (erro) => {
    const agendamento = await Agendamento.buscarPorId(id);
    if (!agendamento) throw new Error(`Agendamento ${id} não encontrado ao reexibir a edição`);
    return renderEditar(res, agendamento, erro);
  };

  if (!pet_id) return renderErro('Selecione o pet.');
  if (servicosIds.length === 0) return renderErro('Selecione ao menos um serviço.');
  if (!data || !hora) return renderErro('Informe a data e o horário do agendamento.');
  if (!status) return renderErro('Selecione o status do agendamento.');

  try {
    const regras = await aplicarRegras({
      petId: pet_id, data, hora, servicosIds, ignorarId: id, mensagemLotado: LOTADO_NA_EDICAO
    });
    if (regras.erro) return renderErro(regras.erro);

    await Agendamento.atualizar(id, {
      pet_id,
      data_hora: `${data} ${hora}:00`,
      status,
      observacoes: observacoes || null,
      valor: regras.valor,
      desconto: regras.desconto,
      funcionario_id: idDoFuncionario(funcionario_id)
    }, regras.itens);

    res.redirect('/agendamentos?sucesso=editado');
  } catch (err) {
    console.error('Erro ao editar agendamento:', err);
    // Decisão consciente: o erro volta no próprio formulário, com a mensagem. Com o
    // return, uma falha dentro do renderErro (ex.: id inexistente) chega ao handler central.
    return renderErro('Erro ao salvar. Tente novamente.');
  }
}

async function concluir(req, res) {
  try {
    await Agendamento.concluir(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao concluir agendamento:', err);
    res.status(500).json({ ok: false });
  }
}

async function excluir(req, res) {
  try {
    await Agendamento.excluir(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir agendamento:', err);
    res.status(500).json({ ok: false });
  }
}

module.exports = {
  aplicarRegras,
  listar,
  novo,
  criar,
  calendarioDados,
  editarForm,
  editar,
  concluir,
  excluir
};
