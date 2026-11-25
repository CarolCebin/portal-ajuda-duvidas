-- Execute o arquivo preparar-supabase.sql, que reúne esta estrutura e o conteúdo inicial.
create table if not exists public.categorias (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,199}$'),
  nome text not null check (btrim(nome) <> ''),
  descricao text not null default '',
  icone text not null default 'book',
  ordem integer not null check (ordem >= 0),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.topicos (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,199}$'),
  categoria_id text not null references public.categorias(id) on delete restrict,
  titulo text not null check (btrim(titulo) <> ''),
  conteudo jsonb not null default '[]'::jsonb check (jsonb_typeof(conteudo) in ('array', 'string')),
  imagens jsonb not null default '[]'::jsonb check (jsonb_typeof(imagens) = 'array'),
  videos jsonb not null default '[]'::jsonb check (jsonb_typeof(videos) = 'array'),
  ordem integer not null check (ordem >= 0),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists topicos_categoria_ordem_idx on public.topicos (categoria_id, ordem, id);

-- O acesso externo às tabelas fica fechado; somente o servidor usa a chave secret.
alter table public.categorias enable row level security;
alter table public.topicos enable row level security;
revoke all on table public.categorias, public.topicos from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.categorias, public.topicos to service_role;

create or replace function public.central_ajuda_atualizar_timestamp()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.atualizado_em := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.central_ajuda_atualizar_timestamp() from public, anon, authenticated;
grant execute on function public.central_ajuda_atualizar_timestamp() to service_role;

drop trigger if exists categorias_atualizar_timestamp on public.categorias;
create trigger categorias_atualizar_timestamp before update on public.categorias
for each row execute function public.central_ajuda_atualizar_timestamp();
drop trigger if exists topicos_atualizar_timestamp on public.topicos;
create trigger topicos_atualizar_timestamp before update on public.topicos
for each row execute function public.central_ajuda_atualizar_timestamp();
