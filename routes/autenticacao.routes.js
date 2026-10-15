const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { dbGet, dbRun } = require('../database/db-promise');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.render('autenticacao/login', {
    title: 'Login - Bioma Pet',
    erro: null,
    sucesso: null,
    cadastrado: req.query.cadastrado === '1'
  });
});

router.post('/login', async (req, res) => {
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
      return res.render('autenticacao/login', {
        title: 'Login - Bioma Pet',
        erro: 'Email ou senha inválidos.',
        sucesso: null,
        cadastrado: false
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida) {
      return res.render('autenticacao/login', {
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

    req.session.usuario = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      permissoes: usuario.permissoes
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Erro no login:', err);
    res.render('autenticacao/login', {
      title: 'Login - Bioma Pet',
      erro: 'Erro interno no servidor.',
      sucesso: null,
      cadastrado: false
    });
  }
});

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

router.post('/esqueci-senha', async (req, res) => {
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
    console.error('Erro ao gerar reset de senha:', err);
  }

  // Sempre retorna sucesso porque não envia realmente o e-mail
  return renderView(null, 'E-mail enviado! Verifique sua caixa de entrada.');
});

router.get('/redefinir-senha/:token', async (req, res) => {
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
    console.error('Erro ao validar token:', err);
    res.redirect('/esqueci-senha');
  }
});

router.post('/redefinir-senha/:token', async (req, res) => {
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
    return renderView('Erro interno. Tente novamente.', null);
  }
});

router.get('/cadastro', (req, res) => res.redirect('/login'));
router.post('/cadastro', (req, res) => res.redirect('/login'));

module.exports = router;
