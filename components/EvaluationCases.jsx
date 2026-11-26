'use client';

import { useEffect, useId, useState } from 'react';
import { CHAT_MESSAGE_LIMIT } from '../lib/chat.mjs';
import {
  EVALUATION_REASON_LIMIT, EVALUATION_TEXT_LIMIT, caseVersionLabel, evaluationRequest, formatEvaluationDate,
} from '../lib/avaliacao.mjs';

const auditFields = [
  ['entrada', 'Entrada'],
  ['esperado', 'Decisão esperada'],
  ['motivo', 'Motivo de incluir o caso'],
];

function CaseForm({ caso, onSave, onCancel }) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    setError('');
    try {
      const body = caso
        ? { ...fields, acao: 'editar', caso: caso.id, versao: caso.versao }
        : { ...fields, acao: 'adicionar' };
      const result = await evaluationRequest({ body });
      onSave(result.caso);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="evaluation-case-editor" aria-label={caso ? 'Editar caso' : 'Adicionar caso'}>
    <fieldset disabled={pending} className="evaluation-case-form">
      <div className="field">
        <label htmlFor={id + '-entrada'}>Entrada</label>
        <textarea id={id + '-entrada'} name="entrada" defaultValue={caso?.entrada} rows={4} maxLength={CHAT_MESSAGE_LIMIT} required />
      </div>
      <div className="field">
        <label htmlFor={id + '-esperado'}>Decisão esperada</label>
        <textarea id={id + '-esperado'} name="esperado" defaultValue={caso?.esperado} rows={4} maxLength={EVALUATION_TEXT_LIMIT} required />
      </div>
      <div className="field evaluation-span">
        <label htmlFor={id + '-motivo'}>Motivo de incluir o caso</label>
        <input id={id + '-motivo'} name="motivo" defaultValue={caso?.motivo} maxLength={EVALUATION_REASON_LIMIT} required />
      </div>
      {caso && <div className="field evaluation-span">
        <label htmlFor={id + '-edicao'}>Por que é necessário editar este caso? (obrigatório)</label>
        <textarea id={id + '-edicao'} name="motivoEdicao" rows={2} maxLength={EVALUATION_REASON_LIMIT} required />
      </div>}
      {error && <p className="evaluation-feedback evaluation-span" role="alert">{error}</p>}
      <div className="evaluation-actions evaluation-span">
        <button className="button button-primary" type="submit">
          {pending ? 'Salvando…' : caso ? 'Salvar edição' : 'Adicionar caso'}
        </button>
        <button className="button button-admin" type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </fieldset>
  </form>;
}

function CaseHistory({ id, version }) {
  const [edits, setEdits] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    evaluationRequest({ query: '?caso=' + encodeURIComponent(id) }).then(({ edicoes }) => {
      if (current) {
        setEdits(edicoes);
        setError('');
      }
    }).catch(cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [id, version, retry]);

  if (error) return <div className="evaluation-feedback" role="alert">
    {error}
    <button className="text-button" onClick={() => { setError(''); setRetry(count => count + 1); }}>Tentar novamente</button>
  </div>;
  if (!edits) return <p className="evaluation-muted" role="status">Carregando edições…</p>;
  if (!edits.length) return <p className="evaluation-muted">Nenhuma edição registrada.</p>;

  return <ol className="evaluation-audit">
    {edits.map(edit => <li key={edit.versao}>
      <div className="evaluation-audit-heading">
        <strong>Versão {edit.versao}</strong>
        <time dateTime={edit.editado_em}>{formatEvaluationDate(edit.editado_em)}</time>
      </div>
      <p className="evaluation-muted evaluation-text">{edit.email_editor}</p>
      <p className="evaluation-text evaluation-audit-reason">{edit.motivo_edicao}</p>
      <dl className="evaluation-audit-changes">
        {auditFields.filter(([field]) => edit.anterior[field] !== edit.atualizado[field]).map(([field, label]) => <div key={field}>
          <dt>{label}</dt>
          <dd><span>Antes</span><p className="evaluation-text">{edit.anterior[field]}</p></dd>
          <dd><span>Depois</span><p className="evaluation-text">{edit.atualizado[field]}</p></dd>
        </div>)}
      </dl>
    </li>)}
  </ol>;
}

export default function EvaluationCases({ cases, onSave }) {
  const [editor, setEditor] = useState(null);
  const [message, setMessage] = useState('');

  function saved(caso) {
    onSave(caso);
    setEditor(null);
    setMessage(caso.versao === 1 ? 'Caso adicionado.' : 'Edição salva na versão ' + caso.versao + '.');
  }

  return <section className="admin-panel evaluation-cases" aria-labelledby="evaluation-cases">
    <div className="evaluation-section-title">
      <div><h2 id="evaluation-cases">Casos cadastrados</h2><p className="evaluation-muted">{cases.length} {cases.length === 1 ? 'caso' : 'casos'}</p></div>
      <button type="button" className="button button-primary" disabled={editor !== null} onClick={() => { setMessage(''); setEditor('novo'); }}>Adicionar caso</button>
    </div>
    {message && <p className="evaluation-message" role="status">{message}</p>}
    {editor === 'novo' && <CaseForm onSave={saved} onCancel={() => setEditor(null)} />}
    {!cases.length && editor !== 'novo' && <p className="evaluation-empty">Adicione o primeiro caso para iniciar uma rodada.</p>}
    <ul className="evaluation-case-library">
      {cases.map(caso => <li key={caso.id}>
        <div className="evaluation-case-heading">
          <div><span className="evaluation-version">{caseVersionLabel(caso.versao)}</span><h3 className="evaluation-text">{caso.entrada}</h3></div>
          <button type="button" className="button button-admin" disabled={editor !== null} onClick={() => { setMessage(''); setEditor(caso.id); }}>Editar</button>
        </div>
        {editor === caso.id ? <CaseForm key={caso.versao} caso={caso} onSave={saved} onCancel={() => setEditor(null)} /> : <>
          <div className="evaluation-case-meta">
            <div><h4>Decisão esperada</h4><p className="evaluation-text">{caso.esperado}</p></div>
            <div><h4>Motivo de incluir o caso</h4><p className="evaluation-text">{caso.motivo}</p></div>
          </div>
          {caso.versao > 1 && <CaseHistoryToggle caso={caso} />}
        </>}
      </li>)}
    </ul>
  </section>;
}

function CaseHistoryToggle({ caso }) {
  const [open, setOpen] = useState(false);
  return <details className="evaluation-audit-toggle" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Histórico de edições ({caso.versao - 1})</summary>
    {open && <CaseHistory id={caso.id} version={caso.versao} />}
  </details>;
}
