'use client';

import ChatPanel from './ChatPanel';
import { useEffect, useRef, useState } from 'react';
import { contentText, emailConfigured, emptyForm, formatDate, LIMITS, OTHER_CATEGORY, paginate, parsePath, safeMediaUrl, searchTopics, sendSupport, validateData, validateForm, videoSource } from '../lib/help.mjs';

const HOME = { kind: 'home', path: '/' };
const ICONS = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  book: <><path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z" /></>,
  rocket: <><path d="M14 5c3-3 6-2 7-2 0 1 1 4-2 7l-7 7-5-5Z" /><circle cx="16" cy="8" r="1.5" /><path d="m7 12-4-1 3-5 6 1m0 10 1 4 5-3-1-6M7 17l-3 3m0-5-2 2m7 3-2 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 8V5l14-3v3m4 6h-6v5h6m-3-2.5h.1" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  tool: <><path d="M14 4a6 6 0 0 0-7 8L2 17a3 3 0 0 0 5 5l6-6a6 6 0 0 0 7-8l-4 4-4-4Z" /></>,
  file: <><path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
function Icon({ name, size = 22, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{ICONS[name] || ICONS.book}</svg>; }
function Loader({ children = 'Carregando conteúdo...' }) { return <div className="loading" role="status"><span className="spinner" />{children}</div>; }
function Notice({ title, children, error, action }) { return <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name="info" /><div><strong>{title}</strong>{children && <p>{children}</p>}{action}</div></div>; }
function Empty({ title, children, icon = 'search', action }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
function NavLink({ to, navigate, children, className, ...props }) {
  return <a href={to.path} className={className} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(to); } }} {...props}>{children}</a>;
}
function Search({ value, setValue, onSearch, compact }) {
  const [emptyError, setEmptyError] = useState(false);
  function submit(event) {
    event.preventDefault();
    const query = value.trim().slice(0, LIMITS.busca);
    if (!query) { setEmptyError(true); return; }
    setEmptyError(false); setValue(query); onSearch(query);
  }
  return <form className={`search-form ${compact ? 'search-compact' : ''}`} role="search" onSubmit={submit}>
    <label className="sr-only" htmlFor="global-search">Pesquisar em todos os tópicos</label>
    <div className="search-box"><Icon name="search" size={23} /><input id="global-search" type="search" value={value} maxLength={200} placeholder="Qual é a sua dúvida?" autoComplete="off" onChange={event => { setValue(event.target.value); setEmptyError(false); }} aria-describedby={emptyError ? 'search-error' : 'search-hint'} /><button className="button button-primary" type="submit">Buscar<Icon name="arrow" size={18} /></button></div>
    {emptyError ? <p id="search-error" className="search-help error-text" role="alert">Digite um texto para pesquisar.</p> : <p id="search-hint" className="search-help">Busque por uma palavra ou frase em todos os tópicos.</p>}
  </form>;
}
function Pagination({ data, route, navigate }) {
  if (!data.total) return null;
  return <nav className="pagination" aria-label="Paginação"><span>{(data.page - 1) * 10 + 1}–{Math.min(data.page * 10, data.total)} de {data.total} tópicos</span><div><button className="button button-page" disabled={data.page === 1} onClick={() => navigate({ ...route, page: data.page - 1 })}><Icon name="back" size={16} /><span>Anterior</span></button><span className="page-label" aria-current="page">Página <strong>{data.page}</strong> de {data.pages}</span><button className="button button-page" disabled={data.page === data.pages} onClick={() => navigate({ ...route, page: data.page + 1 })}><span>Próxima</span><Icon name="arrow" size={16} /></button></div></nav>;
}
function TopicList({ topics, categories, route, navigate, showCategory }) {
  const data = paginate(topics, route.page);
  return <><div className="topic-list">{data.items.map(topic => <NavLink key={topic.id} to={{ kind: 'topic', path: `/topicos/${encodeURIComponent(topic.id)}`, id: topic.id, origin: route }} navigate={navigate} className="topic-row"><span className="topic-file"><Icon name="file" /></span><span className="topic-row-text"><strong>{topic.titulo}</strong>{showCategory && <span>{categories.find(c => c.id === topic.categoriaId)?.nome}</span>}</span><Icon name="chevron" size={18} /></NavLink>)}</div><Pagination data={data} route={route} navigate={navigate} /></>;
}
function SupportCallout({ route, navigate }) { return <aside className="support-callout"><div className="callout-icon"><Icon name="mail" size={26} /></div><div><h2>Ainda precisa de ajuda?</h2><p>Conte sua dúvida para a nossa equipe.</p></div><NavLink className="button button-primary" to={{ kind: 'support', path: '/suporte', origin: route }} navigate={navigate}>Falar com o suporte<Icon name="arrow" size={18} /></NavLink></aside>; }
function Media({ item, video = false }) {
  const [failed, setFailed] = useState(false);
  const media = typeof item === 'string' ? { url: item } : item;
  const safe = safeMediaUrl(media?.url);
  if (!safe || failed) return <Notice title={video ? 'Não foi possível carregar este vídeo.' : 'Não foi possível carregar esta imagem.'}>O restante do conteúdo continua disponível.</Notice>;
  const source = video ? videoSource(safe) : null;
  return <figure className="topic-media">{!video ? <img src={safe} alt={media.alt || media.legenda || 'Ilustração do tópico'} loading="lazy" onError={() => setFailed(true)} /> : source.type === 'video' ? <video controls preload="metadata" onError={() => setFailed(true)} aria-label={media.titulo || 'Vídeo do tópico'}><source src={source.url} />Seu navegador não reproduz este vídeo. <a href={source.url}>Abrir vídeo</a></video> : source.type === 'iframe' ? <><iframe src={source.url} title={media.titulo || 'Vídeo do tópico'} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} /><a className="media-fallback" href={safe} target="_blank" rel="noreferrer">Se o vídeo não carregar, abra em outra aba ↗</a></> : <a href={source.url} target="_blank" rel="noreferrer">Abrir vídeo: {media.titulo || 'conteúdo complementar'} ↗</a>}{media.legenda && <figcaption>{media.legenda}</figcaption>}</figure>;
}
function TopicContent({ topic }) {
  const hasText = !!contentText(topic.conteudo).trim();
  const hasMedia = topic.imagens?.length || topic.videos?.length || (Array.isArray(topic.conteudo) && topic.conteudo.some(b => ['imagem','video'].includes(b.tipo)));
  if (!hasText && !hasMedia) return <Empty title="Conteúdo indisponível." icon="file">O conteúdo deste tópico ainda não está disponível.</Empty>;
  return <div className="article-content">{typeof topic.conteudo === 'string' ? <div className="preserve-text">{topic.conteudo}</div> : topic.conteudo?.map((block, i) => {
    if (block.tipo === 'titulo') return <h2 key={i}>{block.texto}</h2>;
    if (block.tipo === 'paragrafo') return <p className="preserve-text" key={i}>{block.texto}</p>;
    if (block.tipo === 'lista') return <ul key={i}>{block.itens.map((text, j) => <li key={j}>{text}</li>)}</ul>;
    if (block.tipo === 'passos') return <ol key={i}>{block.itens.map((text, j) => <li key={j}>{text}</li>)}</ol>;
    return <Media key={i} item={block} video={block.tipo === 'video'} />;
  })}{topic.imagens?.map((item, i) => <Media key={`image-${i}`} item={item} />)}{topic.videos?.map((item, i) => <Media key={`video-${i}`} item={item} video />)}</div>;
}
function SupportForm({ form, setForm, categories, config, configStatus, retryConfig, status, setStatus }) {
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const formRef = useRef(null);
  const fields = [ ['nome','Nome completo','Como podemos chamar você?','text'], ['email','E-mail','nome@exemplo.com','email'], ['categoria','Categoria','','select'], ['assunto','Assunto','Resuma sua dúvida','text'], ['descricao','Descrição da dúvida','Conte o que aconteceu e como podemos ajudar.','textarea'] ];
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    const found = validateForm(form, categories);
    setErrors(found); setMessage('');
    if (Object.keys(found).length) {
      setStatus('invalid');
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!emailConfigured(config)) { setStatus('error'); setMessage('O envio está indisponível no momento. Seus dados foram mantidos. Tente novamente mais tarde.'); return; }
    lock.current = true; setStatus('sending');
    try { await sendSupport(form, config); setForm(emptyForm()); setStatus('success'); setMessage('Solicitação enviada com sucesso.'); }
    catch (error) { setStatus('error'); setMessage(error.message); }
    finally { lock.current = false; }
  }
  const pending = status === 'sending';
  return <form ref={formRef} className="support-form" noValidate onSubmit={submit}>
    <div className="form-intro"><h2>Como podemos ajudar?</h2><p>Preencha os campos abaixo. A resposta será enviada para o seu e-mail.</p><span>Todos os campos são obrigatórios.</span></div>
    {configStatus === 'loading' ? <Loader>Verificando disponibilidade do envio...</Loader> : !emailConfigured(config) && <Notice title="Envio de solicitações indisponível no momento.">Você pode preencher o formulário e tentar novamente mais tarde.{configStatus === 'error' && <button className="text-button" type="button" onClick={retryConfig}>Verificar novamente</button>}</Notice>}
    <fieldset disabled={pending} className="form-fields"><legend className="sr-only">Dados da solicitação</legend>{fields.map(([key,label,placeholder,type]) => {
      const props = { id: `field-${key}`, name: key, value: form[key], required: true, 'aria-invalid': !!errors[key], 'aria-describedby': `${key}-hint${errors[key] ? ` ${key}-error` : ''}`, onChange: event => { setForm({ ...form, [key]: event.target.value }); setErrors(old => ({ ...old, [key]: undefined })); if (status !== 'idle') { setStatus('idle'); setMessage(''); } } };
      return <div className={`field field-${key}`} key={key}><label htmlFor={props.id}>{label}</label>{type === 'select' ? <select {...props}><option value="">Selecione uma categoria</option>{categories.map(category => <option key={category.id} value={category.nome}>{category.nome}</option>)}<option value={OTHER_CATEGORY}>{OTHER_CATEGORY}</option></select> : type === 'textarea' ? <textarea {...props} placeholder={placeholder} maxLength={LIMITS[key]} rows={6} /> : <input {...props} type={type} placeholder={placeholder} maxLength={LIMITS[key]} autoComplete={key === 'nome' ? 'name' : key === 'email' ? 'email' : 'off'} />}<div className="field-helper"><span id={`${key}-hint`}>{key === 'email' ? 'Usaremos este e-mail para responder.' : key === 'categoria' ? 'Escolha a opção mais próxima da sua dúvida.' : ''}</span>{key !== 'categoria' && <span>{form[key].length}/{LIMITS[key]}</span>}</div>{errors[key] && <p className="field-error" id={`${key}-error`} role="alert">{errors[key]}</p>}</div>;
    })}</fieldset>
    {status === 'success' && <div className="success-message" role="status"><Icon name="check" /><div><strong>{message || 'Solicitação enviada com sucesso.'}</strong><p>Acompanhe a resposta no seu e-mail.</p></div></div>}
    {status === 'error' && <Notice title={message || 'O envio não foi concluído. Seus dados foram mantidos.'} error />}
    <div className="form-bottom"><span><Icon name="shield" size={17} />Não informe senhas ou dados de cartão.</span><button type="submit" className="button button-primary" disabled={pending || configStatus === 'loading'}>{pending ? <><span className="spinner" />Enviando solicitação...</> : <>Enviar solicitação<Icon name="arrow" size={18} /></>}</button></div>
    {pending && <span role="status" className="sr-only">Enviando solicitação...</span>}
  </form>;
}

export default function HelpCenter({ showAdmin = false }) {
  const [route, setRoute] = useState(null);
  const [search, setSearch] = useState('');
  const [resource, setResource] = useState({ status: 'loading', data: null });
  const [reload, setReload] = useState(0);
  const [config, setConfig] = useState(null);
  const [configStatus, setConfigStatus] = useState('loading');
  const [configReload, setConfigReload] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [formStatus, setFormStatus] = useState('idle');
  const [results, setResults] = useState({ status: 'empty', topics: [], token: null });
  const entries = useRef(new Map());
  const tracked = useRef(new Set());
  const mounted = useRef(false);
  const heading = useRef(null);
  function open(next, push = true) {
    const key = crypto.randomUUID();
    const entry = { ...next, key };
    entries.current.set(key, entry);
    if (push) window.history.pushState({ helpKey: key }, '', next.path);
    setRoute(entry);
    if (next.kind === 'search') setSearch(next.query || '');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navigate(next) {
    if (formStatus === 'sending') return;
    open(next);
  }
  useEffect(() => {
    const key = crypto.randomUUID();
    const initial = { ...parsePath(window.location.pathname), key };
    entries.current.set(key, initial);
    window.history.replaceState({ helpKey: key }, '', window.location.pathname);
    setRoute(initial);
    function pop(event) { const next = entries.current.get(event.state?.helpKey) || parsePath(window.location.pathname); open(next, false); }
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!route) return;
    if (mounted.current) heading.current?.focus({ preventScroll: true });
    mounted.current = true;
  }, [route?.key]);
  useEffect(() => {
    const controller = new AbortController();
    setResource({ status: 'loading', data: null });
    fetch('/api/conteudo', { cache: 'no-store', signal: controller.signal }).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => setResource({ status: 'success', data: validateData(data) })).catch(error => { if (error.name !== 'AbortError') setResource({ status: 'error', data: null }); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    setConfigStatus('loading');
    fetch('/config.json', { cache: 'no-store', signal: controller.signal }).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => { setConfig(data); setConfigStatus('success'); }).catch(error => { if (error.name !== 'AbortError') { setConfig(null); setConfigStatus('error'); } });
    return () => controller.abort();
  }, [configReload]);
  useEffect(() => {
    if (route?.kind !== 'search' || !route.query) { setResults({ status: 'empty', topics: [], token: route?.key }); return; }
    if (resource.status !== 'success') { setResults({ status: resource.status, topics: [], token: route.key }); return; }
    setResults({ status: 'loading', topics: [], token: route.key });
    try { setResults({ status: 'success', topics: searchTopics(resource.data.topicos, route.query), token: route.key }); }
    catch { setResults({ status: 'error', topics: [], token: route.key }); }
  }, [route?.key, resource]);
  const data = resource.data;
  const category = data?.categorias.find(item => item.id === route?.id);
  const topic = data?.topicos.find(item => item.id === route?.id);
  useEffect(() => {
    if (route?.kind !== 'topic' || !topic || !/^G-[A-Z0-9]+$/.test(config?.analytics?.measurementId || '') || tracked.current.has(route.key)) return;
    try {
      const id = config.analytics.measurementId;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      if (!document.getElementById('help-analytics')) {
        window.gtag('js', new Date());
        window.gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
        const script = document.createElement('script'); script.id = 'help-analytics'; script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`; document.head.append(script);
      }
      tracked.current.add(route.key);
      window.gtag('event', 'tópico_visualizado', { topico_id: topic.id, send_to: id });
    } catch { /* Analytics nunca impede a leitura. */ }
  }, [route?.key, route?.kind, topic, config]);
  const home = !route || route.kind === 'home';
  const support = route?.kind === 'support';
  const chat = route?.kind === 'chat';
  const searchProps = { value: search, setValue: setSearch, onSearch: query => navigate({ kind: 'search', path: '/busca', query, page: 1 }) };
  const origin = route?.origin || HOME;
  const retry = <button className="button button-secondary retry" onClick={() => setReload(value => value + 1)}>Tentar novamente</button>;
  const searchPending = route?.kind === 'search' && route.query && (results.token !== route.key || results.status === 'loading');
  let title = chat ? 'Assistente da Central de Ajuda' : home ? 'Como podemos ajudar você?' : route.kind === 'category' ? category?.nome || 'Tópicos da categoria' : route.kind === 'search' ? 'Resultados da busca' : route.kind === 'topic' ? topic?.titulo || 'Detalhamento do tópico' : support ? 'Fale com o suporte' : 'Página não encontrada';
  useEffect(() => { document.title = `${title} | Central de Ajuda`; }, [title]);
  function body() {
    if (!route) return <Loader />;
    if (route.kind === 'unknown') return <Empty title="Esta página não foi encontrada." icon="file" action={<NavLink to={HOME} navigate={navigate} className="button button-primary">Voltar às categorias</NavLink>}>Explore as categorias para encontrar o que precisa.</Empty>;
    if (support && resource.status === 'loading') return <Loader>Carregando o formulário...</Loader>;
    if (support && resource.status === 'error') return <Notice error title="Não foi possível carregar as categorias do formulário." action={retry}>Seus dados foram mantidos. Tente novamente.</Notice>;
    if (chat) return <ChatPanel topics={data?.topicos || []} navigate={navigate} />;
    if (support) return <SupportForm form={form} setForm={setForm} categories={data?.categorias || []} config={config} configStatus={configStatus} retryConfig={() => setConfigReload(x => x + 1)} status={formStatus} setStatus={setFormStatus} />;
    if (resource.status === 'loading') return <Loader>{route.kind === 'search' ? 'Pesquisando tópicos...' : 'Carregando conteúdo...'}</Loader>;
    if (resource.status === 'error') return <Notice error title={home ? 'Não foi possível carregar as categorias.' : route.kind === 'category' ? 'Não foi possível carregar a listagem.' : route.kind === 'search' ? 'Não foi possível concluir a pesquisa.' : 'Não foi possível carregar o tópico.'} action={retry}>Tente novamente em alguns instantes.</Notice>;
    if (home) return <><aside className="chat-entry"><div><h2>Assistente da Central de Ajuda</h2><p>Tire dúvidas sobre o aplicativo.</p></div><NavLink className="button button-primary" to={{ kind: 'chat', path: '/chat' }} navigate={navigate}>Conversar com o assistente<Icon name="arrow" size={18} /></NavLink></aside><div className="section-heading"><div><span className="eyebrow">ENCONTRE SEU CAMINHO</span><h2>Explore por categoria</h2><p>Escolha um assunto e encontre as orientações que precisa.</p></div><span className="count-tag">{data.categorias.length} categorias</span></div>{!data.categorias.length ? <Empty title="Nenhuma categoria disponível." icon="book">Use a busca para procurar um tópico.</Empty> : <div className="category-grid">{data.categorias.map((item, index) => { const count = data.topicos.filter(t => t.categoriaId === item.id).length; return <NavLink to={{ kind: 'category', path: `/categorias/${encodeURIComponent(item.id)}`, id: item.id, page: 1 }} navigate={navigate} className="category-card" key={item.id}><span className={`category-icon tone-${index % 6}`}><Icon name={item.icone || ['rocket','user','wallet','shield','grid','tool'][index % 6]} size={25} /></span><h3>{item.nome}</h3>{item.descricao && <p>{item.descricao}</p>}<div className="category-card-bottom"><span>{count} {count === 1 ? 'tópico' : 'tópicos'}</span><Icon name="arrow" size={20} /></div></NavLink>; })}</div>}<div className="home-note"><Icon name="book" size={23} /><div><strong>As respostas estão por aqui.</strong><span>Explore os tópicos ou use a busca para encontrar uma orientação.</span></div></div></>;
    if (route.kind === 'category') {
      if (!category) return <Notice error title="Categoria não encontrada.">Volte às categorias e escolha um assunto disponível.</Notice>;
      const topics = data.topicos.filter(item => item.categoriaId === category.id);
      return <><div className="list-heading"><span>{topics.length} {topics.length === 1 ? 'tópico nesta categoria' : 'tópicos nesta categoria'}</span><span>Orientações passo a passo</span></div>{topics.length ? <TopicList topics={topics} categories={data.categorias} route={route} navigate={navigate} /> : <Empty title="Esta categoria ainda não possui tópicos." icon="book">Você pode pesquisar em todos os tópicos usando a busca acima.</Empty>}</>;
    }
    if (route.kind === 'search') {
      if (!route.query) return <Empty title="O que você está procurando?">Digite um texto no campo de busca para encontrar orientações.</Empty>;
      if (searchPending) return <Loader>Pesquisando tópicos...</Loader>;
      if (results.status === 'error') return <Notice error title="Não foi possível concluir a pesquisa." action={retry}>O texto pesquisado foi mantido. Tente novamente.</Notice>;
      if (!results.topics.length) return <><Empty title="Nenhum tópico encontrado.">Não encontramos resultados para “{route.query}”. Tente outra palavra ou conte sua dúvida para a nossa equipe.</Empty><SupportCallout route={route} navigate={navigate} /></>;
      return <><div className="list-heading"><span><strong>{results.topics.length}</strong> {results.topics.length === 1 ? 'resultado' : 'resultados'} para <strong>“{route.query}”</strong></span><span>Todas as categorias</span></div><TopicList topics={results.topics} categories={data.categorias} route={route} navigate={navigate} showCategory /></>;
    }
    if (route.kind === 'topic') {
      if (!topic) return <Notice error title="Tópico não encontrado.">Use a navegação acima para voltar à sua listagem.</Notice>;
      return <><article className="article-panel"><div className="article-meta"><span className="category-label">{data.categorias.find(c => c.id === topic.categoriaId)?.nome}</span><span><Icon name="clock" size={15} />Atualizado em {formatDate(topic.atualizadoEm)}</span></div><TopicContent key={topic.id} topic={topic} /></article><SupportCallout route={route} navigate={navigate} /></>;
    }
  }
  return <div className="app-shell"><a className="skip-link" href="#main">Pular para o conteúdo</a><header className="site-header"><div className="header-inner"><NavLink to={HOME} navigate={navigate} className="brand" aria-label="Central de Ajuda, início"><span className="brand-symbol"><Icon name="book" size={24} /></span><span>aplicativo<span className="brand-divider" /><span className="brand-label">Central de Ajuda</span></span></NavLink><div className="header-actions"><span className="header-note"><span className="status-dot" />Sua ajuda, sempre por perto</span>{showAdmin && <a className="button button-admin" href="/admin">Administração</a>}</div></div></header><main id="main">
    {home ? <section className="hero"><div className="hero-decoration deco-one" /><div className="hero-decoration deco-two" /><div className="hero-inner"><span className="hero-badge"><Icon name="book" size={15} />CENTRAL DE AJUDA</span><h1 tabIndex={-1} ref={heading}>{title}</h1><p>Respostas simples para aproveitar melhor o aplicativo.<br className="desktop-break" />Encontre dicas, tutoriais e soluções em um só lugar.</p><Search {...searchProps} />{data?.demonstracao && <span className="demo-note">Ambiente de demonstração · Conteúdos fictícios</span>}</div></section> : <section className={`page-top ${route?.kind === 'topic' ? 'topic-top' : ''}`}><div className="content-width"><NavLink to={route?.kind === 'topic' || support ? origin : HOME} navigate={navigate} className={`back-link ${formStatus === 'sending' ? 'disabled-link' : ''}`}><Icon name="back" size={17} />{route?.kind === 'topic' && route.origin ? 'Voltar à listagem' : support && route.origin ? 'Voltar à tela anterior' : 'Voltar às categorias'}</NavLink><div className="page-title-row"><div>{!chat && <span className="eyebrow">{support ? 'ESTAMOS AQUI PARA AJUDAR' : route?.kind === 'topic' ? 'GUIA E ORIENTAÇÕES' : 'CENTRAL DE AJUDA'}</span>}<h1 tabIndex={-1} ref={heading}>{title}</h1>{route?.kind === 'category' && category?.descricao && <p>{category.descricao}</p>}{support && <p>Conte com a gente para encontrar uma solução.</p>}</div>{route?.kind === 'category' && <span className="page-category-icon"><Icon name={category?.icone || 'book'} size={34} /></span>}</div>{!support && !chat && <Search {...searchProps} compact />}{!chat && data?.demonstracao && <span className="demo-note">Conteúdos fictícios para demonstração</span>}</div></section>}
    <section className={`main-content content-width ${home ? 'home-content' : ''} ${support || chat || route?.kind === 'topic' ? 'narrow-content' : ''}`} aria-busy={(!chat && resource.status === 'loading') || !!searchPending}>{body()}</section>
  </main><footer className="site-footer"><div className="footer-inner"><span className="footer-brand"><Icon name="book" size={18} />Central de Ajuda</span><span>Um caminho mais simples para encontrar respostas.</span><span>Aplicativo · {new Date().getFullYear()}</span></div></footer></div>;
}
