'use client';

import { useId, useState } from 'react';
import {
  EVALUATION_REASON_LIMIT, caseVersionLabel, evaluationRequest, formatEvaluationDate, instructionTypes, resultStatus, suggestedMark,
} from '../lib/avaliacao.mjs';

const filters = [
  ['todos', 'Todos os casos'],
  ['marcacao', 'Aguardando marcação'],
  ['passou', 'Passaram'],
  ['nao-passou', 'Não passaram'],
  ['erro', 'Com erro'],
];

function Status({ result }) {
  const status = resultStatus(result);
  return <span className="evaluation-status" data-state={status.key}>{status.label}</span>;
}

function CaseMark({ result, roundId, onSave, draft, onDraft }) {
  const reasonId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const suggestion = suggestedMark(result.esperado, result.decisao);

  function change(values) {
    onDraft({ ...draft, ...values });
    setSaved(false);
  }

  async function save(event) {
    event.preventDefault();
    if (pending || draft.passou === null) return;
    setPending(true);
    setError('');
    try {
      await evaluationRequest({ body: { acao: 'marcar', rodada: roundId, ordem: result.ordem, ...draft } });
      await onSave(roundId);
      setSaved(true);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setPending(false);
    }
  }

  return <form className="evaluation-review" onSubmit={save}>
    <fieldset disabled={pending} className="evaluation-mark">
      <legend>Marcação</legend>
      <div className="evaluation-mark-options">
        <label><input type="radio" name="passou" checked={draft.passou === true} onChange={() => change({ passou: true })} /> Passou</label>
        <label><input type="radio" name="passou" checked={draft.passou === false} onChange={() => change({ passou: false })} /> Não passou</label>
      </div>
      {result.passou === null && suggestion !== null && <p className="evaluation-muted">Sugestão de marcação <strong>{suggestion ? 'Passou' : 'Não passou'}</strong></p>}
      <div className="field">
        <label htmlFor={reasonId}>Motivo da marcação</label>
        <input id={reasonId} value={draft.motivo} onChange={event => change({ motivo: event.target.value })} maxLength={EVALUATION_REASON_LIMIT} />
      </div>
      <div className="evaluation-actions">
        <button className="button button-primary" type="submit" disabled={draft.passou === null}>
          {pending ? 'Salvando…' : 'Salvar marcação'}
        </button>
        {saved && <span className="evaluation-message" role="status">Marcação salva.</span>}
      </div>
      {error && <p className="evaluation-feedback" role="alert">{error}</p>}
    </fieldset>
  </form>;
}

export default function EvaluationResults({ round, caseOrder, cases, caseLink, historyLink, onSave }) {
  const [filter, setFilter] = useState('todos');
  const [drafts, setDrafts] = useState({});
  const visible = round.resultados.filter(result => filter === 'todos' || resultStatus(result).key === filter);
  const current = visible.find(result => result.ordem === caseOrder) || visible[0];
  const currentIndex = visible.indexOf(current);
  const previous = visible[currentIndex - 1];
  const next = visible[currentIndex + 1];
  const currentVersion = current && cases.find(caso => caso.id === current.caso_id)?.versao;
  const pendingMarks = round.resultados.filter(result => resultStatus(result).key === 'marcacao').length;
  const failures = round.resultados.filter(result => resultStatus(result).key === 'erro').length;

  return <section className="evaluation-results" aria-labelledby="evaluation-results-title">
    <div className="admin-panel evaluation-round-heading">
      <div>
        <a className="evaluation-back" {...historyLink}>Voltar ao histórico</a>
        <h2 id="evaluation-results-title">Rodada de {formatEvaluationDate(round.criada_em)}</h2>
        {round.mudancas && <p className="evaluation-muted evaluation-text">{round.mudancas}</p>}
      </div>
      <div className="evaluation-round-stats">
        <strong>{round.passaram} de {round.avaliados} passaram</strong>
        <span className="evaluation-muted">{pendingMarks} aguardando marcação · {failures} com erro</span>
      </div>
    </div>
    <div className="evaluation-results-layout">
      <aside className="admin-panel evaluation-result-list" aria-label="Casos da rodada">
        <div className="evaluation-section-title">
          <h3>Casos da rodada</h3>
          <span className="evaluation-muted">{visible.length} de {round.total}</span>
        </div>
        <div className="field evaluation-result-filter">
          <label htmlFor="evaluation-result-filter">Filtrar por status</label>
          <select id="evaluation-result-filter" value={filter} onChange={event => setFilter(event.target.value)}>
            {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {visible.length ? <ol>
          {visible.map(result => <li key={result.ordem}>
            <a {...caseLink(result.ordem)} className="evaluation-result-link" aria-current={result === current ? 'true' : undefined}>
              <span className="evaluation-case-number">{result.ordem}</span>
              <div><strong>{result.entrada}</strong><Status result={result} /></div>
            </a>
          </li>)}
        </ol> : <p className="evaluation-empty">Nenhum caso neste filtro.</p>}
      </aside>

      {current ? <article className="admin-panel evaluation-result-detail" aria-label={'Resultado do caso ' + current.ordem}>
        <header className="evaluation-detail-header">
          <div><h3>Caso {current.ordem}</h3><span className="evaluation-version">{caseVersionLabel(current.versao_caso)}</span></div>
          <Status result={current} />
        </header>
        {currentVersion > current.versao_caso && <p className="evaluation-version-note">Esta rodada usou a versão {current.versao_caso}. O caso está na versão {currentVersion}.</p>}
        <section className="evaluation-input">
          <h4>Entrada</h4>
          <p className="evaluation-text">{current.entrada}</p>
          {current.instrucao_detectada && <p className="evaluation-instruction">Possível instrução no texto · {instructionTypes[current.instrucao_detectada]}</p>}
          <p className="evaluation-muted evaluation-text">{current.motivo_caso}</p>
        </section>
        <div className="evaluation-comparison">
          <section>
            <h4>Esperado</h4>
            <p className="evaluation-text">{current.esperado}</p>
          </section>
          <section>
            <h4>Resposta</h4>
            {current.estado === 'respondido' ? <>
              <strong className="evaluation-decision">{current.decisao}</strong>
              <p className="evaluation-text">{current.resposta}</p>
            </> : <p className="evaluation-muted">{resultStatus(current).label}</p>}
          </section>
        </div>
        <details className="evaluation-consulted">
          <summary>Tópicos consultados ({current.consultados.length})</summary>
          {current.consultados.length ? <ul>
            {current.consultados.map(topic => <li key={topic.id}><a href={topic.link} target="_blank" rel="noreferrer">{topic.titulo}</a></li>)}
          </ul> : <p className="evaluation-muted">Nenhum tópico registrado.</p>}
        </details>
        {current.estado === 'respondido' && <CaseMark key={current.ordem} result={current} roundId={round.id} onSave={onSave}
          draft={drafts[current.ordem] || { passou: current.passou, motivo: current.motivo_marcacao }}
          onDraft={draft => setDrafts(old => ({ ...old, [current.ordem]: draft }))} />}
        <nav className="evaluation-result-navigation" aria-label="Navegação entre casos">
          <div>{previous && <a className="button button-admin" {...caseLink(previous.ordem)}>Anterior</a>}</div>
          <span className="evaluation-muted">{currentIndex + 1} de {visible.length}</span>
          <div>{next && <a className="button button-admin" {...caseLink(next.ordem)}>Próximo</a>}</div>
        </nav>
      </article> : <div className="admin-panel evaluation-empty">Escolha outro filtro para ver os resultados.</div>}
    </div>
  </section>;
}
