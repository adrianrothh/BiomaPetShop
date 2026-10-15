# Débitos Técnicos

Inventário dos pontos que travam ou encarecem a manutenção do BiomaPetShop.
Cada item traz o que é, onde está, por que importa e o que fazer.

**Legenda de severidade**
| | Significado |
|---|---|
| 🔴 Crítico | Quebra o sistema ou expõe dados; resolver antes de qualquer feature nova |
| 🟠 Alto | Gera bug recorrente ou retrabalho a cada mudança |
| 🟡 Médio | Atrito de manutenção; resolver quando tocar na área |
| ⚪ Baixo | Limpeza; sem impacto funcional |

## Índice

| ID | Título | Severidade | Área |
|---|---|---|---|
| [DT-02](#dt-02--alter-table-antes-do-create-table-quebra-banco-novo) | `ALTER TABLE` antes do `CREATE TABLE` quebra banco novo | 🔴 Crítico | Banco |
| [DT-01](#dt-01--senha-em-texto-puro-no-banco-senha_texto) | Senha em texto puro no banco (`senha_texto`) | 🔴 Crítico | Segurança |
| [DT-03](#dt-03--sem-proteção-contra-csrf) | Sem proteção contra CSRF | 🟠 Alto | Segurança |
| [DT-04](#dt-04--sem-rate-limit-no-login-dependência-instalada-e-não-usada) | Sem rate limit no login | 🟠 Alto | Segurança |
| [DT-09](#dt-09--verificação-de-admin-por-e-mail-hardcoded) | Verificação de admin por e-mail hardcoded | 🟠 Alto | Segurança |
| [DT-07](#dt-07--não-existe-camada-de-model-nem-controller) | Não existe camada de model nem controller | 🟠 Alto | Arquitetura |
| [DT-08](#dt-08--erros-engolidos-falha-vira-tela-vazia) | Erros engolidos: falha vira tela vazia | 🟠 Alto | Confiabilidade |
| [DT-06](#dt-06--cascata-de-exclusão-vive-no-código-não-no-schema) | Cascata de exclusão vive no código, não no schema | 🟠 Alto | Banco |
| [DT-10](#dt-10--recuperação-de-senha-não-envia-e-mail) | Recuperação de senha não envia e-mail | 🟠 Alto | Funcional |
| [DT-11](#dt-11--rn02-implementada-diferente-do-especificado) | RN02 implementada diferente do especificado | 🟠 Alto | Regra de negócio |
| [DT-12](#dt-12--duracao_min-não-é-usada-na-checagem-de-conflito) | `duracao_min` não é usada na checagem de conflito | 🟡 Médio | Regra de negócio |
| [DT-05](#dt-05--vocabulário-de-status-divergente) | Vocabulário de status divergente | 🟡 Médio | Modelagem |
| [DT-13](#dt-13--respostas-de-erro-com-http-200) | Respostas de erro com HTTP 200 | 🟡 Médio | API |
| [DT-14](#dt-14--sem-migrations-versionadas) | Sem migrations versionadas | 🟡 Médio | Banco |
| [DT-15](#dt-15--testes-cobrem-só-utilshelpersjs) | Testes cobrem só `utils/helpers.js` | 🟡 Médio | Qualidade |
| [DT-16](#dt-16--readme-documenta-uma-estrutura-que-não-existe) | README documenta uma estrutura que não existe | 🟡 Médio | Documentação |
| [DT-17](#dt-17--rf08-pede-observações-do-pet-que-o-schema-não-tem) | RF08 pede observações do pet que o schema não tem | 🟡 Médio | Funcional |
| [DT-18](#dt-18--colunas-e-tela-mortas) | Colunas e tela mortas | ⚪ Baixo | Limpeza |
| [DT-19](#dt-19--dependências-instaladas-e-não-usadas) | Dependências instaladas e não usadas | ⚪ Baixo | Limpeza |
| [DT-20](#dt-20--serialize-com-callback-async-não-serializa) | `serialize()` com callback `async` não serializa | ⚪ Baixo | Banco |

---

## DT-02 — `ALTER TABLE` antes do `CREATE TABLE` quebra banco novo

**Severidade:** 🔴 Crítico
**Onde:** [database/init.js](../database/init.js)

Os `ALTER TABLE funcionarios ADD COLUMN cpf / email / usuario_id` aparecem **antes** do
`CREATE TABLE IF NOT EXISTS funcionarios`, e o erro de cada `ALTER` é descartado por um
callback vazio (`() => {}`). Em um banco que já existe, isso é inofensivo. Em um banco
novo, os `ALTER` falham em silêncio e a tabela nasce sem essas três colunas.

**Verificado.** Rodando o `init.js` contra um arquivo SQLite vazio:

```
colunas de funcionarios: id, nome, telefone, ativo, criado_em
SELECT ativo FROM funcionarios WHERE usuario_id = ?
  -> SQLITE_ERROR: no such column: usuario_id
```

Essa é exatamente a consulta que o `POST /login` executa depois de validar a senha
([routes/autenticacao.routes.js](../routes/autenticacao.routes.js)). O erro cai no
`catch` e o usuário recebe **"Erro interno no servidor."** — ou seja, em instalação
limpa, *ninguém consegue logar*, nem o admin semeado. As telas de funcionários e a
listagem de agendamentos por funcionário quebram pelo mesmo motivo.

O `biomapet.sqlite` de quem já roda o projeto funciona só porque foi construído
incrementalmente, com as colunas adicionadas quando a tabela já existia. O bug fica
invisível até alguém clonar o repositório do zero — e o banco é gitignored, então
**todo clone novo cai nisso**.

**Correção:** mover o bloco de `CREATE TABLE` (de `funcionarios` e `agendamentos`) para
antes de qualquer `ALTER`, e incluir `cpf`, `email` e `usuario_id` direto no `CREATE`.
Manter os `ALTER` apenas como compatibilidade para bancos legados. Depois, validar
rodando `init.js` contra um arquivo vazio e conferindo o `PRAGMA table_info`.

---

## DT-01 — Senha em texto puro no banco (`senha_texto`)

**Severidade:** 🔴 Crítico
**Onde:** [routes/funcionarios.routes.js](../routes/funcionarios.routes.js),
[database/init.js](../database/init.js),
[views/funcionarios/index.ejs](../views/funcionarios/index.ejs)

Ao cadastrar ou editar um funcionário, a senha é gravada duas vezes: como hash bcrypt em
`usuarios.senha` **e em texto legível em `usuarios.senha_texto`**, para alimentar o botão
"ver senha" do painel administrativo.

```js
'INSERT INTO usuarios (nome, email, senha, senha_texto, permissoes) VALUES (?, ?, ?, ?, ?)',
[capitalize(nome), email.trim(), senhaHash, senha, 'funcionario']
```

Isso anula o bcrypt: qualquer cópia do arquivo `.sqlite` entrega todas as senhas em claro.
Como as pessoas reutilizam senha entre serviços, o dano passa do sistema. Contradiz
frontalmente o **RNF04** do README ("as senhas devem ser armazenadas obrigatoriamente
utilizando hashing seguro").

A causa raiz é a **RN06**, que prevê que o administrador possa "visualizar dados sensíveis
de senha". Essa regra não é implementável com segurança — nem deveria ser: um admin não
precisa ver a senha de ninguém, precisa poder **redefini-la**.

**Correção:** eliminar a coluna `senha_texto` e o botão "ver senha"; substituir por um
fluxo de "redefinir senha do funcionário" (que já existe parcialmente no `PUT
/funcionarios/:id`). Depois, apagar os valores já gravados:
`UPDATE usuarios SET senha_texto = NULL;`. Revisar a RN06 junto com o cliente.

---

## DT-03 — Sem proteção contra CSRF

**Severidade:** 🟠 Alto
**Onde:** [app.js](../app.js) e todas as rotas de escrita

Nenhuma rota `POST`, `PUT` ou `DELETE` valida token anti-CSRF. O cookie de sessão usa
`sameSite: 'lax'`, o que barra o caso mais simples (form `POST` cross-site), mas não é
defesa completa — e as rotas `PUT`/`DELETE` são chamadas via `fetch` a partir das telas,
sem nenhuma verificação de origem.

**Correção:** adicionar `csurf` (ou equivalente mantido, como `csrf-csrf`), injetar o
token nos formulários EJS e no header das chamadas `fetch`. Complementar com
`sameSite: 'strict'` e `secure: true` quando houver HTTPS.

---

## DT-04 — Sem rate limit no login (dependência instalada e não usada)

**Severidade:** 🟠 Alto
**Onde:** [routes/autenticacao.routes.js](../routes/autenticacao.routes.js),
[package.json](../package.json)

`express-rate-limit` está nas dependências, mas não é importado em lugar nenhum. O
`POST /login` e o `POST /esqueci-senha` aceitam tentativas ilimitadas — força bruta de
senha é só questão de tempo, ainda mais com a senha padrão do admin sendo `123456`.

**Correção:** aplicar um limiter nas rotas de autenticação (ex.: 5 tentativas por IP a
cada 15 minutos) e forçar a troca da senha do admin no primeiro login.

---

## DT-09 — Verificação de admin por e-mail hardcoded

**Severidade:** 🟠 Alto
**Onde:** [app.js](../app.js)

A rota `DELETE /usuarios/:id` decide quem é administrador comparando o e-mail da sessão
com uma string literal:

```js
if (!req.session.usuario || req.session.usuario.email !== 'admin@biomapet.com') {
  return res.json({ ok: false, erro: 'sem_permissao' });
}
```

Existe um middleware `verificarAdmin` ([middlewares/autenticacao.js](../middlewares/autenticacao.js))
que faz isso corretamente, olhando `permissoes === 'administrador'`, e ele **não é usado
aqui**. Resultado: um segundo administrador legítimo não consegue excluir usuários, e a
autorização fica amarrada a um endereço de e-mail que ninguém pode mudar.

**Correção:** trocar a checagem por `verificarAdmin`. A proteção do usuário admin
original (não pode ser excluído) pode continuar por e-mail ou, melhor, por uma flag
`protegido` na tabela.

---

## DT-07 — Não existe camada de model nem controller

**Severidade:** 🟠 Alto
**Onde:** todo o diretório [routes/](../routes/) e [app.js](../app.js)

O **RNF01** especifica arquitetura MVC, mas os arquivos de rota concentram roteamento,
validação, regra de negócio, SQL e montagem de view. `agendamentos.routes.js` tem 343
linhas e SQL inline; o `app.js` ainda hospeda duas rotas de negócio (`/dashboard` e
`DELETE /usuarios/:id`) que deveriam estar em módulos próprios.

O custo concreto: as consultas com `GROUP_CONCAT` de agendamentos aparecem **quatro
vezes quase idênticas** (dashboard, listagem, calendário e agendamentos do funcionário).
Mudar uma coluna exige encontrar as quatro. Além disso, regra de negócio acoplada ao
`req`/`res` não é testável sem subir o servidor — por isso os testes cobrem só os helpers
puros (ver [DT-15](#dt-15--testes-cobrem-só-utilshelpersjs)).

**Correção:** extrair uma camada `models/` com as consultas por entidade e `controllers/`
com a lógica, deixando em `routes/` só o mapeamento. Não precisa ser de uma vez: começar
por `agendamentos`, que é o maior e o mais duplicado.

---

## DT-08 — Erros engolidos: falha vira tela vazia

**Severidade:** 🟠 Alto
**Onde:** praticamente todos os handlers em [routes/](../routes/) e [app.js](../app.js)

O padrão repetido é capturar a exceção, logar no console e renderizar a página com
listas vazias e contadores zerados:

```js
} catch (err) {
  console.error('Erro no dashboard:', err);
  res.render('dashboard/dashboard', { totalClientes: 0, /* ... tudo zerado */ });
}
```

Para quem usa o sistema, um banco fora do ar é indistinguível de um pet shop sem
nenhum cliente cadastrado. Foi exatamente esse padrão que manteve o
[DT-02](#dt-02--alter-table-antes-do-create-table-quebra-banco-novo) invisível.

Nas rotas JSON o mesmo acontece com `res.json({ ok: false })` sem nenhuma indicação do
motivo, o que obriga quem depura a ler o log do servidor.

**Correção:** adicionar um error handler central no Express, renderizar uma página de
erro de verdade e diferenciar "não há dados" de "não consegui buscar os dados". Manter
o fallback silencioso só onde ele for uma decisão consciente, com comentário explicando.

---

## DT-06 — Cascata de exclusão vive no código, não no schema

**Severidade:** 🟠 Alto
**Onde:** [routes/pets.routes.js](../routes/pets.routes.js),
[routes/clientes.routes.js](../routes/clientes.routes.js),
[database/init.js](../database/init.js)

Só `agendamento_servicos.agendamento_id` tem `ON DELETE CASCADE`. As demais exclusões em
cadeia são sequências manuais de `DELETE` dentro de transações, repetidas em duas rotas
com ordens ligeiramente diferentes.

A **RN05** ("excluir pet remove os agendamentos") existe, portanto, apenas enquanto
alguém passar pela rota `DELETE /pets/:id`. Um `DELETE` direto no banco, um script de
manutenção ou uma futura rota de importação deixam agendamentos órfãos apontando para
pets inexistentes.

**Correção:** declarar `ON DELETE CASCADE` nas FKs de `pets.cliente_id`,
`agendamentos.pet_id` e `agendamentos.cliente_id`, e `ON DELETE SET NULL` em
`agendamentos.funcionario_id`. Como o SQLite não permite alterar constraint com `ALTER`,
isso exige recriar as tabelas — o que é mais um argumento para
[DT-14](#dt-14--sem-migrations-versionadas). Com as cascatas no banco, as transações
manuais podem ser simplificadas.

---

## DT-10 — Recuperação de senha não envia e-mail

**Severidade:** 🟠 Alto
**Onde:** [routes/autenticacao.routes.js](../routes/autenticacao.routes.js)

O fluxo gera o token, grava com validade de 1 hora e mostra a mensagem
"E-mail enviado! Verifique sua caixa de entrada." — mas nenhum e-mail sai. O próprio
código admite:

```js
// Sempre retorna sucesso porque não envia realmente o e-mail
```

A tela `/redefinir-senha/:token` funciona; só não existe caminho para o usuário obter o
token. Na prática, a funcionalidade está morta e a mensagem é enganosa.

**Correção:** integrar um provedor de e-mail (Nodemailer + SMTP, Resend etc.) e enviar o
link de verdade. Enquanto isso não acontece, trocar o texto por algo honesto — ou
esconder a opção e deixar a redefinição a cargo do administrador.

---

## DT-11 — RN02 implementada diferente do especificado

**Severidade:** 🟠 Alto
**Onde:** [routes/agendamentos.routes.js](../routes/agendamentos.routes.js)

O README define a **RN02** como "não é permitido registrar mais de 3 agendamentos para o
**mesmo serviço** no mesmo horário". O código conta **todos** os agendamentos da hora,
sem olhar o serviço:

```js
`SELECT COUNT(*) AS count FROM agendamentos
 WHERE strftime('%Y-%m-%d %H', data_hora) = ? AND status != 'cancelado'`
```

E a mensagem de erro mostrada é "Já existem 3 agendamentos nesse horário". São regras
diferentes: a implementada é um teto de capacidade global do pet shop; a especificada é
um teto por serviço. Nenhuma das duas está errada em si, mas ninguém sabe qual é a
desejada — e isso vai voltar como bug relatado pelo cliente.

**Correção:** decidir com o cliente qual regra vale, e então alinhar os três lados
(README, consulta SQL e mensagem ao usuário). Se for capacidade global, ela também
deveria considerar funcionários disponíveis, não um número fixo.

---

## DT-12 — `duracao_min` não é usada na checagem de conflito

**Severidade:** 🟡 Médio
**Onde:** [routes/agendamentos.routes.js](../routes/agendamentos.routes.js),
[database/init.js](../database/init.js)

Cada serviço tem `duracao_min` (Tosa = 90 min, Banho = 60 min), mas toda a detecção de
conflito agrupa por **hora cheia** via `strftime('%Y-%m-%d %H', ...)`. Duas consequências:

- Uma tosa de 90 minutos às 14h não bloqueia nada às 15h, embora ainda esteja em curso.
- Agendamentos às 14h00 e 14h59 são tratados como o mesmo slot.

**Correção:** calcular o intervalo `[início, início + duração)` e testar sobreposição real
de intervalos. É a mudança que deixa a agenda confiável — recomendo encarar junto com
[DT-11](#dt-11--rn02-implementada-diferente-do-especificado), já que as duas mexem na
mesma consulta.

---

## DT-05 — Vocabulário de status divergente

**Severidade:** 🟡 Médio
**Onde:** [database/init.js](../database/init.js),
[routes/agendamentos.routes.js](../routes/agendamentos.routes.js), README

Três vocabulários convivem para a mesma coisa:

| Origem | Valores |
|---|---|
| Schema (`DEFAULT`) | `pendente` |
| Código | `confirmado`, `concluido`, `cancelado` |
| README (RF14) | Agendado, Concluído, Cancelado |

O default `'pendente'` nunca é usado, porque o `INSERT` grava `'confirmado'` explicitamente.
Não há `CHECK` constraint, então qualquer string entra na coluna.

**Correção:** definir a lista canônica de status, aplicar `CHECK (status IN (...))` no
schema, ajustar o `DEFAULT` e atualizar o README.

---

## DT-13 — Respostas de erro com HTTP 200

**Severidade:** 🟡 Médio
**Onde:** [routes/clientes.routes.js](../routes/clientes.routes.js),
[routes/pets.routes.js](../routes/pets.routes.js),
[routes/funcionarios.routes.js](../routes/funcionarios.routes.js), [app.js](../app.js)

As rotas JSON sinalizam falha no corpo (`{ ok: false, erro: 'dados_invalidos' }`) mas
sempre respondem `200 OK`. Validação falha, permissão negada e erro de banco são
indistinguíveis para qualquer cliente HTTP que olhe o status — monitoramento, logs de
proxy e testes automatizados incluídos. `PUT /servicos/:id` é o único que usa `500`,
o que torna o comportamento inconsistente entre rotas.

**Correção:** usar `400` para validação, `403` para permissão, `404` para não encontrado
e `500` para erro interno, mantendo o corpo atual por compatibilidade com o front.

---

## DT-14 — Sem migrations versionadas

**Severidade:** 🟡 Médio
**Onde:** [database/init.js](../database/init.js)

Toda a evolução do schema é um único script idempotente à base de
`CREATE TABLE IF NOT EXISTS` e `ALTER TABLE` com erro suprimido. Não há versão de schema,
histórico, nem rollback. O arquivo mistura DDL, seed de serviços e seed do usuário admin.

Isso é o que permitiu o [DT-02](#dt-02--alter-table-antes-do-create-table-quebra-banco-novo)
passar despercebido: bancos novos e bancos antigos divergem sem que nada acuse.

**Correção:** adotar migrations numeradas (`001_init.sql`, `002_add_funcionarios.sql`…)
com uma tabela `schema_migrations`, e separar seed de DDL. Ferramenta leve serve —
`node-pg-migrate` não se aplica, mas `umzug` ou scripts próprios sim.

---

## DT-15 — Testes cobrem só `utils/helpers.js`

**Severidade:** 🟡 Médio
**Onde:** [testes/validacoes.test.js](../testes/validacoes.test.js)

São 26 testes, todos sobre funções puras: `capitalize`, regex de telefone e e-mail,
`normalizarServicos`, `calcularValores`, `validarDependenciasServicos`. É uma boa base —
mas nenhuma rota, nenhuma consulta e nenhuma regra de agendamento é testada. O CI
([.github/workflows/ci.yml](../.github/workflows/ci.yml)) roda `npm test` e fica verde
mesmo com o login quebrado em instalação limpa.

**Correção:** adicionar testes de integração com `supertest` cobrindo login, criação de
agendamento (incluindo RN02, RN03 e RN04) e as cascatas de exclusão, usando um SQLite em
memória criado pelo mesmo `init.js` — o que, de quebra, teria pego o DT-02.

---

## DT-16 — README documenta uma estrutura que não existe

**Severidade:** 🟡 Médio
**Onde:** [README.md](../README.md), seção 5

O README descreve `src/controllers/`, `src/models/`, `src/routes/` e `src/views/`.
Nenhuma dessas pastas existe: o projeto é flat (`routes/`, `views/`, `middlewares/`,
`utils/`, `database/`) e não há controllers nem models
(ver [DT-07](#dt-07--não-existe-camada-de-model-nem-controller)).

A seção 6 também omitia o passo do `.env` com `SESSION_SECRET` — **sem o qual a
aplicação sequer inicia** —, o que fazia as instruções de execução não funcionarem em
máquina nova. E o RNF06 ainda cita Render como plataforma de hospedagem, embora hoje
exista um `Dockerfile` no repositório e nenhuma configuração de Render.

**Correção:** feita em parte nesta rodada — seção 5 reescrita conforme a estrutura real,
índice de `docs/` adicionado e seção 6 alinhada com o `.env.example`, os testes e o
Docker. Continua pendente: decidir o destino do RNF06 (Render, container ou ambos) e
atualizar a URL do repositório de origem, que ainda aponta para `BiomaPetShop-MM`.

---

## DT-17 — RF08 pede observações do pet que o schema não tem

**Severidade:** 🟡 Médio
**Onde:** README (RF08), [database/init.js](../database/init.js)

O **RF08** diz que o cadastro de pet deve registrar "nome, espécie, raça, porte
(pequeno, médio ou grande) e **observações**". A tabela `pets` não tem coluna
`observacoes` e o formulário não pede esse campo. O requisito está declarado como
atendido no README, mas não foi implementado.

Há ainda uma inversão entre schema e código: `raca` e `porte` são nuláveis na tabela,
mas obrigatórios na validação da rota — enquanto `especie` é `NOT NULL` nos dois lados.

**Correção:** decidir se o requisito vale. Se sim, adicionar a coluna e o campo; se não,
remover o RF08 da lista ou marcá-lo como fora de escopo.

---

## DT-18 — Colunas e tela mortas

**Severidade:** ⚪ Baixo

| Item | Onde | Situação |
|---|---|---|
| `agendamentos.servico_id` | [database/init.js](../database/init.js) | Substituída por `agendamento_servicos`; nunca escrita nem lida |
| `agendamentos.desconto` | idem | Sempre `0`; `calcularValores()` retorna desconto fixo em zero |
| `funcionarios.cpf` | idem | Coluna prevista, nenhuma rota preenche |
| `funcionarios.email` | idem | Duplica `usuarios.email`, podendo divergir na edição |
| [views/emails/index.ejs](../views/emails/index.ejs) | 171 linhas | Nenhuma rota renderiza; parece versão anterior de `funcionarios/index.ejs` |
| [views/autenticacao/cadastro.ejs](../views/autenticacao/cadastro.ejs) | 134 linhas | Inalcançável: `GET` e `POST /cadastro` só redirecionam para `/login` |
| `ALTER TABLE agendamentos ...` | [database/init.js](../database/init.js) | As colunas já estão no `CREATE TABLE`; os `ALTER` só falham em silêncio |

Cerca de 300 linhas de view morta. O risco não é o espaço: é alguém corrigir um bug no
arquivo errado — `views/emails/index.ejs` e `views/funcionarios/index.ejs` são parecidas
o bastante para confundir, e ambas contêm o botão "ver senha" do
[DT-01](#dt-01--senha-em-texto-puro-no-banco-senha_texto).

**Correção:** remover as views mortas e os `ALTER` redundantes. Para as colunas, esperar
a recriação de tabelas de [DT-06](#dt-06--cascata-de-exclusão-vive-no-código-não-no-schema)
/ [DT-14](#dt-14--sem-migrations-versionadas) e aproveitar para descartá-las.

---

## DT-19 — Dependências instaladas e não usadas

**Severidade:** ⚪ Baixo
**Onde:** [package.json](../package.json)

| Pacote | Situação |
|---|---|
| `express-rate-limit` | Nunca importado — ver [DT-04](#dt-04--sem-rate-limit-no-login-dependência-instalada-e-não-usada) |
| `express-ejs-layouts` | Nunca importado; cada view repete o `<head>` inteiro |
| `bootstrap` | Instalado como dependência, mas as views carregam Bootstrap via CDN |

O Bootstrap via CDN merece atenção à parte: a aplicação depende de `cdn.jsdelivr.net`
para renderizar qualquer tela, sem `integrity` hash e sem fallback offline.

**Correção:** usar `express-rate-limit` (DT-04), adotar `express-ejs-layouts` para
eliminar a repetição de `<head>` nas 13 views, e servir o Bootstrap local a partir de
`node_modules` — ou remover a dependência e assumir o CDN, com `integrity`.

---

## DT-20 — `serialize()` com callback `async` não serializa

**Severidade:** ⚪ Baixo
**Onde:** [database/init.js](../database/init.js)

```js
db.serialize(async () => {
  // ... DDL ...
  const senhaHash = await bcrypt.hash('123456', 10);
  db.get('select * from usuarios where email = ?', ...)
```

O `serialize()` não aguarda promessas: no primeiro `await`, o callback retorna e o modo
serializado se encerra. Tudo depois do `await bcrypt.hash` roda **fora** da garantia de
ordem. Hoje funciona por sorte de temporização, mas é frágil — e some se a criação do
admin passar a depender de alguma tabela criada logo acima.

**Correção:** tornar o init de fato sequencial com `await` sobre os helpers de
[database/db-promise.js](../database/db-promise.js), que já existem e retornam promessas.

---

## Ordem sugerida de ataque

1. **DT-02** — sem isso, nenhum ambiente novo sobe. Bloqueia qualquer onboarding.
2. **DT-01** — exposição de credenciais; quanto mais tempo, mais senhas em claro no banco.
3. **DT-04**, **DT-09**, **DT-03** — trinca de segurança de baixo custo e alto retorno.
4. **DT-15** — testes de integração antes de refatorar, para ter rede de proteção.
5. **DT-14** + **DT-06** + **DT-05** — recriar o schema uma vez, resolvendo os três juntos.
6. **DT-11** + **DT-12** — alinhar a regra de agenda com o cliente e implementar direito.
7. **DT-07** + **DT-08** — refatoração estrutural, já com testes cobrindo.
8. **DT-10**, **DT-13**, **DT-16**, **DT-17** — conforme prioridade do produto.
9. **DT-18**, **DT-19**, **DT-20** — limpeza, encaixável em qualquer sprint.
