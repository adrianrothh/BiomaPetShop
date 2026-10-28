const { dbGet } = require('../database/db-promise');

async function verificarAutenticacao(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }

  try {
    // Confere no banco se o usuário ainda existe e está ativo
    const usuario = await dbGet(
      `SELECT u.id, u.permissoes, u.deve_trocar_senha, f.ativo
       FROM usuarios u
       LEFT JOIN funcionarios f ON f.usuario_id = u.id
       WHERE u.id = ?`,
      [req.session.usuario.id]
    );

    if (!usuario || usuario.ativo === 0) {
      return req.session.destroy(() => res.redirect('/login'));
    }

    // Mantém o perfil da sessão igual ao do banco
    req.session.usuario.permissoes = usuario.permissoes;

    // Enquanto a troca de senha obrigatória não for feita, só a tela de troca fica liberada
    if (usuario.deve_trocar_senha && req.path !== '/trocar-senha') {
      return res.redirect('/trocar-senha');
    }

    next();
  } catch (err) {
    next(err);
  }
}

function verificarAdmin(req, res, next) {
  if (req.session.usuario && req.session.usuario.permissoes === 'administrador')
    return next();
  return res.redirect('/dashboard');
}

module.exports = { verificarAutenticacao, verificarAdmin };