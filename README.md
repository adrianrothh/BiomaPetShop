# BiomaPetShop

> Sistema Web de Gestão e Agendamentos para Pet Shop com arquitetura SSR e banco de dados relacional.

Integrantes
- Anttonio Osório Molinaro Maccagnini
- Gabriel Lengert Guedes
- Heitor Lopes Reis
- João Pedro Alves de Lima
- João Vitor Paranhos
- Rafael Alexandre Alves Bandoch

Link do Repositório: https://github.com/RafaelBandoch/BiomaPetShop-MM

---

## 1. Sobre o Projeto

O BiomaPetShop é uma aplicação web desenvolvida para o gerenciamento de rotinas administrativas e operacionais em pet shops. O objetivo do sistema é otimizar o atendimento, prevenir conflitos de horários e centralizar as informações vitais do estabelecimento.

O sistema abrange o controle completo das seguintes entidades:
- Clientes e seus dados de contato.
- Pets associados aos seus respectivos tutores.
- Serviços com precificação adaptada de acordo com o porte do animal.
- Agendamentos e controle de status de atendimento.
- Dashboard contendo métricas e consolidados operacionais.

---

## 2. Requisitos do Sistema

### 2.1. Requisitos Funcionais (RF)

- **[RF01] Autenticar Usuário:** O sistema deve permitir que usuários realizem login informando e-mail e senha, além de oferecer a funcionalidade de encerramento da sessão (logout).
- **[RF02] Gerenciar Usuários:** O sistema deve permitir o cadastro e a gestão de usuários com perfis de acesso distintos (Administrador e Atendente).
- **[RF03] Proteção de Rotas:** O sistema deve restringir o acesso às páginas e rotas internas, exigindo autenticação prévia.
- **[RF04] Cadastrar Cliente:** O sistema deve permitir o cadastro de clientes com nome, e-mail e telefone.
- **[RF05] Listar e Visualizar Clientes:** O sistema deve listar todos os clientes cadastrados e exibir o detalhamento de suas informações.
- **[RF06] Editar e Excluir Cliente:** O sistema deve permitir a atualização e remoção dos dados dos clientes.
- **[RF07] Visualizar Pets do Cliente:** O sistema deve exibir no detalhamento do cliente a lista de pets associados ao seu cadastro.
- **[RF08] Cadastrar Pet:** O sistema deve permitir cadastrar pets vinculados a um cliente, registrando nome, espécie, raça, porte (pequeno, médio ou grande) e observações.
- **[RF09] Editar e Excluir Pet:** O sistema deve permitir a edição e a remoção de um registro de pet.
- **[RF10] Cadastrar e Editar Serviços:** O sistema deve permitir o cadastro e alteração de serviços com nome, duração estimada em minutos e tabela de preços por porte.
- **[RF11] Listar Serviços:** O sistema deve apresentar a lista de serviços cadastrados com seus respectivos valores.
- **[RF12] Criar Agendamento:** O sistema deve permitir a criação de agendamentos associando cliente, pet, data/hora e um ou múltiplos serviços.
- **[RF13] Calcular Valor Total do Agendamento:** O sistema deve calcular automaticamente o valor final com base na soma dos preços dos serviços de acordo com o porte do pet.
- **[RF14] Alterar Status do Agendamento:** O sistema deve permitir atualizar o status do atendimento entre Agendado, Concluído e Cancelado.
- **[RF15] Cancelar e Reagendar:** O sistema deve permitir o cancelamento e a alteração de data/hora de agendamentos existentes.
- **[RF16] Filtrar Agendamentos:** O sistema deve permitir a filtragem de agendamentos com base no status.
- **[RF17] Exibir Métricas no Dashboard:** O sistema deve exibir no painel principal os totais consolidados do dia (agendamentos, clientes, pets e serviços).
- **[RF18] Exibir Listagens Recentes:** O sistema deve apresentar no dashboard as listas de clientes cadastrados e agendamentos recentes.

### 2.2. Requisitos Não Funcionais (RNF)

- **[RNF01] Padrão Arquitetural:** O sistema deve utilizar a arquitetura Model-View-Controller (MVC) para separação de responsabilidades.
- **[RNF02] Renderização no Servidor (SSR):** A interface da aplicação deve ser renderizada do lado do servidor utilizando EJS como template engine.
- **[RNF03] Banco de Dados Relacional:** O sistema deve utilizar o banco de dados relacional SQLite para persistência dos dados.
- **[RNF04] Criptografia de Credenciais:** As senhas dos usuários devem ser armazenadas obrigatoriamente utilizando hashing seguro (bcrypt).
- **[RNF05] Interface e Usabilidade:** O layout e o fluxo da aplicação devem seguir a especificação e prototipagem definida no Figma.
- **[RNF06] Hospedagem:** A aplicação deve estar publicada e acessível em ambiente de nuvem na plataforma Render.

---

## 3. Regras de Negócio (RN)

- **[RN01] Unicidade de Dados de Contato:** O e-mail e o telefone informados no cadastro do cliente devem ser únicos no banco de dados.
- **[RN02] Limite de Agendamentos por Horário:** Não é permitido registrar mais de 3 (três) agendamentos para o mesmo serviço no mesmo horário.
- **[RN03] Validação de Conflito de Agendamento:** O mesmo pet não pode ter agendamentos sobrepostos para os mesmos serviços na mesma data e horário.
- **[RN04] Dependência de Serviços:** Os serviços de Tosa e Hidratação possuem o serviço de Banho como pré-requisito obrigatório.
- **[RN05] Exclusão em Cascata (Pets):** A exclusão de um registro de Pet deve remover em cascata todos os agendamentos vinculados a ele.
- **[RN06] Privilégios Administrativos:** Apenas usuários com perfil Administrador podem visualizar dados sensíveis de senha e realizar a exclusão de usuários do sistema.

---

## 4. Tecnologias e Arquitetura

O sistema foi estruturado seguindo o padrão arquitetural MVC (Model-View-Controller) com renderização no servidor (SSR):

- Linguagem / Runtime: Node.js
- Framework Web: Express
- Template Engine: EJS (Server-Side Rendering)
- Banco de Dados: SQLite (Relacional)
- Criptografia: bcrypt (hashing seguro para armazenamento de senhas)
- Versionamento: Git e GitHub

---

## 5. Estrutura de Diretórios
```
bioma-manutencao/
├── app.js             # Ponto de entrada: sessão, middlewares, dashboard
├── routes/            # Rotas do sistema (roteamento, validação e queries)
├── views/             # Páginas renderizadas via EJS, organizadas por domínio
├── middlewares/       # Proteção de rotas e verificação de perfil
├── utils/             # Funções auxiliares e cálculos de negócio
├── database/          # Conexão, schema (init.js) e arquivos .sqlite
├── public/            # Arquivos estáticos (CSS e imagens)
├── testes/            # Testes automatizados (Jest)
├── docs/              # Documentação técnica do projeto
└── package.json       # Dependências e scripts do projeto
```

> O projeto segue o padrão MVC de forma parcial: não existem camadas separadas de
> `controllers` e `models` — a lógica e as queries vivem nos arquivos de `routes/`.
> Essa divergência está registrada em [docs/debitos-tecnicos.md](docs/debitos-tecnicos.md).

---

## 5.1. Documentação Técnica

| Documento | Conteúdo |
|---|---|
| [docs/DER.md](docs/DER.md) | Modelo de dados: entidades, colunas, relacionamentos e integridade referencial |
| [docs/debitos-tecnicos.md](docs/debitos-tecnicos.md) | Inventário de débitos técnicos com severidade, impacto e correção sugerida |
| [docs/handoff.md](docs/handoff.md) | Passagem de bastão: como rodar, mapa de rotas, decisões de projeto e próximos passos |

---

## 6. Instruções para Execução Local

### Pré-requisitos
- Node.js 20 ou superior (o arquivo `.nvmrc` fixa a versão 22).
- Git instalado.

### Passo a Passo

1. Clonar o repositório do projeto:
   ```bash
   git clone https://github.com/RafaelBandoch/BiomaPetShop-MM.git
   cd BiomaPetShop-MM
   ```

2. Instalar as dependências do projeto:
   ```bash
   npm install
   ```

3. Configurar as variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```
   Gere um valor aleatório para `SESSION_SECRET` e edite o `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   > **A aplicação não inicia sem `SESSION_SECRET`.** É proposital: sem segredo
   > definido, o servidor falha no boot em vez de assinar os cookies de sessão com
   > um valor previsível.

4. Iniciar o servidor da aplicação:
   ```bash
   npm start          # produção
   npm run dev        # desenvolvimento, com auto-reload
   ```

5. Acessar no navegador:
   Abra o endereço http://localhost:3000 (ou a porta definida em `PORT`).

   Credenciais criadas automaticamente no primeiro boot:
   `admin@biomapet.com` / `123456` — troque antes de publicar em qualquer ambiente.

### Executar os testes
```bash
npm test
```

### Executar via Docker
```bash
docker build -t biomapet .
docker run -p 3000:3000 -e SESSION_SECRET=<valor> -v biomapet-data:/app/database biomapet
```
O volume em `/app/database` é obrigatório: sem ele, o banco SQLite se perde a cada
recriação do container.

---

Projeto desenvolvido para a disciplina de Manutenção e Melhoria de Software.
