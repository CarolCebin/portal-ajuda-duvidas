'use client';
import { useEffect, useRef, useState } from 'react';
import { CHAT_MESSAGE_LIMIT } from '../lib/chat.mjs';

export default function ChatPanel({ topics = [], navigate }) {
  const [view, setView] = useState({ sessao: null, mensagens: [] });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [limitNotice, setLimitNotice] = useState('');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const retry = useRef(null);
  const end = useRef(null);
  const session = view.sessao;
  const messages = view.mensagens || [];
  async function refresh(signal) {
    const response = await fetch('/api/chat', { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setView(result); retry.current = null;
  }
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).catch(e => { if (e.name !== 'AbortError') setError('Não foi possível abrir a conversa. Tente novamente.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session?.expiraEm) return;
    const expire = () => { setView(previous => ({ ...previous, sessao: null, mensagens: [] })); retry.current = null; setNotice('A conversa expirou. Você pode enviar uma nova mensagem.'); };
    const timer = setTimeout(expire, Math.max(0, new Date(session.expiraEm).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [session?.expiraEm]);
  useEffect(() => { if (messages.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages.length]);
  async function send(action, retryBody = null) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setNotice(''); setLimitNotice('');
    const body = retryBody || { acao: action, requestId: crypto.randomUUID(), sessaoId: session?.id, versao: session?.versao,
      ...(action === 'mensagem' ? { texto: text } : {}) };
    retry.current = body;
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      if (!response.ok) {
        if (result.limiteDiario) {
          retry.current = null;
          setLimitNotice(result.error);
          return;
        }
        if (result.expirada) { setView(previous => ({ ...previous, sessao: null, mensagens: [] })); retry.current = null; }
        if (response.status === 503 && result.disponivel === false) setView(previous => ({ ...previous, disponivel: false }));
        if (response.status === 409) { await refresh(); }
        throw new Error(result.error || 'Não foi possível concluir esta ação.');
      }
      setView(result); retry.current = null; setText('');
      if (result.resultado === 'encerrar') setNotice('Conversa encerrada e excluída. Você pode começar uma nova dúvida.');
      if (body.acao === 'suporte') navigate({ kind: 'support', path: '/suporte', origin: { kind: 'chat', path: '/chat' } });
    } catch (e) { setError(e.name === 'TimeoutError' || e.name === 'TypeError' ? 'Não foi possível confirmar o envio. Sua mensagem continua no campo.' : e.message); }
    finally { lock.current = false; setPending(false); }
  }
  const feedback = session?.estado === 'confirmacao';
  const support = session?.estado === 'encaminhado';
  const closed = session?.estado === 'encerrado';
  const inputDisabled = pending || loading || !view.disponivel;

  async function retryLastAction() {
    if (retry.current) {
      await send(retry.current.acao, retry.current);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await refresh();
    } catch {
      setError('Não foi possível atualizar a conversa. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return <section className="chat-panel" aria-label="Conversa com o assistente" aria-busy={pending || loading}>
    {notice && <p className="chat-notice" role="status">{notice}</p>}
    {limitNotice && <p className="chat-notice" role="alert">{limitNotice}</p>}
    {view.disponivel === false && <p className="chat-notice" role="status">O assistente está indisponível no momento. Você ainda pode consultar os tópicos da central.</p>}

    {!messages.length && view.disponivel !== false && <div className="chat-intro">
      <h2>Como funciona</h2>
      <p>Envie uma dúvida sobre o aplicativo. O assistente consulta a Central de Ajuda e inclui os links dos tópicos que usou.</p>
      <p>Se precisar de mais detalhes, ele pergunta aqui mesmo. Se não encontrar uma orientação, indica o formulário de suporte.</p>
    </div>}

    {messages.length > 0 && <div className="chat-messages" role="log" aria-label="Mensagens da conversa" aria-live="polite">
      {messages.map(message => <div key={message.id} className={'chat-bubble ' + (message.autor === 'usuario' ? 'chat-user' : 'chat-assistant')}>
        <span className="chat-author">{message.autor === 'usuario' ? 'Você' : 'Assistente'}</span>
        <p>{message.texto}</p>
        {message.links?.length > 0 && <ul className="chat-sources" aria-label="Tópicos utilizados">
          {message.links.map(({ id, href, titulo }) => {
            const title = topics.find(topic => topic.id === id)?.titulo || titulo;
            return <li key={id}>{title
              ? <a href={href} target="_blank" rel="noreferrer">{title} <span aria-label="abre em outra aba">↗</span></a>
              : <span>Tópico indisponível no momento.</span>}</li>;
          })}
        </ul>}
      </div>)}
      <div ref={end} />
    </div>}

    {feedback && <div className="chat-feedback" aria-label="A orientação resolveu sua dúvida?">
      <button className="button button-secondary" disabled={inputDisabled} onClick={() => send('resolveu')}>Resolveu</button>
      <button className="button button-secondary" disabled={inputDisabled} onClick={() => send('nao_resolveu')}>Não resolveu</button>
    </div>}

    {support && <div className="chat-handoff">
      <button className="button button-primary" disabled={pending} onClick={() => send('suporte')}>Abrir formulário de suporte</button>
    </div>}

    {!support && !closed && <form className="chat-composer" onSubmit={event => {
      event.preventDefault();
      if (!inputDisabled && text.trim()) send('mensagem');
    }}>
      <label htmlFor="chat-mensagem">Sua mensagem</label>
      <textarea id="chat-mensagem" value={text} onChange={event => setText(event.target.value)}
        placeholder={messages.length ? 'Escreva sua resposta' : 'Ex.: Como encontro um comprovante?'} aria-describedby="chat-privacy"
        maxLength={CHAT_MESSAGE_LIMIT} rows={3} disabled={inputDisabled} />
      <div className="chat-composer-footer">
        <p id="chat-privacy">As mensagens são enviadas ao Gemini, do Google. Evite compartilhar dados pessoais.</p>
        <button className="button button-primary" disabled={inputDisabled || !text.trim()} type="submit">
          {pending ? 'Enviando…' : 'Enviar'} <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>}

    {session && <div className="chat-session-actions">
      {(closed || support) && <button className="text-button" disabled={inputDisabled} onClick={() => send('nova')}>Nova conversa</button>}
      {!closed && <button className="text-button" disabled={pending} onClick={() => send('encerrar')}>Encerrar conversa</button>}
    </div>}

    {error && <div className="chat-error" role="alert">
      <p>{error}</p>
      <button className="button button-secondary" disabled={pending} onClick={retryLastAction}>Tentar novamente</button>
    </div>}
    {pending && <span className="sr-only" role="status">Processando sua mensagem.</span>}
  </section>;
}
