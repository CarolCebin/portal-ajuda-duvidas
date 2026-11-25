-- Área administrativa e histórico de avaliação da IA.
begin;

create table public.avaliacao_admin (
  administradora boolean primary key default true check (administradora),
  usuario_id uuid not null unique references auth.users(id) on delete cascade
);
alter table public.avaliacao_admin enable row level security;

create table public.avaliacao_casos (
  id uuid primary key default gen_random_uuid(),
  entrada text not null check (char_length(btrim(entrada)) between 1 and 2000),
  esperado text not null check (char_length(btrim(esperado)) between 1 and 2000),
  motivo text not null check (char_length(btrim(motivo)) between 1 and 300 and motivo !~ '[\r\n]'),
  criado_em timestamptz not null default now()
);
alter table public.avaliacao_casos enable row level security;
create index avaliacao_casos_ordem on public.avaliacao_casos(criado_em, id);

create table public.avaliacao_rodadas (
  id uuid primary key,
  criada_em timestamptz not null default now(),
  concluida_em timestamptz,
  mudancas text not null check (char_length(mudancas) <= 2000),
  total integer not null check (total > 0),
  passaram integer not null default 0,
  avaliados integer not null default 0,
  check (0 <= passaram and passaram <= avaliados and avaliados <= total)
);
alter table public.avaliacao_rodadas enable row level security;
create unique index avaliacao_uma_rodada_ativa on public.avaliacao_rodadas ((1)) where concluida_em is null;
create index avaliacao_rodadas_ordem on public.avaliacao_rodadas(criada_em desc, id desc);

create table public.avaliacao_resultados (
  rodada_id uuid not null references public.avaliacao_rodadas(id) on delete cascade,
  ordem integer not null,
  caso_id uuid not null references public.avaliacao_casos(id),
  entrada text not null,
  esperado text not null,
  motivo_caso text not null,
  estado text not null default 'pendente' check (estado in ('pendente','executando','respondido','erro_chamada','erro_execucao')),
  inicio_execucao timestamptz,
  decisao text,
  resposta text,
  consultados jsonb not null default '[]'::jsonb check (jsonb_typeof(consultados) = 'array'),
  passou boolean,
  motivo_marcacao text not null default '' check (char_length(motivo_marcacao) <= 300 and motivo_marcacao !~ '[\r\n]'),
  check ((estado = 'respondido') = (decisao is not null and resposta is not null)),
  check (passou is null or estado = 'respondido'),
  primary key (rodada_id, ordem),
  unique (rodada_id, caso_id)
);
alter table public.avaliacao_resultados enable row level security;
create index avaliacao_resultados_caso on public.avaliacao_resultados(caso_id);

revoke all on public.avaliacao_admin, public.avaliacao_casos, public.avaliacao_rodadas, public.avaliacao_resultados
  from public, anon, authenticated, service_role;
grant select on public.avaliacao_admin, public.avaliacao_casos, public.avaliacao_rodadas, public.avaliacao_resultados to authenticated;
grant insert (entrada, esperado, motivo) on public.avaliacao_casos to authenticated;
grant select on public.avaliacao_admin, public.avaliacao_casos to service_role;
grant select, insert, update on public.avaliacao_rodadas, public.avaliacao_resultados to service_role;

create policy admin_propria_conta on public.avaliacao_admin for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_le_casos on public.avaliacao_casos for select to authenticated
  using ((select exists (select 1 from public.avaliacao_admin where administradora)));
create policy admin_adiciona_casos on public.avaliacao_casos for insert to authenticated
  with check ((select exists (select 1 from public.avaliacao_admin where administradora)));
create policy admin_le_rodadas on public.avaliacao_rodadas for select to authenticated
  using ((select exists (select 1 from public.avaliacao_admin where administradora)));
create policy admin_le_resultados on public.avaliacao_resultados for select to authenticated
  using ((select exists (select 1 from public.avaliacao_admin where administradora)));

create function public.avaliacao_iniciar(p_usuario uuid, p_id uuid, p_mudancas text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  rodada uuid;
begin
  if not exists (select 1 from public.avaliacao_admin where administradora and usuario_id = p_usuario) then
    raise insufficient_privilege;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.avaliacao_rodadas'));
  select id into rodada from public.avaliacao_rodadas where id = p_id or concluida_em is null
    order by (id = p_id) desc limit 1;
  if rodada is not null then
    return rodada;
  end if;

  with casos as materialized (
    select id, entrada, esperado, motivo, row_number() over (order by criado_em, id) as ordem
    from public.avaliacao_casos
  ), nova as (
    insert into public.avaliacao_rodadas (id, mudancas, total)
    select p_id, p_mudancas, count(*) from casos having count(*) > 0
    returning id
  )
  insert into public.avaliacao_resultados (rodada_id, ordem, caso_id, entrada, esperado, motivo_caso)
    select nova.id, casos.ordem, casos.id, casos.entrada, casos.esperado, casos.motivo
    from nova cross join casos;
  if found then
    return p_id;
  end if;
  return null;
end;
$$;

create function public.avaliacao_proximo(p_usuario uuid, p_rodada uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  em_execucao public.avaliacao_resultados%rowtype;
  caso public.avaliacao_resultados%rowtype;
begin
  if not exists (select 1 from public.avaliacao_admin where administradora and usuario_id = p_usuario) then
    raise insufficient_privilege;
  end if;
  perform 1 from public.avaliacao_rodadas where id = p_rodada and concluida_em is null for update;
  if not found then
    return null;
  end if;
  select * into em_execucao from public.avaliacao_resultados where rodada_id = p_rodada and estado = 'executando';
  if found then
    if em_execucao.inicio_execucao > clock_timestamp() - interval '3 minutes' then
      return null;
    end if;
    update public.avaliacao_resultados set estado = 'erro_execucao'
      where rodada_id = p_rodada and ordem = em_execucao.ordem;
  end if;

  update public.avaliacao_resultados set estado = 'executando', inicio_execucao = clock_timestamp()
    where rodada_id = p_rodada and ordem = (
      select min(ordem) from public.avaliacao_resultados where rodada_id = p_rodada and estado = 'pendente'
    )
    returning * into caso;
  if not found then
    update public.avaliacao_rodadas set concluida_em = clock_timestamp() where id = p_rodada;
    return null;
  end if;
  return jsonb_build_object('ordem', caso.ordem, 'entrada', caso.entrada, 'inicio', caso.inicio_execucao);
end;
$$;

create function public.avaliacao_salvar_resposta(
  p_usuario uuid, p_rodada uuid, p_ordem integer, p_inicio timestamptz,
  p_estado text, p_decisao text, p_resposta text, p_consultados jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.avaliacao_admin where administradora and usuario_id = p_usuario) then
    raise insufficient_privilege;
  end if;
  if p_estado not in ('respondido', 'erro_chamada', 'erro_execucao') then
    raise invalid_parameter_value;
  end if;
  perform 1 from public.avaliacao_rodadas where id = p_rodada and concluida_em is null for update;
  if not found then
    return false;
  end if;
  update public.avaliacao_resultados
    set estado = p_estado, decisao = p_decisao, resposta = p_resposta, consultados = p_consultados
    where rodada_id = p_rodada and ordem = p_ordem and inicio_execucao = p_inicio and estado = 'executando';
  if not found then
    return false;
  end if;
  update public.avaliacao_rodadas set concluida_em = clock_timestamp()
    where id = p_rodada and not exists (
      select 1 from public.avaliacao_resultados where rodada_id = p_rodada and estado = 'pendente'
    );
  return true;
end;
$$;

create function public.avaliacao_marcar(
  p_usuario uuid, p_rodada uuid, p_ordem integer, p_passou boolean, p_motivo text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.avaliacao_admin where administradora and usuario_id = p_usuario) then
    raise insufficient_privilege;
  end if;
  perform 1 from public.avaliacao_rodadas where id = p_rodada for update;
  update public.avaliacao_resultados set passou = p_passou, motivo_marcacao = p_motivo
    where rodada_id = p_rodada and ordem = p_ordem and estado = 'respondido';
  if not found then
    return false;
  end if;
  update public.avaliacao_rodadas set passaram = placar.passaram, avaliados = placar.avaliados
    from (
      select count(*) filter (where passou) as passaram, count(passou) as avaliados
        from public.avaliacao_resultados where rodada_id = p_rodada
    ) as placar where id = p_rodada;
  return true;
end;
$$;

revoke all on function public.avaliacao_iniciar(uuid, uuid, text),
  public.avaliacao_proximo(uuid, uuid),
  public.avaliacao_salvar_resposta(uuid, uuid, integer, timestamptz, text, text, text, jsonb),
  public.avaliacao_marcar(uuid, uuid, integer, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.avaliacao_iniciar(uuid, uuid, text),
  public.avaliacao_proximo(uuid, uuid),
  public.avaliacao_salvar_resposta(uuid, uuid, integer, timestamptz, text, text, text, jsonb),
  public.avaliacao_marcar(uuid, uuid, integer, boolean, text) to service_role;

-- Vincule a conta administradora após aplicar esta estrutura. Consulte o README.
notify pgrst, 'reload schema';
commit;
