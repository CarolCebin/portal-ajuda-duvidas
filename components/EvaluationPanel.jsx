'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MESSAGE_LIMIT } from '../lib/chat.mjs';
import { EVALUATION_REASON_LIMIT, EVALUATION_TEXT_LIMIT, suggestedMark } from '../lib/avaliacao.mjs';

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const resultLabels = {
  pendente: 'Aguardando resposta',
  executando: 'Chamando o modelo…',
  erro_chamada: 'Erro na chamada',
  erro_execucao: 'Erro na execução',
};

async function evaluationRequest({ query = '', body } = {}) {
  const response = await fetch('/api/admin/avaliacao' + query, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(response.status === 403 ? 'Seu acesso expirou. Recarregue a página para entrar novamente.' : data.erro);
  }
  return data;
}

function CaseForm({ onAdd }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage('');
    try {
      const { caso } = await evaluationRequest({ body: { acao: 'adicionar', ...Object.fromEntries(new FormData(form)) } });
      onAdd(caso);
      form.reset();
      setMessage('Caso adicionado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPending(false);
    }
  }

  return <form className="evaluation-case-form" onSubmit={submit}>
    <div className="field">
      <label htmlFor="caso-entrada">Entrada</label>
      <textarea id="caso-entrada" name="entrada" rows={3} maxLength={CHAT_MESSAGE_LIMIT} required />
    </div>
    <div className="field">
      <label htmlFor="caso-esperado">Decisão esperada</label>
      <textarea id="caso-esperado" name="esperado" rows={3} maxLength={EVALUATION_TEXT_LIMIT} required />
    </div>
    <div className="field evaluation-case-reason">
      <label htmlFor="caso-motivo">Por que este caso está na lista</label>
      <input id="caso-motivo" name="motivo" maxLength={EVALUATION_REASON_LIMIT} required />
    </div>
    <div className="evaluation-actions">
      <button className="button button-primary" disabled={pending}>{pending ? 'Adicionando…' : 'Adicionar caso'}</button>
      {message && <span role="status">{message}</span>}
    </div>
  </form>;
}

function CaseResult({ result, roundId, onSave }) {
  const [passed, setPassed] = useState(result.passou);
  const [reason, setReason] = useState(result.motivo_marcacao);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const answered = result.estado === 'respondido';
  const suggestion = suggestedMark(result.esperado, result.decisao);
  const reasonId = 'marcacao-' + roundId + '-' + result.ordem;

  async function save(event) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      await evaluationRequest({ body: { acao: 'marcar', rodada: roundId, ordem: result.ordem, passou: passed, motivo: reason } });
      await onSave(roundId);
      setMessage('Marcação salva.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPending(false);
    }
  }

  return <form className="evaluation-result" aria-label={'Caso ' + result.ordem} onSubmit={save}>
    <div><h3>Entrada</h3><p className="evaluation-text">{result.entrada}</p><p className="evaluation-muted">{result.motivo_caso}</p></div>
    <div><h3>Esperado</h3><p className="evaluation-text">{result.esperado}</p></div>
    <div><h3>Resposta</h3>{answered ? <>
      <strong className="evaluation-decision">{result.decisao}</strong>
      <p className="evaluation-text">{result.resposta}</p>
    </> : <p className={result.estado.startsWith('erro') ? 'evaluation-error' : 'evaluation-muted'}>{resultLabels[result.estado]}</p>}</div>
    <div><h3>Tópicos consultados</h3>{result.consultados.length ? <ul>
      {result.consultados.map(topic => <li key={topic.id}><a href={topic.link} target="_blank" rel="noreferrer">{topic.titulo}</a></li>)}
    </ul> : <p className="evaluation-muted">{answered || result.estado.startsWith('erro') ? 'Nenhum tópico' : 'Aguardando'}</p>}</div>
    <fieldset className="evaluation-mark" disabled={!answered || pending}>
      <legend>Marcação</legend>
      {answered ? <>
        <label><input type="radio" name="passou" checked={passed === true} onChange={() => setPassed(true)} /> Passou</label>
        <label><input type="radio" name="passou" checked={passed === false} onChange={() => setPassed(false)} /> Não passou</label>
        {result.passou === null && suggestion !== null && <p className="evaluation-muted">Sugestão de marcação <strong>{suggestion ? 'Passou' : 'Não passou'}</strong></p>}
      </> : <p className="evaluation-muted">Indisponível</p>}
    </fieldset>
    <div className="field evaluation-mark-reason">
      <label htmlFor={reasonId}>Motivo da marcação</label>
      <input id={reasonId} value={reason} onChange={event => setReason(event.target.value)} disabled={!answered || pending} maxLength={EVALUATION_REASON_LIMIT} />
      {answered && <button className="button button-admin" disabled={pending || passed === null}>{pending ? 'Salvando…' : 'Salvar marcação'}</button>}
      {message && <p role="status">{message}</p>}
    </div>
  </form>;
}

export default function EvaluationPanel() {
  const [overview, setOverview] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [changes, setChanges] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [workerError, setWorkerError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [overviewRetry, setOverviewRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [workerRetry, setWorkerRetry] = useState(0);
  const selectedRef = useRef(null);
  const runRequests = useRef(new Map());
  const newRunId = useRef(null);
  const activeId = overview?.rodadas.find(round => !round.concluida_em)?.id;
  const latest = overview?.rodadas[0];

  const chooseRound = useCallback(id => {
    if (id === selectedRef.current) return;
    selectedRef.current = id;
    setSelected(id);
    setDetail(null);
    setDetailError('');
  }, []);

  const refreshRun = useCallback(async id => {
    const ticket = (runRequests.current.get(id) || 0) + 1;
    runRequests.current.set(id, ticket);
    const { rodada } = await evaluationRequest({ query: '?rodada=' + encodeURIComponent(id) });
    if (ticket === runRequests.current.get(id)) {
      setOverview(current => current && ({
        ...current,
        rodadas: current.rodadas.map(item => item.id === id ? roundSummary(rodada) : item),
      }));
      if (id === selectedRef.current) {
        setDetail(rodada);
        setDetailError('');
      }
    }
    return rodada;
  }, []);

  useEffect(() => {
    let active = true;
    evaluationRequest().then(data => {
      if (!active) return;
      setOverview(data);
      chooseRound(data.rodadas[0]?.id || null);
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [chooseRound, overviewRetry]);

  useEffect(() => {
    let active = true;
    if (selected) refreshRun(selected).catch(cause => { if (active) setDetailError(cause.message); });
    return () => { active = false; };
  }, [selected, refreshRun, detailRetry]);

  useEffect(() => {
    if (!activeId) return;
    let active = true;
    let timeout;

    async function next() {
      try {
        const { processado } = await evaluationRequest({ body: { acao: 'executar', rodada: activeId } });
        if (!active) return;
        const rodada = await refreshRun(activeId);
        if (active && !rodada.concluida_em) timeout = setTimeout(next, processado ? 0 : 1400);
      } catch (cause) {
        if (active) setWorkerError(cause.message);
      }
    }

    next();
    return () => { active = false; clearTimeout(timeout); };
  }, [activeId, refreshRun, workerRetry]);

  async function startRun(event) {
    event.preventDefault();
    setStarting(true);
    setError('');
    setWorkerError('');
    try {
      newRunId.current ??= crypto.randomUUID();
      const { id } = await evaluationRequest({ body: { acao: 'iniciar', rodada: newRunId.current, mudancas: changes } });
      const { rodada } = await evaluationRequest({ query: '?rodada=' + encodeURIComponent(id) });
      setOverview(current => ({
        ...current,
        rodadas: [roundSummary(rodada), ...current.rodadas.filter(item => item.id !== id)],
      }));
      chooseRound(id);
      setDetail(rodada);
      setChanges('');
      newRunId.current = null;
    } catch (cause) {
      setError(cause.message);
    } finally {
      setStarting(false);
    }
  }

  const pendingMarks = detail?.resultados.filter(result => result.estado === 'respondido' && result.passou === null).length || 0;
  const failedCases = detail?.resultados.filter(result => result.estado.startsWith('erro')).length || 0;

  return <main className="evaluation-layout">
    <section className="evaluation-overview" aria-labelledby="evaluation-title">
      <div>
        <h1 id="evaluation-title">Avaliação da IA</h1>
        <div className="evaluation-score">
          <span>Última rodada</span>
          {latest ? <><strong>{latest.passaram} de {latest.avaliados}</strong><span>casos passaram</span></> : <strong className="evaluation-score-empty">Nenhuma rodada</strong>}
        </div>
      </div>
      <form className="evaluation-start" onSubmit={startRun}>
        <div className="field">
          <label htmlFor="evaluation-changes">O que mudou desde a última rodada?</label>
          <textarea id="evaluation-changes" rows={3} maxLength={EVALUATION_TEXT_LIMIT} value={changes} onChange={event => setChanges(event.target.value)} />
        </div>
        <button className="button button-primary" disabled={starting || Boolean(activeId) || !overview?.casos.length}>
          {starting ? 'Iniciando…' : activeId ? 'Rodada em andamento' : 'Rodar avaliação'}
        </button>
      </form>
    </section>

    {error && <div className="evaluation-feedback" role="alert">{error}
      {!overview && <button className="text-button" onClick={() => { setError(''); setOverviewRetry(count => count + 1); }}>Tentar novamente</button>}
    </div>}
    {workerError && <div className="evaluation-feedback" role="alert">{workerError}
      <button className="text-button" onClick={() => { setWorkerError(''); setWorkerRetry(count => count + 1); }}>Retomar rodada</button>
    </div>}
    {!overview && !error && <p role="status">Carregando avaliação…</p>}

    {overview && <section className="admin-panel evaluation-cases" aria-labelledby="evaluation-cases">
      <div className="evaluation-section-title">
        <h2 id="evaluation-cases">Casos da rodada</h2>
        {detail && <span>{dateFormat.format(new Date(detail.criada_em))}</span>}
      </div>
      {detailError && <div className="evaluation-feedback" role="alert">{detailError}
        <button className="text-button" onClick={() => { setDetailError(''); setDetailRetry(count => count + 1); }}>Tentar novamente</button>
      </div>}
      {selected && !detail && !detailError && <p role="status">Carregando resultados…</p>}
      {detail && <>
        <p className="evaluation-muted" role="status">
          {detail.resultados.filter(result => ['respondido', 'erro_chamada', 'erro_execucao'].includes(result.estado)).length} de {detail.total} processados
          {' · '}{pendingMarks} aguardando marcação{' · '}{failedCases} com erro
        </p>
        {detail.resultados.map(result => <CaseResult key={detail.id + '-' + result.ordem} result={result} roundId={detail.id} onSave={refreshRun} />)}
      </>}
      {!selected && <p className="evaluation-muted">{overview.casos.length ? 'Rode uma avaliação para ver as respostas.' : 'Adicione o primeiro caso para começar.'}</p>}

      <details className="evaluation-library">
        <summary>Lista de casos ({overview.casos.length})</summary>
        {overview.casos.length ? <ul>
          {overview.casos.map(caso => <li key={caso.id}><strong className="evaluation-text">{caso.entrada}</strong><p className="evaluation-text">Esperado · {caso.esperado}</p><p className="evaluation-muted">{caso.motivo}</p></li>)}
        </ul> : <p className="evaluation-muted">A lista está vazia.</p>}
      </details>
      <details className="evaluation-library">
        <summary>Adicionar um caso</summary>
        <CaseForm onAdd={caso => setOverview(current => ({ ...current, casos: [...current.casos, caso] }))} />
      </details>
    </section>}

    {overview && <section className="admin-panel evaluation-history" aria-labelledby="evaluation-history">
      <h2 id="evaluation-history">Histórico de rodadas</h2>
      {!overview.rodadas.length ? <p className="evaluation-muted">Nenhuma rodada registrada.</p> : <ol>
        {overview.rodadas.map(round => <li key={round.id}>
          <button type="button" className="evaluation-history-item" aria-pressed={round.id === selected} onClick={() => chooseRound(round.id)}>
            <time dateTime={round.criada_em}>{dateFormat.format(new Date(round.criada_em))}</time>
            <strong>{round.passaram} de {round.avaliados} passaram</strong>
            <span className="evaluation-text">{round.mudancas || 'Sem anotação'}</span>
          </button>
        </li>)}
      </ol>}
    </section>}
  </main>;
}

function roundSummary({ resultados, ...summary }) {
  return summary;
}
