'use client';

import { useEffect, useRef, useState } from 'react';
import { summarizeModelCosts } from '../lib/custos.mjs';

const fields = [
  ['entrada_usd', 'Entrada em US$ por milhão de tokens', 'decimal', true],
  ['saida_usd', 'Saída em US$ por milhão de tokens', 'decimal', true],
  ['dolar_brl', 'Valor de US$ 1 em reais', 'decimal', false],
  ['limite_diario', 'Chamadas por navegador por dia', 'numeric', true],
];
const number = new Intl.NumberFormat('pt-BR');
const seconds = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const currencies = Object.fromEntries(['USD', 'BRL'].map(currency => [
  currency, new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 8 }),
]));

function money(value, currency) {
  return value === null ? '—' : currencies[currency].format(value);
}

function toDraft(config) {
  return Object.fromEntries(fields.map(([key]) => [key, String(config[key] ?? '').replace('.', ',')]));
}

async function costRequest(options) {
  const response = await fetch('/api/admin/custos', { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.erro || 'Não foi possível acessar os custos.');
  return data;
}

export default function CostsPanel() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [origin, setOrigin] = useState('todas');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    costRequest({ signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) {
        setData(value);
        setDraft(toDraft(value.configuracao));
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar os custos. Tente novamente.');
    });
    return () => controller.abort();
  }, [reload]);

  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { configuracao } = await costRequest({
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]))),
      });
      setData(current => ({ ...current, configuracao }));
      setDraft(toDraft(configuracao));
      setNotice('Configurações salvas. As estimativas foram atualizadas.');
    } catch (cause) {
      setError(cause.message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  if (!data) return error
    ? <div className="evaluation-feedback" role="alert">{error} <button className="text-button" onClick={() => {
      setError(''); setReload(attempt => attempt + 1);
    }}>Tentar novamente</button></div>
    : <p role="status">Carregando custos…</p>;

  const stats = summarizeModelCosts(data, origin);

  return <div className="costs-view">
    <section className="admin-panel costs-panel" aria-labelledby="costs-overview">
      <div className="costs-toolbar">
        <div>
          <h2 id="costs-overview">Consumo do modelo</h2>
          <p className="evaluation-muted">Estimativa com base no plano pago do Gemini. Considera as chamadas registradas desde a ativação da medição.</p>
        </div>
        <div className="field">
          <label htmlFor="cost-origin">Origem das chamadas</label>
          <select id="cost-origin" value={origin} onChange={event => setOrigin(event.target.value)}>
            <option value="todas">Todas</option>
            <option value="app">App</option>
            <option value="avaliacao">Avaliação</option>
          </select>
        </div>
      </div>
      <dl className="costs-metrics">
        <div><dt>Chamadas</dt><dd>{number.format(stats.chamadas)}</dd></div>
        <div><dt>Custo estimado</dt><dd>{money(stats.totalUsd, 'USD')}</dd><dd>{money(stats.totalBrl, 'BRL')}</dd></div>
        <div><dt>Tempo médio de resposta</dt><dd>{stats.tempoMedioMs === null ? '—' : seconds.format(stats.tempoMedioMs / 1000) + ' s'}</dd></div>
      </dl>
      {stats.chamadas > stats.medidas && <p className="evaluation-muted">{number.format(stats.chamadas - stats.medidas)} chamadas sem contagem completa de tokens ficaram fora da estimativa.</p>}
      <h3>Estimativas de uso do app</h3>
      <p className="evaluation-muted">Cada uso representa uma chamada ao modelo. A média considera as chamadas do app com contagem de tokens.</p>
      <dl className="costs-metrics costs-projections">
        <div><dt>Custo médio por uso</dt><dd>{money(stats.medioUsd, 'USD')}</dd><dd>{money(stats.medioBrl, 'BRL')}</dd></div>
        <div><dt>Projeção para mil usos</dt><dd>{money(stats.milUsd, 'USD')}</dd><dd>{money(stats.milBrl, 'BRL')}</dd></div>
      </dl>
      {data.configuracao.dolar_brl === null && <p className="evaluation-muted">Informe a cotação do dólar para ver os valores em reais.</p>}
    </section>

    <form className="admin-panel costs-panel" aria-labelledby="costs-settings" onSubmit={save}>
      <h2 id="costs-settings">Preços e limite diário</h2>
      <p className="evaluation-muted">As estimativas usam os valores salvos aqui. O limite do app reinicia à meia-noite, no horário de Brasília.</p>
      <div className="costs-settings-grid">
        {fields.map(([key, label, inputMode, required]) => <div className="field" key={key}>
          <label htmlFor={'cost-' + key}>{label}</label>
          <input id={'cost-' + key} inputMode={inputMode} maxLength={13} required={required} disabled={saving}
            value={draft[key]} onChange={event => {
              setNotice('');
              setDraft(current => ({ ...current, [key]: event.target.value }));
            }} />
        </div>)}
      </div>
      <p className="evaluation-muted">As avaliações não consomem o limite diário.</p>
      <div className="evaluation-actions">
        <button className="button button-primary" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar configurações'}</button>
        {notice && <p className="evaluation-message" role="status">{notice}</p>}
      </div>
      {error && <p className="evaluation-feedback" role="alert">{error}</p>}
    </form>
  </div>;
}
