'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EVALUATION_TEXT_LIMIT, evaluationRequest, formatEvaluationDate } from '../lib/avaliacao.mjs';
import EvaluationCases from './EvaluationCases';
import EvaluationAlerts from './EvaluationAlerts';
import EvaluationResults from './EvaluationResults';
import CostsPanel from './CostsPanel';

const sections = [['resultados', 'Resultados'], ['casos', 'Casos'], ['historico', 'Histórico'], ['alertas', 'Alertas'], ['custos', 'Custos']];
const defaultLocation = { view: 'resultados', round: null, order: null };

function locationFromUrl() {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('aba');
  const round = query.get('rodada');
  const order = Number(query.get('caso'));
  return {
    view: sections.some(([id]) => view === id) ? view : defaultLocation.view,
    round: round || null,
    order: Number.isSafeInteger(order) && order > 0 ? order : null,
  };
}

function roundSummary({ resultados, ...summary }) {
  return summary;
}

function storeRound(overview, round) {
  if (!overview) return overview;
  const index = overview.rodadas.findIndex(item => item.id === round.id);
  if (index < 0) return { ...overview, rodadas: [round, ...overview.rodadas] };
  return { ...overview, rodadas: overview.rodadas.map(item => item.id === round.id ? round : item) };
}

function History({ rounds, link }) {
  return <section className="admin-panel evaluation-history" aria-labelledby="evaluation-history">
    <h2 id="evaluation-history">Histórico de rodadas</h2>
    {rounds.length ? <ol>
      {rounds.map(round => <li key={round.id}>
        <div className="evaluation-history-main">
          <time dateTime={round.criada_em}>{formatEvaluationDate(round.criada_em)}</time>
          <span className="evaluation-muted">{round.concluida_em ? 'Concluída' : 'Em andamento'} · {round.total} {round.total === 1 ? 'caso' : 'casos'}</span>
        </div>
        <p className="evaluation-text">{round.mudancas || 'Sem anotação'}</p>
        <div className="evaluation-history-action">
          <strong>{round.passaram} de {round.avaliados} passaram</strong>
          <a className="button button-admin" {...link({ view: 'resultados', round: round.id })}
            aria-label={'Ver resultados da rodada de ' + formatEvaluationDate(round.criada_em)}>Ver resultados</a>
        </div>
      </li>)}
    </ol> : <p className="evaluation-empty">Nenhuma rodada registrada.</p>}
  </section>;
}

export default function EvaluationPanel() {
  const [overview, setOverview] = useState(null);
  const [navigation, setNavigation] = useState(defaultLocation);
  const [details, setDetails] = useState({});
  const [changes, setChanges] = useState('');
  const [showStart, setShowStart] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState(null);
  const [workerError, setWorkerError] = useState('');
  const [overviewRetry, setOverviewRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [workerRetry, setWorkerRetry] = useState(0);
  const runRequests = useRef(new Map());
  const newRunId = useRef(null);
  const latest = overview?.rodadas[0];
  const activeRound = overview?.rodadas.find(round => !round.concluida_em);
  const activeId = activeRound?.id;
  const selectedId = navigation.view === 'resultados' ? navigation.round || latest?.id : null;
  const detail = details[selectedId];
  const loaded = Boolean(overview);

  useEffect(() => {
    const readUrl = () => setNavigation(locationFromUrl());
    readUrl();
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, []);

  const link = useCallback(({ view, round = null, order = null }) => {
    const query = new URLSearchParams();
    if (view !== 'resultados') query.set('aba', view);
    if (round) query.set('rodada', round);
    if (order) query.set('caso', order);
    const href = '/admin' + (query.size ? '?' + query : '');
    return {
      href,
      onClick(event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        const here = window.location.pathname + window.location.search;
        if (href !== here) window.history.pushState(null, '', href);
        setNavigation({ view, round, order });
      },
    };
  }, []);

  const openRound = useCallback(id => {
    window.history.pushState(null, '', '/admin?rodada=' + encodeURIComponent(id));
    setNavigation({ view: 'resultados', round: id, order: null });
  }, []);

  const refreshRun = useCallback(async id => {
    const ticket = (runRequests.current.get(id) || 0) + 1;
    runRequests.current.set(id, ticket);
    const { rodada } = await evaluationRequest({ query: '?rodada=' + encodeURIComponent(id) });
    if (ticket === runRequests.current.get(id)) {
      setOverview(current => storeRound(current, roundSummary(rodada)));
      setDetails(current => ({ ...current, [id]: rodada }));
      setDetailError(current => current?.id === id ? null : current);
    }
    return rodada;
  }, []);

  useEffect(() => {
    let current = true;
    evaluationRequest().then(data => {
      if (current) setOverview(data);
    }).catch(cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [overviewRetry]);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    refreshRun(selectedId).catch(cause => { if (current) setDetailError({ id: selectedId, message: cause.message }); });
    return () => { current = false; };
  }, [selectedId, refreshRun, detailRetry]);

  useEffect(() => {
    if (!loaded || activeId) return;
    let current = true;
    let checking = false;

    async function check() {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      try {
        const { rodada } = await evaluationRequest({ query: '?ativa=1' });
        if (current && rodada) {
          setOverview(previous => previous.rodadas.some(item => item.id === rodada.id) ? previous : storeRound(previous, rodada));
        }
      } catch {
        // A tentativa de iniciar uma rodada também verifica o bloqueio no servidor.
      } finally {
        checking = false;
      }
    }

    const interval = setInterval(check, 10000);
    window.addEventListener('focus', check);
    return () => { current = false; clearInterval(interval); window.removeEventListener('focus', check); };
  }, [loaded, activeId]);

  useEffect(() => {
    if (!activeId) return;
    let current = true;
    let timeout;

    async function next() {
      try {
        const { processado } = await evaluationRequest({ body: { acao: 'executar', rodada: activeId } });
        if (!current) return;
        const rodada = await refreshRun(activeId);
        if (current && !rodada.concluida_em) timeout = setTimeout(next, processado ? 0 : 1400);
      } catch (cause) {
        if (current) setWorkerError(cause.message);
      }
    }

    next();
    return () => { current = false; clearTimeout(timeout); };
  }, [activeId, refreshRun, workerRetry]);

  async function startRun(event) {
    event.preventDefault();
    if (starting || activeId) return;
    setStarting(true);
    setError('');
    setWorkerError('');
    try {
      newRunId.current ??= crypto.randomUUID();
      const { id } = await evaluationRequest({ body: { acao: 'iniciar', rodada: newRunId.current, mudancas: changes } });
      await refreshRun(id);
      setShowStart(false);
      setChanges('');
      newRunId.current = null;
      openRound(id);
    } catch (cause) {
      const other = cause.cause?.rodadaAtiva;
      setError(cause.message);
      if (other) {
        setShowStart(false);
        openRound(other);
        try { await refreshRun(other); } catch (loadError) { setError(loadError.message); }
      }
    } finally {
      setStarting(false);
    }
  }

  function saveCase(caso) {
    setOverview(current => ({
      ...current,
      casos: current.casos.some(item => item.id === caso.id)
        ? current.casos.map(item => item.id === caso.id ? caso : item)
        : [...current.casos, caso],
    }));
  }

  const showingCosts = navigation.view === 'custos';
  const processed = details[activeId]?.resultados.filter(result => result.estado === 'respondido' || result.estado.startsWith('erro')).length || 0;

  return <main className="evaluation-layout">
    <header className="evaluation-page-header">
      <div>
        <h1>{showingCosts ? 'Custos da IA' : 'Avaliação da IA'}</h1>
        {!showingCosts && <div className="evaluation-score">
          <span>Última rodada</span>
          {latest ? <strong>{latest.passaram} de {latest.avaliados} passaram</strong> : <strong>Nenhuma rodada</strong>}
        </div>}
      </div>
      {!showingCosts && <button type="button" className="button button-primary" disabled={starting || Boolean(activeId) || !overview?.casos.length}
        aria-describedby={activeId ? 'evaluation-running-text' : undefined} aria-expanded={showStart && !activeId} onClick={() => { setError(''); setShowStart(open => !open); }}>
        Rodar avaliação
      </button>}
    </header>

    {activeRound && <section className="evaluation-running" aria-label="Rodada em andamento">
      <div className="evaluation-running-header">
        <div role="status">
          <strong>Rodada em andamento</strong>
          <p id="evaluation-running-text">{processed} de {activeRound.total} {activeRound.total === 1 ? 'caso processado' : 'casos processados'}. Uma nova rodada poderá começar quando esta terminar.</p>
        </div>
        <a className="button button-admin" {...link({ view: 'resultados', round: activeId })}>Ver andamento</a>
      </div>
      <progress value={processed} max={activeRound.total} aria-label="Progresso da rodada" />
    </section>}
    {!showingCosts && showStart && !activeId && <form className="admin-panel evaluation-start" onSubmit={startRun}>
      <div className="field">
        <label htmlFor="evaluation-changes">O que mudou desde a última rodada?</label>
        <textarea id="evaluation-changes" rows={3} maxLength={EVALUATION_TEXT_LIMIT} value={changes} onChange={event => setChanges(event.target.value)} disabled={starting} />
      </div>
      <div className="evaluation-actions">
        <button type="submit" className="button button-primary" disabled={starting}>{starting ? 'Iniciando…' : 'Iniciar rodada'}</button>
        <button type="button" className="button button-admin" disabled={starting} onClick={() => setShowStart(false)}>Cancelar</button>
      </div>
    </form>}

    <nav className="evaluation-nav" aria-label="Administração">
      {sections.map(([id, label]) => <a key={id} {...link({ view: id })} aria-current={navigation.view === id ? 'page' : undefined}>{label}</a>)}
    </nav>

    {!showingCosts && error && <div className="evaluation-feedback" role="alert">{error}
      {!overview && <button className="text-button" onClick={() => { setError(''); setOverviewRetry(count => count + 1); }}>Tentar novamente</button>}
    </div>}
    {workerError && <div className="evaluation-feedback" role="alert">{workerError}
      <button className="text-button" onClick={() => { setWorkerError(''); setWorkerRetry(count => count + 1); }}>Retomar rodada</button>
    </div>}
    {!showingCosts && !overview && !error && <p role="status">Carregando avaliação…</p>}

    {showingCosts && <CostsPanel />}
    {overview && navigation.view === 'alertas' && <EvaluationAlerts />}
    {overview && navigation.view === 'casos' && <EvaluationCases cases={overview.casos} onSave={saveCase} />}
    {overview && navigation.view === 'historico' && <History rounds={overview.rodadas} link={link} />}
    {overview && navigation.view === 'resultados' && <>
      {detailError && detailError.id === selectedId && <div className="evaluation-feedback" role="alert">
        {detailError.message}
        <button className="text-button" onClick={() => { setDetailError(null); setDetailRetry(count => count + 1); }}>Tentar novamente</button>
      </div>}
      {selectedId && !detail && detailError?.id !== selectedId && <p role="status">Carregando resultados…</p>}
      {detail && <EvaluationResults key={detail.id} round={detail} caseOrder={navigation.order} cases={overview.casos}
        caseLink={order => link({ view: 'resultados', round: detail.id, order })} historyLink={link({ view: 'historico' })} onSave={refreshRun} />}
      {!selectedId && <section className="admin-panel evaluation-empty">
        <h2>Nenhuma rodada disponível</h2>
        {overview.casos.length ? <p>Use <strong>Rodar avaliação</strong> para ver os primeiros resultados.</p>
          : <a {...link({ view: 'casos' })}>Ir para casos cadastrados</a>}
      </section>}
    </>}
  </main>;
}
