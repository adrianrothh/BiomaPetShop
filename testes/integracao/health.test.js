const { request, app, prepararBanco, fecharBanco } = require('../helpers/app');
const { dbRun } = require('../../database/db-promise');

// Health check usado pelo Render e pelo HEALTHCHECK do Dockerfile. A falha de banco é
// simulada renomeando a tabela consultada, como no erros.test.js.

beforeAll(prepararBanco);
afterAll(fecharBanco);

test('responde 200 sem login', async () => {
  const res = await request(app).get('/health');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test('não cria sessão nem envia cookie', async () => {
  const res = await request(app).get('/health');

  expect(res.headers['set-cookie']).toBeUndefined();
  expect(res.headers['cache-control']).toBe('no-store');
});

test('responde 503 quando o banco falha', async () => {
  const erroNoConsole = jest.spyOn(console, 'error').mockImplementation(() => {});
  await dbRun('ALTER TABLE usuarios RENAME TO usuarios_bkp');
  try {
    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'erro' });
    expect(erroNoConsole).toHaveBeenCalled();
  } finally {
    await dbRun('ALTER TABLE usuarios_bkp RENAME TO usuarios');
    erroNoConsole.mockRestore();
  }
});
