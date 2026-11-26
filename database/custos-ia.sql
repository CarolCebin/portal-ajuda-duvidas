-- Aplicar após a instalação do chat e da avaliação.
create table public.ia_configuracao_custos (
  unica boolean primary key default true check (unica),
  entrada_usd numeric(12,6) not null default 0.30 check (entrada_usd between 0 and 100000),
  saida_usd numeric(12,6) not null default 2.50 check (saida_usd between 0 and 100000),
  dolar_brl numeric(12,6) check (dolar_brl > 0 and dolar_brl <= 100000),
  limite_diario integer not null default 30 check (limite_diario between 1 and 100000)
);

create table public.ia_chamadas (
  id uuid primary key,
  iniciada_em timestamptz not null default clock_timestamp(),
  origem text not null check (origem in ('app', 'avaliacao')),
  modelo text not null check (length(modelo) between 1 and 100),
  estado text not null default 'pendente' check (estado in ('pendente', 'respondida', 'falhou')),
  tokens_entrada integer check (tokens_entrada >= 0),
  tokens_saida integer check (tokens_saida >= 0),
  duracao_ms integer check (duracao_ms >= 0),
  check ((estado = 'pendente') = (duracao_ms is null)),
  check (estado = 'respondida' or (tokens_entrada is null and tokens_saida is null))
);

create table public.ia_cotas_diarias (
  dia date not null,
  navegador_hash text not null check (navegador_hash ~ '^[0-9a-f]{64}$'),
  chamadas integer not null check (chamadas > 0),
  primary key (dia, navegador_hash)
);

alter table public.ia_configuracao_custos enable row level security;
alter table public.ia_chamadas enable row level security;
alter table public.ia_cotas_diarias enable row level security;
revoke all on public.ia_configuracao_custos, public.ia_chamadas, public.ia_cotas_diarias from public, anon, authenticated, service_role;
grant select, update on public.ia_configuracao_custos to service_role;
grant select, insert, update on public.ia_chamadas to service_role;
grant select, insert, update on public.ia_cotas_diarias to service_role;

insert into public.ia_configuracao_custos default values;

-- Reserva a cota e registra a chamada em uma transação, inclusive sob concorrência.
create function public.ia_reservar_chamada(p_id uuid, p_origem text, p_modelo text, p_navegador_hash text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_limite integer;
  v_dia date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if p_origem = 'app' then
    select limite_diario into strict v_limite from public.ia_configuracao_custos where unica;
    insert into public.ia_cotas_diarias as cota (dia, navegador_hash, chamadas)
      values (v_dia, p_navegador_hash, 1)
      on conflict (dia, navegador_hash) do update set chamadas = cota.chamadas + 1
        where cota.chamadas < v_limite;
    if not found then return false; end if;
  elsif p_origem is distinct from 'avaliacao' or p_navegador_hash is not null then
    raise invalid_parameter_value;
  end if;

  insert into public.ia_chamadas (id, origem, modelo) values (p_id, p_origem, p_modelo);
  return true;
end;
$$;

create function public.ia_resumo_custos()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'configuracao', (select to_jsonb(c) - 'unica' from public.ia_configuracao_custos c where c.unica),
    'origens', coalesce((
      select jsonb_object_agg(origem, to_jsonb(t) - 'origem')
      from (
        select origem, count(*) as chamadas, count(duracao_ms) as com_duracao,
          coalesce(sum(duracao_ms), 0) as duracao_total_ms,
          count(*) filter (where tokens_entrada is not null and tokens_saida is not null) as medidas,
          coalesce(sum(tokens_entrada) filter (where tokens_saida is not null), 0) as tokens_entrada,
          coalesce(sum(tokens_saida) filter (where tokens_entrada is not null), 0) as tokens_saida
        from public.ia_chamadas
        group by origem
      ) t
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.ia_reservar_chamada(uuid, text, text, text), public.ia_resumo_custos() from public, anon, authenticated, service_role;
grant execute on function public.ia_reservar_chamada(uuid, text, text, text), public.ia_resumo_custos() to service_role;

-- A métrica histórica fica sem identificador. Os contadores vencidos são descartados.
select cron.schedule('central-ajuda-limpar-cotas-ia', '15 4 * * *', $job$
  delete from public.ia_cotas_diarias
  where dia < (now() at time zone 'America/Sao_Paulo')::date
$job$);

notify pgrst, 'reload schema';
