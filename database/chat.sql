-- Estrutura do chat de demonstração. Aplicada via Supabase MCP e registrada no histórico remoto.
create table public.sessoes_chat (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  estado text not null default 'ativa' check (estado in ('ativa','esclarecimento','confirmacao','encaminhado')),
  tentativas integer not null default 0 check (tentativas between 0 and 3),
  versao integer not null default 0 check (versao >= 0),
  cenario text not null check (cenario in ('orientacao','esclarecimento','limite','sem_conteudo','contradicao')),
  topico_id text references public.topicos(id) on delete set null,
  ultimo_request uuid,
  criado_em timestamptz not null default now(),
  ultima_atividade timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '30 minutes')
);
create index sessoes_chat_expira_idx on public.sessoes_chat(expira_em);
create index sessoes_chat_topico_idx on public.sessoes_chat(topico_id);
create table public.mensagens_chat (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references public.sessoes_chat(id) on delete cascade,
  ordem integer not null check (ordem >= 0),
  autor text not null check (autor in ('usuario','assistente')),
  tipo text not null check (tipo in ('mensagem','esclarecer','orientar','encaminhar')),
  texto text not null check (length(texto) between 1 and 20000),
  fontes text[] not null default '{}',
  criado_em timestamptz not null default now(),
  unique(sessao_id,ordem)
);
alter table public.sessoes_chat enable row level security;
alter table public.mensagens_chat enable row level security;
revoke all on public.sessoes_chat,public.mensagens_chat from public,anon,authenticated;
grant select,insert,update,delete on public.sessoes_chat,public.mensagens_chat to service_role;

create function public.chat_estado(p_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('sessao', jsonb_build_object(
    'id',s.id,'estado',s.estado,'tentativas',s.tentativas,'versao',s.versao,
    'cenario',s.cenario,'topicoId',s.topico_id,'expiraEm',s.expira_em),
    'mensagens',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'autor',m.autor,'tipo',m.tipo,'texto',m.texto,'fontes',m.fontes) order by m.ordem)
      from public.mensagens_chat m where m.sessao_id=s.id),'[]'::jsonb))
  from public.sessoes_chat s where s.id=p_id and s.expira_em > now();
$$;
revoke all on function public.chat_estado(uuid) from public,anon,authenticated;
grant execute on function public.chat_estado(uuid) to service_role;

-- Somente o servidor chama esta operação. Bloqueio por visitante serializa criar/encerrar/reiniciar.
create function public.chat_operar(p_hash text,p_acao text,p_request uuid default null,
  p_sessao uuid default null,p_versao integer default null,p_dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.sessoes_chat%rowtype; v_tipo text; v_texto text; v_fontes text[]; v_count integer;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'CHAT_INVALIDO'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_hash,0));
  select * into s from public.sessoes_chat where token_hash=p_hash for update;
  if found and s.expira_em <= clock_timestamp() then
    delete from public.sessoes_chat where id=s.id;
    s := null;
  end if;
  if p_acao='consultar' then
    return coalesce(public.chat_estado(s.id),jsonb_build_object('sessao',null,'mensagens','[]'::jsonb));
  end if;
  if p_request is null then raise exception 'CHAT_INVALIDO'; end if;
  if s.id is not null and s.ultimo_request=p_request then return public.chat_estado(s.id); end if;
  if p_acao='iniciar' then
    if s.id is not null then return public.chat_estado(s.id); end if;
  else
    if s.id is null then
      if p_acao in ('encerrar','suporte','resolveu') then return jsonb_build_object('sessao',null,'mensagens','[]'::jsonb,'resultado',p_acao); end if;
      return jsonb_build_object('erro','expirada');
    end if;
    if s.id is distinct from p_sessao or s.versao is distinct from p_versao then return jsonb_build_object('erro','conflito'); end if;
  end if;
  if p_acao in ('iniciar','nova') then
    if p_dados->>'cenario' is null or p_dados->>'cenario' not in ('orientacao','esclarecimento','limite','sem_conteudo','contradicao') then raise exception 'CHAT_INVALIDO'; end if;
    if p_dados->>'topicoId' is not null and not exists(select 1 from public.topicos t join public.categorias c on c.id=t.categoria_id where t.id=p_dados->>'topicoId' and t.status='ativo' and c.status='ativo') then raise exception 'CHAT_FONTE_INVALIDA'; end if;
    if s.id is not null then delete from public.sessoes_chat where id=s.id; end if;
    insert into public.sessoes_chat(token_hash,cenario,topico_id,ultimo_request)
      values(p_hash,p_dados->>'cenario',p_dados->>'topicoId',p_request) returning * into s;
    return public.chat_estado(s.id);
  end if;
  if p_acao in ('resolveu','encerrar','suporte') then
    if p_acao='resolveu' and s.estado<>'confirmacao' then return jsonb_build_object('erro','estado'); end if;
    delete from public.sessoes_chat where id=s.id;
    return jsonb_build_object('sessao',null,'mensagens','[]'::jsonb,'resultado',p_acao);
  end if;
  if p_acao not in ('mensagem','nao_resolveu') then raise exception 'CHAT_INVALIDO'; end if;
  if s.estado='encaminhado' then return jsonb_build_object('erro','estado'); end if;
  if p_acao='nao_resolveu' and s.estado<>'confirmacao' then return jsonb_build_object('erro','estado'); end if;
  if length(coalesce(p_dados->>'usuario','')) not between 1 and 2000 then raise exception 'CHAT_INVALIDO'; end if;
  v_tipo:=p_dados->>'tipo'; v_texto:=p_dados->>'texto';
  select coalesce(array_agg(x),'{}') into v_fontes from jsonb_array_elements_text(coalesce(p_dados->'fontes','[]')) x;
  if v_tipo is null or v_tipo not in ('orientar','esclarecer','encaminhar') or length(coalesce(v_texto,'')) not between 1 and 20000 then raise exception 'CHAT_INVALIDO'; end if;
  if (p_acao='nao_resolveu' or s.tentativas>=3 or s.estado='confirmacao') and v_tipo<>'encaminhar' then return jsonb_build_object('erro','limite'); end if;
  if v_tipo='orientar' then
    if cardinality(v_fontes)=0 then raise exception 'CHAT_FONTE_INVALIDA'; end if;
    select count(distinct t.id) into v_count from public.topicos t join public.categorias c on c.id=t.categoria_id
      where t.id=any(v_fontes) and t.status='ativo' and c.status='ativo';
    if v_count<>cardinality(v_fontes) then raise exception 'CHAT_FONTE_INVALIDA'; end if;
  elsif cardinality(v_fontes)<>0 then raise exception 'CHAT_FONTE_INVALIDA'; end if;
  insert into public.mensagens_chat(sessao_id,ordem,autor,tipo,texto)
    values(s.id,s.versao*2,'usuario','mensagem',p_dados->>'usuario');
  insert into public.mensagens_chat(sessao_id,ordem,autor,tipo,texto,fontes)
    values(s.id,s.versao*2+1,'assistente',v_tipo,v_texto,v_fontes);
  update public.sessoes_chat set tentativas=tentativas+case when v_tipo in ('orientar','esclarecer') then 1 else 0 end,
    estado=case v_tipo when 'orientar' then 'confirmacao' when 'esclarecer' then 'esclarecimento' else 'encaminhado' end,
    versao=versao+1,ultimo_request=p_request,ultima_atividade=clock_timestamp(),expira_em=clock_timestamp()+interval '30 minutes'
    where id=s.id;
  return public.chat_estado(s.id);
end;
$$;
revoke all on function public.chat_operar(text,text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.chat_operar(text,text,uuid,uuid,integer,jsonb) to service_role;
create extension if not exists pg_cron;
select cron.schedule('central-ajuda-limpar-chat','* * * * *',$job$delete from public.sessoes_chat where expira_em <= now()$job$);
notify pgrst,'reload schema';
