// Tratamento de erro centralizado (BL-11). Os dois handlers ficam no fim do app.js,
// depois de todas as rotas.

// Status do próprio erro (ex.: 400 do express.json com JSON malformado) quando é um
// status de erro HTTP; qualquer outro caso vira 500.
function statusDoErro(err) {
  const status = err && (err.status || err.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function codigoDoErro(status) {
  if (status === 404) return 'nao_encontrado';
  if (status < 500) return 'requisicao_invalida';
  return 'erro_interno';
}

// Chamadas do front com fetch recebem JSON; o navegador recebe a página de erro
function esperaJson(req) {
  return Boolean(req.xhr || req.is('application/json') || req.accepts(['html', 'json']) === 'json');
}

function usuarioDaSessao(req) {
  return req.session && req.session.usuario ? req.session.usuario : null;
}

function responderErro(req, res, status, err) {
  if (esperaJson(req)) {
    // Nunca inclui a mensagem nem o stack do erro
    return res.status(status).json({ ok: false, erro: codigoDoErro(status) });
  }

  const titulo = status === 404 ? 'Página não encontrada' : 'Algo deu errado';
  // Lido a cada requisição, e não no carregamento do módulo, para os testes alternarem o ambiente
  const mostrarDetalhe = process.env.NODE_ENV !== 'production';

  // Layout sem sidebar (BL-14): a página também aparece para quem não está logado
  res.status(status).render('erro', {
    layout: 'layouts/autenticacao',
    title: `${titulo} - Bioma Pet`,
    status,
    titulo,
    mensagem: status === 404
      ? 'O endereço acessado não existe ou foi removido.'
      : 'Não foi possível concluir a operação. Tente novamente em instantes.',
    linkVolta: usuarioDaSessao(req) ? '/dashboard' : '/login',
    detalhe: mostrarDetalhe && err ? (err.stack || String(err)) : null
  }, (errView, html) => {
    if (errView) {
      console.error('Erro ao renderizar a página de erro:', errView);
      return res.type('text/plain').send(`Erro ${status}: ${titulo}`);
    }
    res.send(html);
  });
}

// Nenhuma rota respondeu
function naoEncontrado(req, res) {
  responderErro(req, res, 404, null);
}

// O Express só reconhece o handler de erro pelos 4 argumentos, por isso o next fica na assinatura
function tratarErro(err, req, res, next) {
  // A resposta já começou: o handler padrão do Express encerra a conexão
  if (res.headersSent) return next(err);

  const status = statusDoErro(err);
  // 404 e os outros 4xx são erros do cliente e não vão para o log
  if (status >= 500) {
    const usuario = usuarioDaSessao(req);
    console.error(
      `Erro ${status} em ${req.method} ${req.originalUrl} (usuário ${usuario ? usuario.id : '-'}):\n` +
      (err && err.stack ? err.stack : String(err))
    );
  }

  responderErro(req, res, status, err);
}

module.exports = { naoEncontrado, tratarErro };
