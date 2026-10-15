const capitalize = str =>
  str.trim().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');

const telPattern = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.(com|com\.br|net|org)$/;

function normalizarServicos(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function calcularValores(servicosSelecionados, pet) {
  const porteMap = { 'Pequeno': 'preco_pequeno', 'Médio': 'preco_medio', 'Grande': 'preco_grande' };
  const campoPreco = porteMap[pet.porte] || 'preco_medio';

  let subtotal = 0;
  servicosSelecionados.forEach(s => { subtotal += parseFloat(s[campoPreco]) || 0; });

  return { subtotal, desconto: 0, valorFinal: Math.round(subtotal * 100) / 100, campoPreco };
}

function validarDependenciasServicos(nomes) {
  if ((nomes.includes('tosa') || nomes.includes('hidratação')) && !nomes.includes('banho')) {
    return false;
  }
  return true;
}

module.exports = { capitalize, telPattern, emailPattern, normalizarServicos, calcularValores, validarDependenciasServicos };
