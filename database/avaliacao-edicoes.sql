-- Aplicar após avaliacao-ia.sql. Os casos e as rodadas existentes começam na versão original.
begin;

alter table public.avaliacao_casos
  add column versao integer not null default 1 check (versao > 0);
alter table public.avaliacao_resultados
  add column versao_caso integer not null default 1 check (versao_caso > 0);

create table public.avaliacao_caso_edicoes (
  caso_id uuid not null references public.avaliacao_casos(id),
  versao integer not null check (versao > 1),
  editado_em timestamptz not null default clock_timestamp(),
  editado_por uuid not null,
  email_editor text not null check (char_length(btrim(email_editor)) between 1 and 320),
  motivo_edicao text not null check (char_length(motivo_edicao) <= 300 and motivo_edicao ~ '[^[:space:]]'),
  anterior jsonb not null,
  atualizado jsonb not null,
  primary key (caso_id, versao)
);
alter table public.avaliacao_caso_edicoes enable row level security;
revoke all on public.avaliacao_caso_edicoes from public, anon, authenticated, service_role;
grant select on public.avaliacao_caso_edicoes to authenticated;


create policy admin_le_edicoes on public.avaliacao_caso_edicoes for select to authenticated
  using ((select exists (select 1 from public.avaliacao_admin where administradora)));

create schema avaliacao_interna;
revoke all on schema avaliacao_interna from public, anon, authenticated, service_role;
grant usage on schema avaliacao_interna to authenticated;

-- O papel autenticado não tem UPDATE nos casos. A função interna pode editar e
-- registrar a auditoria numa única transação, após verificar a identidade da sessão.
create function avaliacao_interna.editar_caso(
  p_caso uuid, p_versao integer,
  p_entrada text, p_esperado text, p_motivo text, p_motivo_edicao text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  editor_id uuid := auth.uid();
  editor_email text;
  original public.avaliacao_casos%rowtype;
  editado public.avaliacao_casos%rowtype;
begin
  select u.email into editor_email
    from public.avaliacao_admin a join auth.users u on u.id = a.usuario_id
    where a.administradora and a.usuario_id = editor_id and u.email_confirmed_at is not null;
  if editor_email is null then
    raise insufficient_privilege;
  end if;
  if p_motivo_edicao is null or p_motivo_edicao !~ '[^[:space:]]' or char_length(p_motivo_edicao) > 300 then
    raise invalid_parameter_value;
  end if;

  select * into original from public.avaliacao_casos where id = p_caso for update;
  if not found then
    return jsonb_build_object('estado', 'nao_encontrado');
  end if;
  if original.versao is distinct from p_versao then
    return jsonb_build_object('estado', 'desatualizado');
  end if;
  if (original.entrada, original.esperado, original.motivo) is not distinct from (p_entrada, p_esperado, p_motivo) then
    return jsonb_build_object('estado', 'sem_mudanca');
  end if;

  update public.avaliacao_casos
    set entrada = p_entrada, esperado = p_esperado, motivo = p_motivo, versao = original.versao + 1
    where id = p_caso returning * into editado;
  insert into public.avaliacao_caso_edicoes (caso_id, versao, editado_por, email_editor, motivo_edicao, anterior, atualizado)
    values (
      p_caso, editado.versao, editor_id, editor_email, p_motivo_edicao,
      jsonb_build_object('entrada', original.entrada, 'esperado', original.esperado, 'motivo', original.motivo),
      jsonb_build_object('entrada', editado.entrada, 'esperado', editado.esperado, 'motivo', editado.motivo)
    );
  return jsonb_build_object('estado', 'editado', 'caso', to_jsonb(editado) - 'criado_em');
end;
$$;
revoke all on function avaliacao_interna.editar_caso(uuid, integer, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function avaliacao_interna.editar_caso(uuid, integer, text, text, text, text) to authenticated;

create function public.avaliacao_editar_caso(
  p_caso uuid, p_versao integer, p_entrada text, p_esperado text, p_motivo text, p_motivo_edicao text
) returns jsonb language sql security invoker set search_path = '' as $$
  select avaliacao_interna.editar_caso(p_caso, p_versao, p_entrada, p_esperado, p_motivo, p_motivo_edicao);
$$;
revoke all on function public.avaliacao_editar_caso(uuid, integer, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.avaliacao_editar_caso(uuid, integer, text, text, text, text) to authenticated;

create or replace function public.avaliacao_iniciar(p_usuario uuid, p_id uuid, p_mudancas text)
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
    select id, entrada, esperado, motivo, versao, row_number() over (order by criado_em, id) as ordem
    from public.avaliacao_casos
  ), nova as (
    insert into public.avaliacao_rodadas (id, mudancas, total)
    select p_id, p_mudancas, count(*) from casos having count(*) > 0
    returning id
  )
  insert into public.avaliacao_resultados (rodada_id, ordem, caso_id, entrada, esperado, motivo_caso, versao_caso)
    select nova.id, casos.ordem, casos.id, casos.entrada, casos.esperado, casos.motivo, casos.versao
    from nova cross join casos;
  if found then
    return p_id;
  end if;
  return null;
end;
$$;

notify pgrst, 'reload schema';
commit;
