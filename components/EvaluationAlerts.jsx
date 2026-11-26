'use client';

import { useEffect, useState } from 'react';
import { evaluationRequest, formatEvaluationDate, instructionTypes } from '../lib/avaliacao.mjs';

export default function EvaluationAlerts() {
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    evaluationRequest({ query: '?alertas=1' }).then(({ alertas }) => {
      if (active) setAlerts(alertas);
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [retry]);

  return <section className="admin-panel evaluation-history evaluation-alerts" aria-labelledby="evaluation-alerts">
    <h2 id="evaluation-alerts">Alertas de instruções no chat</h2>
    {error && <div className="evaluation-feedback" role="alert">{error}
      <button className="text-button" onClick={() => { setError(''); setRetry(count => count + 1); }}>Tentar novamente</button>
    </div>}
    {!alerts && !error && <p role="status">Carregando alertas…</p>}
    {alerts?.length === 0 && <p className="evaluation-empty">Nenhum alerta registrado.</p>}
    {alerts?.length > 0 && <ol>
      {alerts.map(alert => <li key={alert.mensagem_id}>
        <div className="evaluation-history-main">
          <time dateTime={alert.mensagem_criada_em}>{formatEvaluationDate(alert.mensagem_criada_em)}</time>
          <span className="evaluation-muted">Data da mensagem</span>
        </div>
        <div>
          <strong>{instructionTypes[alert.tipo]}</strong>
          <p className="evaluation-muted evaluation-text">Registro {alert.mensagem_id}</p>
        </div>
        <time className="evaluation-muted" dateTime={alert.detectado_em}>Detectado em {formatEvaluationDate(alert.detectado_em)}</time>
      </li>)}
    </ol>}
  </section>;
}
