const bcrypt = require('bcrypt');
const { app, request, EMAIL_ADMIN, prepararBanco, limparBanco, enviarLogin, login, fecharBanco } = require('../helpers/app');
const { inserirCliente, inserirPet, inserirFuncionario, inserirAgendamento } = require('../helpers/dados');
const { dbGet, dbAll } = require('../../database/db-promise');

// Nos erros, as rotas JSON respondem { ok: false, erro } com o status HTTP do
// caso (BL-12): 400 para campo obrigatório faltando ou senha curta, 409 para
// email duplicado e 403 ao tentar excluir o admin.
// O :id das rotas é o id do usuário (usuarios.id), não o da tabela funcionarios.

let agente;

beforeAll(async () => {
  await prepararBanco();
  agente = await login();
});
beforeEach(limparBanco);
afterAll(fecharBanco);

const novoFuncionario = {
  nome: 'ana costa',
  telefone: '(11) 97777-6666',
  email: 'ana@biomapet.com',
  senha: 'senha123'
};

// Mesmo corpo que o formulário de edição envia
function dadosEdicao(funcionario, campos = {}) {
  return { nome: funcionario.nome, telefone: funcionario.telefone, ativo: 1, nova_senha: null, ...campos };
}

// Login de um navegador sem sessão, com o token anti-CSRF da tela de login (BL-10)
function postLogin(email, senha) {
  return enviarLogin(request.agent(app), email, senha);
}

describe('POST /funcionarios', () => {
  test('cria a linha em usuarios e a linha vinculada em funcionarios', async () => {
    const res = await agente.post('/funcionarios').send(novoFuncionario);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const usuario = await dbGet('SELECT id, nome, email, senha, permissoes FROM usuarios WHERE email = ?', [novoFuncionario.email]);
    expect(usuario).toMatchObject({ nome: 'Ana Costa', email: 'ana@biomapet.com', permissoes: 'funcionario' });
    expect(usuario.senha).not.toBe(novoFuncionario.senha);
    expect(await bcrypt.compare(novoFuncionario.senha, usuario.senha)).toBe(true);

    const funcionario = await dbGet('SELECT nome, telefone, email, ativo, usuario_id FROM funcionarios WHERE usuario_id = ?', [usuario.id]);
    expect(funcionario).toEqual({
      nome: 'Ana Costa',
      telefone: '(11) 97777-6666',
      email: 'ana@biomapet.com',
      ativo: 1,
      usuario_id: usuario.id
    });

    // Falha com mensagem clara se o funcionário criado não conseguir entrar
    await login(novoFuncionario.email, novoFuncionario.senha);
  });

  test('recusa email de outro funcionário', async () => {
    await inserirFuncionario({ email: novoFuncionario.email });

    const res = await agente.post('/funcionarios').send(novoFuncionario);
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('email_duplicado');
    expect(await dbAll('SELECT id FROM usuarios WHERE email = ?', [novoFuncionario.email])).toHaveLength(1);
  });

  test('recusa o email do admin', async () => {
    const res = await agente.post('/funcionarios').send({ ...novoFuncionario, email: EMAIL_ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('email_duplicado');
    expect(await dbAll('SELECT id FROM usuarios WHERE email = ?', [EMAIL_ADMIN])).toHaveLength(1);
  });

  test.each([
    ['sem nome', { nome: ' ' }, 'nome_obrigatorio'],
    ['sem email', { email: '' }, 'email_obrigatorio'],
    ['com senha de menos de 6 caracteres', { senha: '12345' }, 'senha_curta']
  ])('recusa cadastro %s', async (_, campos, erro) => {
    const res = await agente.post('/funcionarios').send({ ...novoFuncionario, ...campos });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe(erro);
    expect(await dbAll('SELECT id FROM funcionarios')).toEqual([]);
  });
});

describe('PUT /funcionarios/:id', () => {
  test('edita nome e telefone em usuarios e em funcionarios', async () => {
    const funcionario = await inserirFuncionario();

    const res = await agente
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send(dadosEdicao(funcionario, { nome: 'bruno alves', telefone: '(11) 95555-4444' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const usuario = await dbGet('SELECT nome FROM usuarios WHERE id = ?', [funcionario.usuarioId]);
    expect(usuario.nome).toBe('Bruno Alves');
    const linha = await dbGet('SELECT nome, telefone, ativo FROM funcionarios WHERE usuario_id = ?', [funcionario.usuarioId]);
    expect(linha).toEqual({ nome: 'Bruno Alves', telefone: '(11) 95555-4444', ativo: 1 });
  });

  test('desativa o funcionário, que passa a receber "Usuário Inativo." no login', async () => {
    const funcionario = await inserirFuncionario();

    const res = await agente
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send(dadosEdicao(funcionario, { ativo: 0 }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const linha = await dbGet('SELECT ativo FROM funcionarios WHERE usuario_id = ?', [funcionario.usuarioId]);
    expect(linha.ativo).toBe(0);

    const tentativa = await postLogin(funcionario.email, funcionario.senha);
    expect(tentativa.status).toBe(200);
    expect(tentativa.text).toContain('Usuário Inativo.');
  });

  test('redefine a senha: entra com a nova e não com a antiga', async () => {
    const funcionario = await inserirFuncionario({ senha: 'senha-antiga' });

    const res = await agente
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send(dadosEdicao(funcionario, { nova_senha: 'senha-nova-456' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    await login(funcionario.email, 'senha-nova-456');

    const antiga = await postLogin(funcionario.email, 'senha-antiga');
    expect(antiga.status).toBe(401);
  });

  // Comportamento atual: a nova_senha curta é ignorada sem aviso e a resposta é
  // { ok: true }, então o admin acha que trocou a senha. Vira demanda nova.
  test('ignora nova_senha com menos de 6 caracteres e ainda responde ok', async () => {
    const funcionario = await inserirFuncionario({ senha: 'senha-antiga' });

    const res = await agente
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send(dadosEdicao(funcionario, { nova_senha: '12345' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const usuario = await dbGet('SELECT senha FROM usuarios WHERE id = ?', [funcionario.usuarioId]);
    expect(await bcrypt.compare('senha-antiga', usuario.senha)).toBe(true);
  });

  test('recusa nome vazio', async () => {
    const funcionario = await inserirFuncionario();

    const res = await agente
      .put(`/funcionarios/${funcionario.usuarioId}`)
      .send(dadosEdicao(funcionario, { nome: '' }));
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('nome_obrigatorio');
  });
});

describe('DELETE /funcionarios/:id', () => {
  test('exclui a linha em usuarios e em funcionarios', async () => {
    const funcionario = await inserirFuncionario();

    const res = await agente.delete(`/funcionarios/${funcionario.usuarioId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await dbGet('SELECT id FROM usuarios WHERE id = ?', [funcionario.usuarioId])).toBeUndefined();
    expect(await dbGet('SELECT id FROM funcionarios WHERE id = ?', [funcionario.funcionarioId])).toBeUndefined();
  });

  test('mantém os agendamentos do funcionário excluído, sem o vínculo', async () => {
    const funcionario = await inserirFuncionario();
    const cliente = await inserirCliente();
    const pet = await inserirPet(cliente.id);
    const agendamento = await inserirAgendamento({
      clienteId: cliente.id,
      petId: pet.id,
      funcionarioId: funcionario.funcionarioId
    });

    const res = await agente.delete(`/funcionarios/${funcionario.usuarioId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const linha = await dbGet('SELECT funcionario_id FROM agendamentos WHERE id = ?', [agendamento.id]);
    expect(linha).toEqual({ funcionario_id: null });
  });

  test('não exclui o admin semeado', async () => {
    const admin = await dbGet('SELECT id FROM usuarios WHERE email = ?', [EMAIL_ADMIN]);

    const res = await agente.delete(`/funcionarios/${admin.id}`);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.erro).toBe('nao_pode_excluir_admin');
    expect(await dbGet('SELECT id FROM usuarios WHERE email = ?', [EMAIL_ADMIN])).toEqual({ id: admin.id });
  });
});
