const bcrypt = require('bcrypt');

// Usuário admin inicial. Só é criado se ainda não existir; um admin que já existe não
// é alterado. Devolve true quando cria.
async function semearAdmin({ get, run }) {
  const admin = await get('SELECT id FROM usuarios WHERE email = ?', ['admin@biomapet.com']);
  if (admin) return false;

  const senhaInicial = process.env.ADMIN_INITIAL_PASSWORD;
  if (!senhaInicial && process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_INITIAL_PASSWORD não definida. Defina a senha inicial do admin no ambiente.');
  }
  if (!senhaInicial) {
    console.warn('ADMIN_INITIAL_PASSWORD não definida: admin criado com a senha padrão 123456 (só para desenvolvimento).');
  }
  const senhaHash = await bcrypt.hash(senhaInicial || '123456', 10);
  // deve_trocar_senha = 1: o admin precisa escolher uma senha nova no primeiro login
  await run(
    'INSERT INTO usuarios (nome, email, senha, permissoes, deve_trocar_senha) VALUES (?, ?, ?, ?, 1)',
    ['Administrador', 'admin@biomapet.com', senhaHash, 'administrador']
  );
  return true;
}

module.exports = semearAdmin;
