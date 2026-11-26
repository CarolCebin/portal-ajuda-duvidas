const decimal = /^\d{1,6}(?:[.,]\d{1,6})?$/;

function price(value, minimum) {
  if (typeof value !== 'string' || !decimal.test(value)) return null;
  const number = Number(value.replace(',', '.'));
  return number >= minimum && number <= 100000 ? number : null;
}

export function parseCostSettings(input) {
  if (!input || typeof input !== 'object') return null;
  const entrada = price(input.entrada_usd, 0);
  const saida = price(input.saida_usd, 0);
  const cambio = price(input.dolar_brl, 0.000001);
  const limite = typeof input.limite_diario === 'string' && /^\d{1,6}$/.test(input.limite_diario)
    ? Number(input.limite_diario) : 0;
  if (entrada === null || saida === null || (input.dolar_brl !== '' && cambio === null) || limite < 1 || limite > 100000) {
    return null;
  }
  return { entrada_usd: entrada, saida_usd: saida, dolar_brl: cambio, limite_diario: limite };
}

export function summarizeModelCosts({ configuracao, origens }, origin = 'todas') {
  const groups = origin === 'todas' ? Object.values(origens) : [origens[origin] ?? {}];
  const sum = key => groups.reduce((total, group) => total + (group[key] ?? 0), 0);
  const cost = (input, output) => (input * configuracao.entrada_usd + output * configuracao.saida_usd) / 1_000_000;
  const exchange = usd => usd === null || configuracao.dolar_brl === null ? null : usd * configuracao.dolar_brl;
  const calls = sum('chamadas');
  const measured = sum('medidas');
  const timed = sum('com_duracao');
  const total = measured ? cost(sum('tokens_entrada'), sum('tokens_saida')) : calls ? null : 0;
  const app = origens.app;
  const average = app?.medidas ? cost(app.tokens_entrada, app.tokens_saida) / app.medidas : null;
  const thousand = average === null ? null : average * 1000;
  return {
    chamadas: calls,
    medidas: measured,
    tempoMedioMs: timed ? sum('duracao_total_ms') / timed : null,
    totalUsd: total,
    totalBrl: exchange(total),
    medioUsd: average,
    medioBrl: exchange(average),
    milUsd: thousand,
    milBrl: exchange(thousand),
  };
}
