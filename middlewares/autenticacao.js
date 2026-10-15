function verificarAutenticacao(req, res, next) {
  if (req.session.usuario) {
    return next();
  }

  return res.redirect('/login');
}

function verificarAdmin(req, res, next) {
  if (req.session.usuario && req.session.usuario.permissoes === 'administrador')
    return next();
  return res.redirect('/dashboard');
}

module.exports = { verificarAutenticacao, verificarAdmin };