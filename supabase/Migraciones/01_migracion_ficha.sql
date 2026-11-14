-- =====================================================================
-- Valkat — Ficha técnica para Live Assist
-- Migración ADITIVA: no modifica la tabla `productos` ni el trigger
-- `proteger_productos`. Ejecutar en Supabase > SQL Editor.
-- =====================================================================

-- 0) Función es_admin(): la base no la tenía, así que se crea aquí.
--    Devuelve true si el usuario con sesión tiene rol 'admin' en public.usuarios.
--    security definer: puede consultar `usuarios` sin depender de sus políticas RLS.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol = 'admin'
  );
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- 1) Tabla aparte con la ficha (1 fila por producto) -------------------
create table if not exists public.productos_ficha (
  producto_id      uuid primary key references public.productos(id) on delete cascade,
  apodos           text  not null default '',          -- "5, robot, giratoria, interior"
  codigo_barras    text,                                -- EAN/UPC de la caja
  especificaciones jsonb not null default '{}'::jsonb,  -- {"App móvil":"Imou Life","Días 64GB":"12 días"}
  updated_at       timestamptz not null default now()
);

-- Un código de barras no puede repetirse entre productos
create unique index if not exists productos_ficha_codigo_uq
  on public.productos_ficha (lower(codigo_barras))
  where codigo_barras is not null;

-- 2) Índices para búsquedas con ilike '%texto%' ------------------------
create extension if not exists pg_trgm with schema extensions;

create index if not exists productos_nombre_trgm
  on public.productos using gin (nombre extensions.gin_trgm_ops);
create index if not exists productos_ficha_apodos_trgm
  on public.productos_ficha using gin (apodos extensions.gin_trgm_ops);

-- 3) RLS: leen todos con sesión; escribe solo el admin -----------------
alter table public.productos_ficha enable row level security;

drop policy if exists ficha_select on public.productos_ficha;
drop policy if exists ficha_insert on public.productos_ficha;
drop policy if exists ficha_update on public.productos_ficha;
drop policy if exists ficha_delete on public.productos_ficha;

create policy ficha_select on public.productos_ficha
  for select to authenticated using (true);
create policy ficha_insert on public.productos_ficha
  for insert to authenticated with check (public.es_admin());
create policy ficha_update on public.productos_ficha
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy ficha_delete on public.productos_ficha
  for delete to authenticated using (public.es_admin());

-- 4) Búsqueda para la app móvil ---------------------------------------
-- · "5" (1 a 3 dígitos) = número de panel EXACTO (no devuelve 15, 25, 50…)
-- · Texto = coincidencia parcial en nombre, marca o apodos
-- · Un código de barras escaneado se resuelve por coincidencia exacta
-- security invoker (por defecto): respeta RLS, exige sesión iniciada.
create or replace function public.buscar_productos_live(q text)
returns table (
  id uuid,
  nombre character varying,
  marca character varying,
  tipo character varying,
  precio numeric,
  stock integer,
  apodos text,
  codigo_barras text,
  especificaciones jsonb
)
language sql
stable
set search_path = public
as $$
  with t as (select lower(btrim(q)) as term)
  select
    p.id, p.nombre, p.marca, p.tipo, p.precio, p.stock,
    coalesce(f.apodos, ''),
    f.codigo_barras,
    coalesce(f.especificaciones, '{}'::jsonb)
  from public.productos p
  left join public.productos_ficha f on f.producto_id = p.id
  cross join t
  where t.term <> ''
    and (
      case
        when t.term ~ '^\d{1,3}$' then
          t.term = any (
            select lower(btrim(x))
            from unnest(string_to_array(coalesce(f.apodos, ''), ',')) x
          )
        else
          p.nombre ilike '%' || t.term || '%'
          or p.marca ilike '%' || t.term || '%'
          or coalesce(f.apodos, '') ilike '%' || t.term || '%'
          or lower(f.codigo_barras) = t.term
      end
    )
  order by
    (
      t.term = any (
        select lower(btrim(x))
        from unnest(string_to_array(coalesce(f.apodos, ''), ',')) x
      )
      or lower(f.codigo_barras) = t.term
    ) desc,
    p.nombre
  limit 20;
$$;

grant execute on function public.buscar_productos_live(text) to authenticated;
