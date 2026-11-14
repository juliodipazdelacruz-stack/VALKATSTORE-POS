-- =====================================================================
-- Valkat — Endurecimiento de seguridad (respuesta al Security Advisor)
-- Ejecutar DESPUÉS de schema.sql, 01_migracion_ficha.sql y 02_imagenes.sql.
-- Es repetible y NO borra datos: solo reemplaza políticas.
-- =====================================================================
-- PROBLEMA QUE CORRIGE
--   Las políticas anteriores decían "cualquier usuario con sesión" (using true).
--   Pero la app da de alta empleados con signUp desde el navegador, así que el
--   registro público de Supabase está abierto: un desconocido podría crearse una
--   cuenta, quedar como "authenticated" y leer clientes (DNI, teléfonos),
--   productos y fichas, o descontar stock.
--   Ahora además se exige estar registrado como empleado en public.usuarios.
-- =====================================================================

-- 1) ¿El usuario actual es un empleado registrado? (cualquier rol)
--    SECURITY INVOKER (por defecto): respeta RLS y no dispara el aviso de
--    "SECURITY DEFINER ejecutable". Un empleado siempre ve su propia fila en
--    usuarios (política usuarios_select), por eso funciona sin privilegios extra.
create or replace function public.es_empleado()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

revoke all on function public.es_empleado() from public, anon;
grant execute on function public.es_empleado() to authenticated;

-- 1b) Permisos explícitos sobre productos_ficha: no dependen de los permisos por
--     defecto de Supabase (que pueden cambiar). RLS sigue decidiendo qué filas.
revoke all on public.productos_ficha from anon;
grant select, insert, update, delete on public.productos_ficha to authenticated;

-- 2) clientes: solo empleados leen y registran
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using (public.es_empleado());

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes for insert to authenticated
  with check (public.es_empleado());

-- 3) productos: solo empleados leen y actualizan (el trigger sigue limitando
--    a los cajeros a la columna stock)
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select to authenticated
  using (public.es_empleado());

drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos for update to authenticated
  using (public.es_empleado()) with check (public.es_empleado());

-- 4) ficha técnica: solo empleados leen
drop policy if exists ficha_select on public.productos_ficha;
create policy ficha_select on public.productos_ficha for select to authenticated
  using (public.es_empleado());

-- 5) Storage: la política SELECT amplia permitía LISTAR todos los archivos del
--    bucket. Se limita al admin (necesario para reemplazar fotos con upsert).
--    Las imágenes se siguen viendo por su URL pública, que no depende de políticas.
drop policy if exists productos_img_select on storage.objects;
create policy productos_img_select on storage.objects for select to authenticated
  using (bucket_id = 'productos' and public.es_admin());
