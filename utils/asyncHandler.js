// O Express 4 não captura promises rejeitadas: um erro num handler async vira
// rejeição não tratada e encerra o processo do Node. Este wrapper encaminha a
// rejeição para next(err), que leva ao handler central (middlewares/erros.js).
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
