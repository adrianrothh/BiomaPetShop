require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { dbGet, dbAll, dbRun } = require('./database/db-promise');
require('./database/init');

const autenticacaoRoutes = require('./routes/autenticacao.routes');
const clientesRoutes = require('./routes/clientes.routes');
const petsRoutes = require('./routes/pets.routes');
const servicosRoutes = require('./routes/servicos.routes');
const agendamentosRoutes = require('./routes/agendamentos.routes');
const funcionariosRoutes = require('./routes/funcionarios.routes');
const { verificarAutenticacao } = require('./middlewares/autenticacao');

const app = express();
const PORT = process.env.PORT || 3000;

// Sem segredo nao ha sessao confiavel: falha no boot em vez de assinar
// os cookies com um valor previsivel.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error(
    'SESSION_SECRET nao definida. Copie o .env.example para .env e defina um valor ' +
    'aleatorio antes de iniciar o servidor.'
  );
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: './database'
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 2, // 2 horas
      httpOnly: true,   // bloqueia acesso ao cookie via JavaScript
      sameSite: 'lax'  // proteção básica contra CSRF
    }
  })
);

// Torna `usuario` disponível em todos os templates EJS sem precisar passar em cada res.render
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  next();
});

app.use('/', autenticacaoRoutes);
app.use('/', clientesRoutes);
app.use('/', petsRoutes);
app.use('/', servicosRoutes);
app.use('/', agendamentosRoutes);
app.use('/', funcionariosRoutes);

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.delete('/usuarios/:id', verificarAutenticacao, async (req, res) => {
  if (!req.session.usuario || req.session.usuario.email !== 'admin@biomapet.com') {
    return res.json({ ok: false, erro: 'sem_permissao' });
  }
  try {
    const row = await dbGet('SELECT email FROM usuarios WHERE id = ?', [req.params.id]);
    if (row && row.email === 'admin@biomapet.com') {
      return res.json({ ok: false, erro: 'nao_pode_excluir_admin' });
    }
    await dbRun('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

app.get('/dashboard', verificarAutenticacao, async (req, res) => {
  res.set('Cache-Control', 'no-store'); // impede que o browser exiba o dashboard após logout pelo botão voltar
  try {
    const [
      totalClientesRow,
      totalPetsRow,
      totalServicosRow,
      ultimosClientes,
      agendamentos,
      ultimosPets,
      ultimosFuncionarios
    ] = await Promise.all([
      dbGet('SELECT COUNT(*) AS total FROM clientes'),
      dbGet('SELECT COUNT(*) AS total FROM pets'),
      dbGet('SELECT COUNT(*) AS total FROM servicos'),
      dbAll('SELECT nome, criado_em FROM clientes ORDER BY criado_em DESC'),
      dbAll(`
        SELECT a.id, a.data_hora, a.status,
               p.nome AS pet_nome,
               GROUP_CONCAT(s.nome, ', ') AS servico_nome
        FROM agendamentos a
        LEFT JOIN pets p ON a.pet_id = p.id
        LEFT JOIN agendamento_servicos ag_s ON ag_s.agendamento_id = a.id
        LEFT JOIN servicos s ON s.id = ag_s.servico_id
        WHERE a.status != 'cancelado'
        GROUP BY a.id
        ORDER BY a.data_hora ASC
      `),
      dbAll(`
        SELECT p.nome, p.especie, p.raca, c.nome AS cliente_nome
        FROM pets p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        ORDER BY p.id DESC
      `),
      dbAll(`
        SELECT u.nome, u.email, f.telefone, f.ativo
        FROM usuarios u
        LEFT JOIN funcionarios f ON f.usuario_id = u.id
        ORDER BY u.nome ASC
      `)
    ]);

    const dataAtual = new Date();
    // toISOString() retorna UTC — monta manualmente para não errar o dia no fuso horário local
    const hoje = dataAtual.getFullYear() + '-' + String(dataAtual.getMonth() + 1).padStart(2, '0') + '-' + String(dataAtual.getDate()).padStart(2, '0');
    const totalHoje = (agendamentos || []).filter(a => a.data_hora && a.data_hora.startsWith(hoje)).length;

    res.render('dashboard/dashboard', {
      usuario: req.session.usuario,
      paginaAtiva: 'dashboard',
      totalClientes: totalClientesRow ? totalClientesRow.total : 0,
      totalPets: totalPetsRow ? totalPetsRow.total : 0,
      totalServicos: totalServicosRow ? totalServicosRow.total : 0,
      ultimosClientes: ultimosClientes || [],
      agendamentos: agendamentos || [],
      ultimosPets: ultimosPets || [],
      ultimosFuncionarios: ultimosFuncionarios || [],
      totalHoje
    });
  } catch (err) {
    console.error('Erro no dashboard:', err);
    res.render('dashboard/dashboard', {
      usuario: req.session.usuario,
      paginaAtiva: 'dashboard',
      totalClientes: 0, totalPets: 0, totalServicos: 0,
      ultimosClientes: [], agendamentos: [], ultimosPets: [],
      ultimosFuncionarios: [], totalHoje: 0
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});


