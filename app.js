require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const { dbGet } = require('./database/db-promise');

const autenticacaoRoutes = require('./routes/autenticacao.routes');
const clientesRoutes = require('./routes/clientes.routes');
const petsRoutes = require('./routes/pets.routes');
const servicosRoutes = require('./routes/servicos.routes');
const agendamentosRoutes = require('./routes/agendamentos.routes');
const funcionariosRoutes = require('./routes/funcionarios.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const { naoEncontrado, tratarErro } = require('./middlewares/erros');
const { tokenCsrf, protecaoCsrf } = require('./middlewares/csrf');

const app = express();
const emProducao = process.env.NODE_ENV === 'production';

// Quantos proxies confiáveis ficam à frente do app (no Render, 1). Com 0, o
// X-Forwarded-For é ignorado e req.ip é o IP da própria conexão.
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);

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

// Layouts compartilhados (BL-14): a view traz só o conteúdo do <body> e o layout monta
// o documento. Os <style> e <script> da view vão para o fim do <head> e do <body>.
// As telas de autenticação e a página de erro usam o layouts/autenticacao.
app.set('layout', 'layouts/principal');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);
app.use(expressLayouts);

// Headers de segurança com os padrões do helmet. A CSP só libera o que as views
// usam hoje: Bootstrap do jsDelivr, <script> inline e onclick/onchange.
// TODO: endurecer a CSP (tirar o 'unsafe-inline') depois do BL-14.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        // Em http local o navegador tentaria buscar os recursos por https.
        upgradeInsecureRequests: emProducao ? [] : null
      }
    }
  })
);

// Health check para o Render e o HEALTHCHECK do Docker. Fica antes da sessão: não cria
// sessão nem cookie a cada verificação e não passa pelo login nem pelo CSRF.
// Consulta uma tabela do schema, e não só SELECT 1, para acusar também banco sem schema.
app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await dbGet('SELECT 1 FROM usuarios LIMIT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Health check falhou:', err);
    res.status(503).json({ status: 'erro' });
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Em teste não passa store: o express-session usa a MemoryStore padrão e
// nenhum sessions.sqlite é criado no disco.
const sessionStore = process.env.NODE_ENV === 'test'
  ? undefined
  : new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, 'database')
  });

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 2, // 2 horas
      httpOnly: true,   // bloqueia acesso ao cookie via JavaScript
      sameSite: 'lax',  // proteção básica contra CSRF
      // Só trafega por HTTPS em produção. Atrás de proxy exige TRUST_PROXY: sem ele
      // o express-session não envia o cookie e o login não se mantém.
      secure: emProducao
    }
  })
);

// Torna `usuario` disponível em todos os templates EJS sem precisar passar em cada res.render.
// O csrfToken (BL-10) é uma função para que o token, e com ele a sessão de quem não está
// logado, só seja criado nas telas que usam o token.
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.csrfToken = () => tokenCsrf(req);
  next();
});

// Proteção contra CSRF (BL-10). Fica antes das rotas e, portanto, antes do limite de
// login: um POST /login sem token recebe 403 e não conta como tentativa.
app.use(protecaoCsrf);

app.use('/', autenticacaoRoutes);
app.use('/', clientesRoutes);
app.use('/', petsRoutes);
app.use('/', servicosRoutes);
app.use('/', agendamentosRoutes);
app.use('/', funcionariosRoutes);
app.use('/', dashboardRoutes);

app.get('/', (req, res) => {
  res.redirect('/login');
});

// Tratamento de erro centralizado (BL-11): fica depois de todas as rotas
app.use(naoEncontrado);
app.use(tratarErro);

module.exports = app;