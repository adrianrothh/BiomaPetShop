const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { dbGet, dbRun } = require('../database/db-promise');
const { verificarAutenticacao } = require('../middlewares/autenticacao');
const { asyncHandler } = require('../utils/asyncHandler');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();

const MINUTOS_BLOQUEIO = Number(process.env.RATE_LIMIT_MINUTOS) || 15;

const limiteLogin = rateLimit({
  windowMs: MINUTOS_BLOQUEIO * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('autenticacao/login', {
      title: 'Login - Bioma Pet',
      erro: `Muitas tentativas de login. Aguarde ${MINUTOS_BLOQUEIO} minutos e tente novamente.`,
      sucesso: null,
      cadastrado: false
    });
  }
});

const limiteEsqueciSenha = rateLimit({
  windowMs: MINUTOS_BLOQUEIO * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('autenticacao/esqueci-senha', {
      title: 'Esqueci minha senha',
      erro: `Muitas solicitações. Aguarde ${MINUTOS_BLOQUEIO} minutos e tente novamente.`,
      sucesso: null
    });
  }
});

// Layout das telas de autenticação (BL-14). O router é montado em '/', então o
// middleware fica restrito aos caminhos daqui para não valer para as outras telas.
router.use(['/login', '/esqueci-senha', '/redefinir-senha', '/trocar-senha'], (req, res, next) => {
  res.locals.layout = 'layouts/autenticacao';
  next();
});

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.render('autenticacao/login', {
    title: 'Login - Bioma Pet',
    erro: null,
    sucesso: null,
    cadastrado: req.query.cadastrado === '1'
  });
});

router.post('/login', limiteLogin, asyncHandler(async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.render('autenticacao/login', {
      title: 'Login - Bioma Pet',
      erro: 'Preencha email e senha.',
      sucesso: null,
      cadastrado: false
    });
  }

  try {
    const usuario = await dbGet('SELECT * FROM usuarios WHERE email = ?', [email]);

    if (!usuario) {
      return res.status(401).render('autenticacao/login', {
        title: 'Login - Bioma Pet',
        erro: 'Email ou senha inválidos.',
        sucesso: null,
        cadastrado: false
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida) {
      return res.status(401).render('autenticacao/login', {
        title: 'Login - Bioma Pet',
        erro: 'Email ou senha inválidos.',
        sucesso: null,
        cadastrado: false
      });
    }

    const funcRow = await dbGet('SELECT ativo FROM funcionarios WHERE usuario_id = ?', [usuario.id]);
    if (funcRow && funcRow.ativo === 0) {
      return res.render('autenticacao/login', {
        title: 'Login - Bioma Pet',
        erro: 'Usuário Inativo.',
        sucesso: null,
        cadastrado: false
      });
    }

    // Sessão nova a cada login (BL-10): a sessão anônima, que existe por causa do token
    // anti-CSRF da tela de login, não vira a sessão logada, e o token é trocado junto,
    // porque a sessão nova nasce sem ele. Os dados do login só são gravados aqui dentro.
    req.session.regenerate((errSessao) => {
      if (errSessao) {
        console.error('Erro ao trocar a sessão no login:', errSessao);
        // Mesma decisão do catch abaixo: o erro aparece na própria tela de login
        return res.render('autenticacao/login', {
          title: 'Login - Bioma Pet',
          erro: 'Erro interno no servidor.',
          sucesso: null,
          cadastrado: false
        });
      }

      req.session.usuario = {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        permissoes: usuario.permissoes
      };

      // Troca de senha obrigatória (BL-09)
      res.redirect(usuario.deve_trocar_senha ? '/trocar-senha' : '/dashboard');
    });
  } catch (err) {
    console.error('Erro no login:', err);
    // Decisão consciente: o erro aparece na própria tela de login, e não na página de erro
    res.render('autenticacao/login', {
      title: 'Login - Bioma Pet',
      erro: 'Erro interno no servidor.',
      sucesso: null,
      cadastrado: false
    });
  }
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

router.get('/esqueci-senha', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.render('autenticacao/esqueci-senha', {
    title: 'Esqueci minha senha',
    erro: null,
    sucesso: null
  });
});

router.post('/esqueci-senha', limiteEsqueciSenha, asyncHandler(async (req, res) => {
  const { email } = req.body;

  const renderView = (erro, sucesso) =>
    res.render('autenticacao/esqueci-senha', {
      title: 'Esqueci minha senha',
      erro, sucesso
    });

  if (!email || !email.trim()) {
    return renderView('Informe o e-mail.', null);
  }

  try {
    const usuario = await dbGet('SELECT id FROM usuarios WHERE email = ?', [email.trim()]);

    if (usuario) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = Date.now() + 60 * 60 * 1000; // 1 hora
      await dbRun(
        'UPDATE usuarios SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
        [token, expiry, usuario.id]
      );
    }
  } catch (err) {
    // Só loga, de propósito: uma resposta de erro aqui poderia revelar se o e-mail
    // existe, já que o UPDATE só roda para e-mail cadastrado
    console.error('Erro ao gerar reset de senha:', err);
  }

  // O envio de e-mail ainda não existe (DT-10). A mensagem é a mesma para e-mail
  // cadastrado ou não, para não revelar quais e-mails existem no sistema.
  return renderView(null, 'Solicitação registrada. A recuperação por e-mail ainda não está disponível: peça ao administrador para redefinir sua senha.');
}));

router.get('/redefinir-senha/:token', asyncHandler(async (req, res, next) => {
  try {
    const usuario = await dbGet(
      'SELECT id FROM usuarios WHERE reset_token = ? AND reset_token_expiry > ?',
      [req.params.token, Date.now()]
    );

    if (!usuario) {
      return res.render('autenticacao/redefinir-senha', {
        title: 'Redefinir Senha',
        token: null,
        erro: 'Link inválido ou expirado. Solicite um novo link.',
        sucesso: null
      });
    }

    res.render('autenticacao/redefinir-senha', {
      title: 'Redefinir Senha',
      token: req.params.token,
      erro: null,
      sucesso: null
    });
  } catch (err) {
    next(err);
  }
}));

router.post('/redefinir-senha/:token', asyncHandler(async (req, res) => {
  const { nova_senha, confirmar_senha } = req.body;

  const renderView = (erro, sucesso) =>
    res.render('autenticacao/redefinir-senha', {
      title: 'Redefinir Senha',
      token: req.params.token,
      erro, sucesso
    });

  if (!nova_senha || nova_senha.length < 6) {
    return renderView('A senha deve ter no mínimo 6 caracteres.', null);
  }

  if (nova_senha !== confirmar_senha) {
    return renderView('As senhas não conferem.', null);
  }

  try {
    const usuario = await dbGet(
      'SELECT id FROM usuarios WHERE reset_token = ? AND reset_token_expiry > ?',
      [req.params.token, Date.now()]
    );

    if (!usuario) {
      return renderView('Link inválido ou expirado. Solicite um novo link.', null);
    }

    const hash = await bcrypt.hash(nova_senha, 10);
    await dbRun(
      'UPDATE usuarios SET senha = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hash, usuario.id]
    );

    res.render('autenticacao/redefinir-senha', {
      title: 'Redefinir Senha',
      token: null,
      erro: null,
      sucesso: 'Senha redefinida com sucesso! Você já pode fazer login.'
    });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    // Decisão consciente: o erro volta no próprio formulário, e não na página de erro
    return renderView('Erro interno. Tente novamente.', null);
  }
}));

// Troca de senha obrigatória (BL-09): usada quando usuarios.deve_trocar_senha = 1
router.get('/trocar-senha', verificarAutenticacao, (req, res) => {
  res.render('autenticacao/trocar-senha', {
    title: 'Trocar senha - Bioma Pet',
    erro: null,
    sucesso: null
  });
});

router.post('/trocar-senha', verificarAutenticacao, asyncHandler(async (req, res) => {
  const { nova_senha, confirmar_senha } = req.body;

  const renderView = (status, erro, sucesso) =>
    res.status(status).render('autenticacao/trocar-senha', {
      title: 'Trocar senha - Bioma Pet',
      erro, sucesso
    });

  if (!nova_senha || nova_senha.length < 6) {
    return renderView(400, 'A senha deve ter no mínimo 6 caracteres.', null);
  }
  if (nova_senha !== confirmar_senha) {
    return renderView(400, 'As senhas não conferem.', null);
  }

  try {
    const usuario = await dbGet('SELECT senha FROM usuarios WHERE id = ?', [req.session.usuario.id]);
    if (await bcrypt.compare(nova_senha, usuario.senha)) {
      return renderView(400, 'A nova senha deve ser diferente da atual.', null);
    }

    const hash = await bcrypt.hash(nova_senha, 10);
    await dbRun(
      'UPDATE usuarios SET senha = ?, deve_trocar_senha = 0 WHERE id = ?',
      [hash, req.session.usuario.id]
    );
    return renderView(200, null, 'Senha alterada com sucesso!');
  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    // Decisão consciente: o erro volta no próprio formulário, e não na página de erro
    return renderView(500, 'Erro interno. Tente novamente.', null);
  }
}));

router.get('/cadastro', (req, res) => res.redirect('/login'));
router.post('/cadastro', (req, res) => res.redirect('/login'));


module.exports = router;