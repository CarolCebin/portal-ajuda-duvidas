-- Aplicar após chat-gemini.sql e avaliacao-ia.sql.
begin;

alter table public.mensagens_chat
  add column instrucao_detectada text check (instrucao_detectada in ('alterar_regras', 'forcar_resposta', 'simular_autoridade'));
alter table public.avaliacao_resultados
  add column instrucao_detectada text check (instrucao_detectada in ('alterar_regras', 'forcar_resposta', 'simular_autoridade'));

-- Sem cópia da conversa. O identificador serve para localizar a mensagem enquanto ela existir.
create table public.chat_alertas_instrucao (
  mensagem_id uuid primary key,
  mensagem_criada_em timestamptz not null,
  detectado_em timestamptz not null default clock_timestamp(),
  tipo text not null check (tipo in ('alterar_regras', 'forcar_resposta', 'simular_autoridade'))
);
alter table public.chat_alertas_instrucao enable row level security;
create index chat_alertas_instrucao_ordem on public.chat_alertas_instrucao(detectado_em desc, mensagem_id);
revoke all on public.chat_alertas_instrucao from public, anon, authenticated, service_role;
grant select on public.chat_alertas_instrucao to authenticated;
grant insert on public.chat_alertas_instrucao to service_role;
create policy admin_le_alertas_instrucao on public.chat_alertas_instrucao for select to authenticated
  using ((select exists (select 1 from public.avaliacao_admin where administradora)));

create function public.chat_detectar_instrucao(p_texto text)
returns text language sql immutable strict security invoker set search_path = '' as $$
  with normalizado as (
    select translate(lower(normalize(p_texto, NFKC)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as texto
  )
  select case
    when texto ~ $re$\m(ignore|desconsidere|esqueca|pule|abandone|sobrescreva|disregard|forget|override)\M[^.!?\n]{0,75}\m(instruc(ao|oes)|regra(s)?|pergunta de esclarecimento|ficha|prompt|instructions?|rules?|system message)\M$re$
      then 'alterar_regras'
    when texto ~ $re$\m(responda|responder|diga|retorne|escreva|imprima|answer|respond|reply|output)\M[[:space:]]+(apenas|somente|so|exatamente|only|exactly)([[:space:]]|[:：])$re$
      then 'forcar_resposta'
    when texto ~ $re$(^|\n)[[:space:]]*(mensagem (do|de) sistema|system (message|prompt)|developer (message|instruction))([[:space:]]*[:：])$re$
      then 'simular_autoridade'
    else null
  end
  from normalizado;
$$;
revoke all on function public.chat_detectar_instrucao(text) from public, anon, authenticated, service_role;
grant execute on function public.chat_detectar_instrucao(text) to service_role;

create function public.chat_marcar_instrucao()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.autor = 'usuario' then
    new.instrucao_detectada := public.chat_detectar_instrucao(new.texto);
    if new.instrucao_detectada is not null then
      insert into public.chat_alertas_instrucao (mensagem_id, mensagem_criada_em, tipo)
        values (new.id, new.criado_em, new.instrucao_detectada)
        on conflict do nothing;
    end if;
  else
    new.instrucao_detectada := null;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_marcar_instrucao() from public, anon, authenticated, service_role;
create trigger chat_marcar_instrucao before insert or update of autor, texto, instrucao_detectada
  on public.mensagens_chat for each row execute function public.chat_marcar_instrucao();

create function public.avaliacao_marcar_instrucao()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.instrucao_detectada := public.chat_detectar_instrucao(new.entrada);
  return new;
end;
$$;
revoke all on function public.avaliacao_marcar_instrucao() from public, anon, authenticated, service_role;
create trigger avaliacao_marcar_instrucao before insert
  on public.avaliacao_resultados for each row execute function public.avaliacao_marcar_instrucao();

create or replace function public.chat_estado(p_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('sessao', jsonb_build_object(
    'id',s.id,'estado',s.estado,'tentativas',s.tentativas,'versao',s.versao,
    'cenario',s.cenario,'ultimoRequest',s.ultimo_request,'topicoId',s.topico_id,'expiraEm',s.expira_em),
    'mensagens',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'autor',m.autor,'tipo',m.tipo,'texto',m.texto,'fontes',m.fontes,
      'instrucaoDetectada',m.instrucao_detectada
    ) order by m.ordem) from public.mensagens_chat m where m.sessao_id=s.id),'[]'::jsonb))
  from public.sessoes_chat s where s.id=p_id and s.expira_em > now();
$$;

with marcadas as (
  update public.mensagens_chat set instrucao_detectada = public.chat_detectar_instrucao(texto)
    where autor = 'usuario' and public.chat_detectar_instrucao(texto) is not null
    returning id
)
select count(*) as mensagens_marcadas_na_revisao from marcadas;

notify pgrst, 'reload schema';
commit;
