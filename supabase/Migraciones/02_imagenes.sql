-- =====================================================================
-- Valkat — Imágenes de productos
-- Ejecutar DESPUÉS de 01_migracion_ficha.sql
-- =====================================================================

-- 1) Columna en la tabla de ficha (no se toca `productos` ni su trigger)
alter table public.productos_ficha add column if not exists imagen_url text;

-- 2) Bucket público de lectura (las fotos del catálogo no son sensibles).
--    Límite de 1 MB por archivo; el POS comprime antes de subir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) Solo el admin puede subir, reemplazar o borrar. Leer es público (por URL).
drop policy if exists productos_img_insert on storage.objects;
drop policy if exists productos_img_update on storage.objects;
drop policy if exists productos_img_delete on storage.objects;

create policy productos_img_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productos' and public.es_admin());

create policy productos_img_update on storage.objects
  for update to authenticated
  using (bucket_id = 'productos' and public.es_admin())
  with check (bucket_id = 'productos' and public.es_admin());

create policy productos_img_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'productos' and public.es_admin());

-- 4) La búsqueda ahora devuelve también imagen_url.
--    Hay que borrar la función anterior porque cambia su tipo de retorno.
drop function if exists public.buscar_productos_live(text);

create function public.buscar_productos_live(q text)
returns table (
  id uuid,
  nombre character varying,
  marca character varying,
  tipo character varying,
  precio numeric,
  stock integer,
  apodos text,
  codigo_barras text,
  especificaciones jsonb,
  imagen_url text
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
    coalesce(f.especificaciones, '{}'::jsonb),
    f.imagen_url
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

drop policy if exists productos_img_select on storage.objects;

create policy productos_img_select on storage.objects
  for select to authenticated
  using (bucket_id = 'productos');