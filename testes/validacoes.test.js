const {
  capitalize,
  telPattern,
  emailPattern,
  normalizarServicos,
  calcularValores,
  servicoSemPreRequisito
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

// servicoSemPreRequisito (RN04)
const banho = { id: 1, nome: 'Banho', pre_requisito_id: null };
const tosa = { id: 2, nome: 'Tosa', pre_requisito_id: 1 };
const hidratacao = { id: 3, nome: 'Hidratação', pre_requisito_id: 1 };
const unhas = { id: 5, nome: 'Corte de Unhas', pre_requisito_id: null };

test('tosa sem banho é barrada', () => {
  expect(servicoSemPreRequisito([tosa])).toBe(tosa);
});

test('hidratação sem banho é barrada', () => {
  expect(servicoSemPreRequisito([hidratacao, unhas])).toBe(hidratacao);
});

test('tosa com banho é permitida', () => {
  expect(servicoSemPreRequisito([tosa, banho])).toBeNull();
});

test('hidratação com banho é permitida', () => {
  expect(servicoSemPreRequisito([banho, hidratacao])).toBeNull();
});

test('serviço sem pré-requisito é permitido sozinho', () => {
  expect(servicoSemPreRequisito([unhas])).toBeNull();
});

test('a regra não depende do nome do serviço', () => {
  const tosaRenomeada = { ...tosa, nome: 'Tosa Higiênica' };
  expect(servicoSemPreRequisito([tosaRenomeada])).toBe(tosaRenomeada);
});

test('ids vindos do formulário como texto também funcionam', () => {
  expect(servicoSemPreRequisito([{ ...tosa, id: '2', pre_requisito_id: '1' }, { ...banho, id: '1' }])).toBeNull();
});

test('lista vazia é permitida', () => {
  expect(servicoSemPreRequisito([])).toBeNull();
});