# Handoff

Documento de passagem do BiomaPetShop. Objetivo: quem nunca viu este repositório
consegue rodar, entender e continuar o trabalho sem precisar perguntar.

**Última atualização:** 17/09/2026 · **Branch atual:** `chore/devops-setup`

---

## 1. O que é

Sistema web de gestão para pet shop: clientes, pets, serviços com preço por porte,
agendamentos e um dashboard consolidado. Aplicação monolítica em Node.js/Express com
renderização no servidor (EJS) e banco SQLite em arquivo.

Projeto acadêmico da disciplina de Manutenção e Melhoria de Software. Repositório de
origem: `RafaelBandoch/BiomaPetShop-MM`.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js (>= 20; `.nvmrc` fixa a 22) |
| Framework | Express 4 |
| Views | EJS (SSR), Bootstrap 5 via CDN |
| Banco | SQLite 3 (arquivo local) |
| Sessão | `express-session` + `connect-sqlite3` |
| Senhas | bcrypt (custo 10) |
| Testes | Jest |
| Container | Dockerfile multi-stage (node:22-slim) |
| CI | GitHub Actions — `npm ci` + `npm test` em push/PR na `main` |

---

## 3. Como rodar

### Local

```bash
nvm use                 # lê o .nvmrc (Node 22)
npm install
cp .env.example .env
# edite o .env: gere um SESSION_SECRET real
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run dev             # ou npm start
```

Acesse `http://localhost:3000`.

> ⚠️ **A aplicação não inicia sem `SESSION_SECRET`.** É proposital — sem segredo não há
> sessão confiável, então o boot falha em vez de assinar cookies com valor previsível.

O banco é criado automaticamente no primeiro boot (`database/init.js` é importado pelo
`app.js`). **Mas leia a seção 7 antes de criar um banco do zero.**

### Credenciais semeadas

```
admin@biomapet.com / 123456   (perfil: administrador)
```

Trocar isso é pré-requisito para qualquer ambiente que não seja a sua máquina.

### Docker

```bash
docker build -t biomapet .
docker run -p 3000:3000 \
  -e SESSION_SECRET=<valor> \
  -v biomapet-data:/app/database \
  biomapet
```

O volume em `/app/database` não é opcional: sem ele, o SQLite some a cada recriação do
container.

### Testes

```bash
npm test          # 26 testes, todos em testes/validacoes.test.js
```

---

## 4. Estrutura real do projeto

```
bioma-manutencao/
├── app.js                  # entrada; sessão, middlewares, dashboard e DELETE /usuarios
├── database/
│   ├── db.js               # conexão SQLite + PRAGMA foreign_keys
│   ├── db-promise.js       # dbGet/dbAll/dbRun/dbTransaction (wrappers em Promise)
│   └── init.js             # DDL + seed de serviços e do usuário admin
├── routes/                 # roteamento + validação + SQL (não há controllers/models)
│   ├── autenticacao.routes.js
│   ├── clientes.routes.js
│   ├── pets.routes.js
│   ├── servicos.routes.js
│   ├── agendamentos.routes.js
│   └── funcionarios.routes.js
├── middlewares/autenticacao.js   # verificarAutenticacao, verificarAdmin
├── utils/helpers.js              # capitalize, regex, cálculo de valores, RN04
├── views/                        # EJS por domínio + partials/sidebar
├── public/css/                   # dashboard.css, login.css, pages.css
├── testes/validacoes.test.js
└── docs/                         # esta documentação
```

Observe que **não existem as pastas `src/`, `controllers/` e `models/`** que o README
descrevia até esta rodada. A lógica de negócio mora nos arquivos de rota. É uma
divergência conhecida: [DT-07](debitos-tecnicos.md#dt-07--não-existe-camada-de-model-nem-controller).

---

## 5. Mapa de rotas

Todas as rotas abaixo, exceto as de autenticação, exigem sessão ativa
(`verificarAutenticacao`).

### Autenticação — [routes/autenticacao.routes.js](../routes/autenticacao.routes.js)
| Método | Rota | Nota |
|---|---|---|
| GET / POST | `/login` | Bloqueia login de funcionário com `ativo = 0` |
| GET | `/logout` | Destrói a sessão |
| GET / POST | `/esqueci-senha` | Gera token — **mas não envia e-mail** ([DT-10](debitos-tecnicos.md#dt-10--recuperação-de-senha-não-envia-e-mail)) |
| GET / POST | `/redefinir-senha/:token` | Token válido por 1 hora |
| GET / POST | `/cadastro` | Só redireciona para `/login` — auto-cadastro desativado |

### Núcleo — [app.js](../app.js)
| Método | Rota | Nota |
|---|---|---|
| GET | `/` | Redireciona para `/login` |
| GET | `/dashboard` | Contadores + listagens recentes; `Cache-Control: no-store` |
| DELETE | `/usuarios/:id` | Admin conferido por e-mail hardcoded ([DT-09](debitos-tecnicos.md#dt-09--verificação-de-admin-por-e-mail-hardcoded)) |

### Clientes — [routes/clientes.routes.js](../routes/clientes.routes.js)
`GET /clientes` · `POST /clientes` · `PUT /clientes/:id` ·
`GET /clientes/:id/pets` (JSON) · `DELETE /clientes/:id` (cascata manual em transação)

### Pets — [routes/pets.routes.js](../routes/pets.routes.js)
`GET /pets` · `POST /pets` · `PUT /pets/:id` · `DELETE /pets/:id` (cascata manual)

### Serviços — [routes/servicos.routes.js](../routes/servicos.routes.js)
`GET /servicos` · `PUT /servicos/:id` (só atualiza os três preços)

### Agendamentos — [routes/agendamentos.routes.js](../routes/agendamentos.routes.js)
| Método | Rota | Nota |
|---|---|---|
| GET | `/agendamentos` | Paginado, 20 por página |
| GET / POST | `/agendamentos/novo`, `/agendamentos` | Aplica RN02, RN03 e RN04 |
| GET | `/agendamentos/calendario-dados` | JSON para a visão de calendário |
| GET / POST | `/agendamentos/:id/editar` | Recria os vínculos de serviço em transação |
| POST | `/agendamentos/:id/concluir` | `status = 'concluido'` |
| DELETE | `/agendamentos/:id` | Remove vínculos e o agendamento |

### Funcionários — [routes/funcionarios.routes.js](../routes/funcionarios.routes.js)
Todas exigem `verificarAdmin` além da sessão.
`GET /funcionarios` · `POST /funcionarios` (cria `usuarios` + `funcionarios` em transação) ·
`PUT /funcionarios/:id` · `GET /funcionarios/:id/agendamentos` (JSON) ·
`DELETE /funcionarios/:id` (desvincula agendamentos antes de excluir)

---

## 6. Decisões de projeto que valem conhecer

**`funcionarios` e `usuarios` são tabelas separadas.** `usuarios` guarda o acesso
(e-mail, hash, perfil); `funcionarios` guarda o operacional (telefone, ativo) e aponta
para o usuário por `usuario_id`. Criar um funcionário grava nas duas, em transação.
Desativar (`ativo = 0`) bloqueia o login sem apagar o histórico.

**Preço é definido pelo porte do pet.** Cada serviço tem três preços
(`preco_pequeno`/`medio`/`grande`) e `calcularValores()` escolhe pelo `porte`. Porte
desconhecido cai em `preco_medio` silenciosamente.

**O valor do serviço é congelado no agendamento.** `agendamento_servicos.valor` guarda o
preço vigente no momento. Mudar o preço do serviço não reescreve o histórico — isso é
intencional.

**Um agendamento tem N serviços.** A coluna `agendamentos.servico_id` é legado da versão
1:1 e não é mais usada; o vínculo real está em `agendamento_servicos`.

**Exclusão em cascata é feita em código, não pelo banco.** Sempre dentro de
`dbTransaction()`, na ordem `agendamento_servicos` → `agendamentos` → `pets` → `clientes`.
Ver [DER §4](DER.md#4-integridade-referencial).

**As sessões ficam em um SQLite separado** (`database/sessions.sqlite`), com cookie
`httpOnly`, `sameSite: 'lax'` e validade de 2 horas.

---

## 7. Armadilhas — leia antes de mexer

1. **Banco novo nasce quebrado.** `database/init.js` executa `ALTER TABLE funcionarios`
   antes do `CREATE TABLE funcionarios`, e engole o erro. Em instalação limpa, a tabela
   sai sem `usuario_id`, e o login falha para todo mundo com "Erro interno no servidor".
   Quem já tem um `biomapet.sqlite` antigo não percebe. **Este é o primeiro item a
   corrigir** — detalhes e evidência em
   [DT-02](debitos-tecnicos.md#dt-02--alter-table-antes-do-create-table-quebra-banco-novo).

2. **As senhas estão em texto puro no banco.** A coluna `usuarios.senha_texto` alimenta
   um botão "ver senha" no painel admin. Trate qualquer cópia do `.sqlite` como material
   sensível e não envie o arquivo por canal aberto ([DT-01](debitos-tecnicos.md#dt-01--senha-em-texto-puro-no-banco-senha_texto)).

3. **Erro vira tela vazia.** Quase todo `catch` renderiza a página com listas vazias e
   contadores zerados. Se o dashboard aparecer zerado, olhe o log do servidor antes de
   concluir que não há dados ([DT-08](debitos-tecnicos.md#dt-08--erros-engolidos-falha-vira-tela-vazia)).

4. **Duas views são código morto.** `views/emails/index.ejs` e
   `views/autenticacao/cadastro.ejs` não são renderizadas por rota nenhuma. A primeira é
   quase idêntica a `views/funcionarios/index.ejs` — é fácil corrigir o arquivo errado
   ([DT-18](debitos-tecnicos.md#dt-18--colunas-e-tela-mortas)).

5. **O CI só roda testes de função pura.** Verde no GitHub Actions não diz nada sobre as
   rotas — inclusive não pegou o item 1 desta lista
   ([DT-15](debitos-tecnicos.md#dt-15--testes-cobrem-só-utilshelpersjs)).

6. **Os arquivos `.sqlite` são gitignored.** Não existe dump nem seed de demonstração no
   repositório: cada ambiente parte do zero, o que torna o item 1 ainda mais crítico.

---

## 8. Estado atual

**Funcionando:** autenticação com sessão e proteção de rotas; CRUD de clientes, pets e
funcionários; edição de preços de serviços; criação, edição, conclusão e exclusão de
agendamentos com as regras RN02, RN03 e RN04; dashboard com consolidados; Dockerfile e
CI configurados.

**Parcial ou ausente:** recuperação de senha (gera token, não envia e-mail); observações
no cadastro de pet (RF08, nunca implementado); campo de desconto (existe no banco, sempre
zero); auto-cadastro de usuário (view existe, rota desativada).

**Em andamento nesta branch (`chore/devops-setup`):** os últimos commits configuraram
`.env.example`, `.nvmrc`, `Dockerfile`, `.dockerignore` e o workflow de CI. Esta
documentação (`docs/`) entra na mesma linha de trabalho. A branch ainda não foi
integrada à `main`.

---

## 9. Por onde continuar

A ordem completa e justificada está em
[debitos-tecnicos.md § Ordem sugerida de ataque](debitos-tecnicos.md#ordem-sugerida-de-ataque).
Resumo dos três primeiros passos:

1. **Corrigir o DT-02.** Reordenar o `init.js` e validar contra um SQLite vazio. Sem
   isso, nenhum ambiente novo sobe — e todo onboarding trava aqui.
2. **Eliminar o `senha_texto` (DT-01)** e substituir o "ver senha" por "redefinir senha".
   Exige conversar com o cliente sobre a RN06, que é a origem do problema.
3. **Cobrir as rotas com testes de integração (DT-15)** antes de qualquer refatoração
   estrutural — é a rede de proteção para atacar DT-07, DT-14 e DT-06 com segurança.

Há duas decisões que **dependem do cliente** e não podem ser resolvidas só no código:
- Qual é a regra real de capacidade por horário ([DT-11](debitos-tecnicos.md#dt-11--rn02-implementada-diferente-do-especificado)).
- Se a RN06 (admin vê senha) continua valendo ([DT-01](debitos-tecnicos.md#dt-01--senha-em-texto-puro-no-banco-senha_texto)).

Vale levantá-las antes de planejar a próxima sprint.

---

## 10. Onde encontrar o resto

| Documento | Conteúdo |
|---|---|
| [README.md](../README.md) | Visão geral, requisitos (RF/RNF), regras de negócio, execução |
| [docs/DER.md](DER.md) | Modelo de dados, entidades, relacionamentos, integridade |
| [docs/debitos-tecnicos.md](debitos-tecnicos.md) | 20 débitos catalogados com severidade e correção |
