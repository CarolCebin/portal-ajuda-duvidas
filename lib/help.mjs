export const PAGE_SIZE = 10;
export const LIMITS = { nome: 100, email: 254, assunto: 150, descricao: 3000, busca: 200 };
export const OTHER_CATEGORY = 'Outros / Não sei informar';
export const emptyForm = () => ({ nome: '', email: '', categoria: '', assunto: '', descricao: '' });
export function normalize(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'); }
export function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => block.texto ?? block.itens?.join('\n') ?? '').join('\n');
}
export function searchTopics(topics, query) {
  const phrase = normalize(query.trim().slice(0, LIMITS.busca));
  if (!phrase) return [];
  return topics.filter(topic => normalize(topic.titulo).includes(phrase) || normalize(contentText(topic.conteudo)).includes(phrase));
}
export function paginate(items, page = 1) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  return { items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages, total: items.length };
}
export function validateForm(values, categories) {
  const errors = {};
  const labels = { nome: 'seu nome', email: 'seu e-mail', categoria: 'uma categoria', assunto: 'o assunto', descricao: 'sua dúvida' };
  for (const key of Object.keys(labels)) {
    const value = String(values[key] ?? '').trim();
    if (!value) errors[key] = `Informe ${labels[key]}.`;
    else if (LIMITS[key] && String(values[key]).length > LIMITS[key]) errors[key] = `Use no máximo ${LIMITS[key]} caracteres.`;
  }
  if (!errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = 'Informe um e-mail válido, como nome@exemplo.com.';
  if (!errors.categoria && values.categoria !== OTHER_CATEGORY && !categories.some(c => c.nome === values.categoria)) errors.categoria = 'Escolha uma das categorias disponíveis.';
  return errors;
}
export function validateData(data) {
  if (!data || !Array.isArray(data.categorias) || !Array.isArray(data.topicos)) throw new Error('Dados de conteúdo inválidos.');
  const catIds = new Set();
  const topicIds = new Set();
  for (const category of data.categorias) {
    if (!category || typeof category.id !== 'string' || !category.id || typeof category.nome !== 'string' || !category.nome.trim() || catIds.has(category.id)) throw new Error('Categoria inválida.');
    catIds.add(category.id);
  }
  for (const topic of data.topicos) {
    if (!topic || typeof topic.id !== 'string' || !topic.id || topicIds.has(topic.id) || !catIds.has(topic.categoriaId) || typeof topic.titulo !== 'string' || !topic.titulo.trim()) throw new Error('Tópico inválido.');
    if (topic.conteudo != null && typeof topic.conteudo !== 'string' && !Array.isArray(topic.conteudo)) throw new Error('Conteúdo inválido.');
    if (Array.isArray(topic.conteudo)) for (const block of topic.conteudo) {
      if (!block || !['paragrafo', 'titulo', 'lista', 'passos', 'imagem', 'video'].includes(block.tipo)) throw new Error('Bloco inválido.');
      if (['paragrafo', 'titulo'].includes(block.tipo) && typeof block.texto !== 'string') throw new Error('Texto inválido.');
      if (['lista', 'passos'].includes(block.tipo) && (!Array.isArray(block.itens) || block.itens.some(item => typeof item !== 'string'))) throw new Error('Lista inválida.');
      if (['imagem', 'video'].includes(block.tipo) && typeof block.url !== 'string') throw new Error('Mídia inválida.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(topic.atualizadoEm) || !Number.isFinite(Date.parse(topic.atualizadoEm)) || new Date(topic.atualizadoEm).toISOString().slice(0, 10) !== topic.atualizadoEm) throw new Error('Data inválida.');
    for (const key of ['imagens', 'videos']) if (topic[key] != null && (!Array.isArray(topic[key]) || topic[key].some(media => typeof media !== 'string' && (!media || typeof media.url !== 'string')))) throw new Error('Mídias inválidas.');
    topicIds.add(topic.id);
  }
  return data;
}
export function formatDate(value) { const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
export function parsePath(path) {
  let decoded;
  try { decoded = decodeURIComponent(path).replace(/\/+$/, '') || '/'; } catch { return { kind: 'unknown', path }; }
  if (decoded === '/') return { kind: 'home', path: '/' };
  if (decoded === '/busca') return { kind: 'search', path: '/busca', query: '', page: 1 };
  if (decoded === '/chat') return { kind: 'chat', path: '/chat' };
  if (decoded === '/suporte') return { kind: 'support', path: '/suporte' };
  const match = decoded.match(/^\/(categorias|topicos)\/([^/]+)$/);
  if (match) return { kind: match[1] === 'categorias' ? 'category' : 'topic', id: match[2], path, page: 1 };
  return { kind: 'unknown', path };
}
export function emailConfigured(config) {
  const email = config?.emailjs;
  return !!(email && ['serviceId','templateId','publicKey','supportEmail'].every(k => typeof email[k] === 'string' && email[k].trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.supportEmail.trim()));
}
export async function sendSupport(values, config, fetcher = fetch) {
  if (!emailConfigured(config)) throw new Error('O envio está indisponível no momento. Tente novamente mais tarde.');
  const clean = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ service_id: config.emailjs.serviceId, template_id: config.emailjs.templateId, user_id: config.emailjs.publicKey,
        template_params: { ...clean, reply_to: clean.email, to_email: config.emailjs.supportEmail.trim() } }),
    });
    if (!response.ok) throw new Error('Envio recusado.');
  } catch { throw new Error('O envio não foi concluído. Seus dados foram mantidos. Tente novamente.'); }
  finally { clearTimeout(timer); }
}
export function safeMediaUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value, 'https://local.invalid'); return ['http:', 'https:'].includes(url.protocol) ? value : null; } catch { return null; }
}
export function videoSource(value) {
  const safe = safeMediaUrl(value);
  if (!safe) return null;
  const url = new URL(safe, 'https://local.invalid');
  let id;
  if (['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)$/)?.[1];
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (['youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)) id = url.pathname.split('/embed/')[1];
  if (id && /^[\w-]{11}$/.test(id)) return { type: 'iframe', url: `https://www.youtube-nocookie.com/embed/${id}` };
  if (['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname)) {
    const vimeo = url.pathname.match(/\/(\d+)$/)?.[1];
    if (vimeo) return { type: 'iframe', url: `https://player.vimeo.com/video/${vimeo}` };
  }
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) return { type: 'video', url: safe };
  return { type: 'link', url: safe };
}
