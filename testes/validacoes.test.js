const {
  capitalize,
  telPattern,
  emailPattern,
  normalizarServicos,
  calcularValores,
  validarDependenciasServicos
} = require('../utils/helpers');

// capitalize
test('primeira letra de cada palavra deve ser maiúscula', () => {
  expect(capitalize('joao silva')).toBe('Joao Silva');
});

test('texto todo em maiúsculo deve ser formatado corretamente', () => {
  expect(capitalize('MARIA COSTA')).toBe('Maria Costa');
});

test('espaços nas bordas são removidos', () => {
  expect(capitalize('  ana paula  ')).toBe('Ana Paula');
});

// telPattern
test('telefone celular com DDD é aceito', () => {
  expect(telPattern.test('(11) 91234-5678')).toBe(true);
});

test('telefone fixo com DDD é aceito', () => {
  expect(telPattern.test('(11) 1234-5678')).toBe(true);
});

test('telefone com letras é rejeitado', () => {
  expect(telPattern.test('(11) 9abcd-5678')).toBe(false);
});

test('string vazia é rejeitada', () => {
  expect(telPattern.test('')).toBe(false);
});

// emailPattern
test('email com .com.br é válido', () => {
  expect(emailPattern.test('usuario@empresa.com.br')).toBe(true);
});

test('email com .com é válido', () => {
  expect(emailPattern.test('usuario@gmail.com')).toBe(true);
});

test('email sem @ é rejeitado', () => {
  expect(emailPattern.test('usuariogmail.com')).toBe(false);
});

test('email com extensão inválida não é aceito', () => {
  expect(emailPattern.test('usuario@gmail.xyz')).toBe(false);
});

// normalizarServicos
test('retorna array vazio quando recebe null', () => {
  expect(normalizarServicos(null)).toEqual([]);
});

test('retorna array vazio quando recebe undefined', () => {
  expect(normalizarServicos(undefined)).toEqual([]);
});

test('converte string em array de um elemento', () => {
  expect(normalizarServicos('1')).toEqual(['1']);
});

test('mantém array quando já recebe array', () => {
  expect(normalizarServicos(['1', '2'])).toEqual(['1', '2']);
});

// calcularValores
const servicosTeste = [
  { preco_pequeno: '30.00', preco_medio: '50.00', preco_grande: '70.00' },
  { preco_pequeno: '20.00', preco_medio: '40.00', preco_grande: '60.00' }
];

test('soma os preços corretamente para porte Pequeno', () => {
  expect(calcularValores(servicosTeste, { porte: 'Pequeno' }).valorFinal).toBe(50);
});

test('soma os preços corretamente para porte Médio', () => {
  expect(calcularValores(servicosTeste, { porte: 'Médio' }).valorFinal).toBe(90);
});

test('soma os preços corretamente para porte Grande', () => {
  expect(calcularValores(servicosTeste, { porte: 'Grande' }).valorFinal).toBe(130);
});

test('porte desconhecido usa preço Médio como padrão', () => {
  expect(calcularValores(servicosTeste, { porte: 'Gigante' }).valorFinal).toBe(90);
});

test('desconto é sempre zero', () => {
  expect(calcularValores(servicosTeste, { porte: 'Pequeno' }).desconto).toBe(0);
});

// validarDependenciasServicos
test('tosa sem banho deve retornar false', () => {
  expect(validarDependenciasServicos(['tosa'])).toBe(false);
});

test('hidratação sem banho deve retornar false', () => {
  expect(validarDependenciasServicos(['hidratação'])).toBe(false);
});

test('tosa com banho deve retornar true', () => {
  expect(validarDependenciasServicos(['tosa', 'banho'])).toBe(true);
});

test('hidratação com banho deve retornar true', () => {
  expect(validarDependenciasServicos(['hidratação', 'banho'])).toBe(true);
});

test('banho sozinho deve retornar true', () => {
  expect(validarDependenciasServicos(['banho'])).toBe(true);
});

test('lista vazia deve retornar true', () => {
  expect(validarDependenciasServicos([])).toBe(true);
});
