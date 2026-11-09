-- =============================================================================
--  VALKAT STORE POS · Esquema completo de la base de datos (Supabase / PostgreSQL)
-- =============================================================================
--  Contiene: tablas, restricciones, índices, funciones, triggers y políticas RLS.
--
--  CÓMO USARLO
--    1. Supabase → SQL Editor → pega todo este archivo → Run.
--    2. Crea el primer administrador (ver sección 8 al final).
--
--  ES REPETIBLE: se puede ejecutar de nuevo sin romper nada. En una base nueva
--  crea todo; en una base existente solo agrega lo que falta (tablas, columnas,
--  índices) y vuelve a definir funciones, triggers y políticas.
--  Las restricciones CHECK de las tablas solo se aplican en instalaciones nuevas.
--
--  ROLES DE LA APP
--    admin  → gestiona productos, usuarios, ve reportes, autoriza descuentos y retiros.
--    cajero → abre/cierra su caja, registra clientes y ventas.
--
--  NOTA: las marcas de tiempo son "timestamp without time zone" y guardan hora UTC.
--        La app las interpreta como UTC y las muestra en hora local.
-- =============================================================================


-- =============================================================================
-- 1. TABLAS
-- =============================================================================

-- Empleados del sistema. Cada fila extiende a un usuario de Supabase Auth.
create table if not exists public.usuarios (
  id                    uuid primary key references auth.users(id),
  nombre_completo       character varying not null,
  rol                   character varying default 'cajero'
                          check (rol::text = any (array['admin', 'cajero']::text[])),
  email                 character varying,
  debe_cambiar_password boolean default true,   -- true = debe cambiar su contraseña temporal
  created_at            timestamp without time zone default now()
);

-- Clientes de la tienda. Una venta sin cliente se considera "consumidor final".
create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     character varying not null,         -- nombre completo o razón social
  documento  character varying,                  -- DNI (8) o RUC (11), opcional
  telefono   character varying,
  created_at timestamp without time zone default now()
);

-- Catálogo de productos e inventario.
create table if not exists public.productos (
  id         uuid primary key default gen_random_uuid(),
  nombre     character varying not null,
  marca      character varying,
  tipo       character varying,                  -- categoría (Cámaras, NVR, Networking...)
  precio     numeric not null check (precio >= 0),
  stock      integer default 0 check (stock >= 0),
  created_at timestamp without time zone default now()
);

-- Turnos de caja: un cajero abre el turno con un sencillo y lo cierra con arqueo.
create table if not exists public.caja_turnos (
  id                    uuid primary key default gen_random_uuid(),
  fecha_apertura        timestamp without time zone default now(),
  fecha_cierre          timestamp without time zone,
  monto_apertura        numeric not null default 0.00 check (monto_apertura >= 0),
  monto_cierre_esperado numeric,                 -- sencillo + ventas en efectivo - retiros
  monto_cierre_real     numeric,                 -- efectivo contado por el cajero
  diferencia            numeric,                 -- real - esperado
  estado                character varying default 'Abierta'
                          check (estado::text = any (array['Abierta', 'Cerrada']::text[])),
  usuario_id            uuid references public.usuarios(id)
);

-- Ventas. "total" es el monto final cobrado (ya con descuento).
create table if not exists public.ventas (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid references public.clientes(id),      -- null = consumidor final
  caja_turno_id  uuid references public.caja_turnos(id),
  total          numeric not null check (total >= 0),
  medio_pago     character varying not null
                   check (medio_pago::text = any (array['Efectivo', 'Yape / Plin', 'Tarjeta POS', 'Mixto']::text[])),
  monto_efectivo numeric check (monto_efectivo is null or monto_efectivo >= 0),
  fecha_venta    timestamp without time zone default now(),
  usuario_id     uuid references public.usuarios(id)
);

-- Productos de cada venta.
create table if not exists public.detalle_ventas (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid references public.ventas(id),
  producto_id     uuid references public.productos(id),
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric not null,
  subtotal        numeric not null
);

-- Retiros de efectivo de la caja, siempre autorizados por un administrador.
create table if not exists public.retiros_caja (
  id             uuid primary key default gen_random_uuid(),
  caja_turno_id  uuid not null references public.caja_turnos(id),
  monto          numeric not null check (monto > 0),
  motivo         character varying not null,
  autorizado_por uuid references public.usuarios(id),
  created_at     timestamp without time zone default now()
);

-- Para bases creadas antes de estas funciones (no hace nada si ya existen):
alter table public.ventas add column if not exists monto_efectivo numeric;

comment on column public.ventas.monto_efectivo is
  'Parte de la venta cobrada en efectivo. Efectivo: total; Yape/Plin y Tarjeta POS: 0; Mixto: total menos la parte digital. Define lo que entra a la caja física.';
comment on column public.caja_turnos.monto_cierre_esperado is
  'Sencillo inicial + ventas en efectivo - retiros de caja.';
comment on table public.retiros_caja is
  'Retiros de efectivo autorizados por un administrador. Solo lo insertan administradores (ver políticas RLS).';


-- =============================================================================
-- 2. ÍNDICES
-- =============================================================================
create index if not exists idx_ventas_caja_turno     on public.ventas (caja_turno_id);
create index if not exists idx_ventas_fecha          on public.ventas (fecha_venta);
create index if not exists idx_ventas_usuario        on public.ventas (usuario_id);
create index if not exists idx_ventas_cliente        on public.ventas (cliente_id);
create index if not exists idx_detalle_venta         on public.detalle_ventas (venta_id);
create index if not exists idx_detalle_producto      on public.detalle_ventas (producto_id);
create index if not exists idx_retiros_turno         on public.retiros_caja (caja_turno_id);
create index if not exists idx_turnos_usuario_estado on public.caja_turnos (usuario_id, estado);

-- Un cajero no puede tener dos turnos abiertos a la vez.
-- Un cliente no puede repetir documento.
-- Si ya hay datos duplicados, solo se avisa; corrígelos y vuelve a ejecutar este bloque.
do $$
begin
  begin
    create unique index if not exists uq_turno_abierto_por_usuario
      on public.caja_turnos (usuario_id) where estado = 'Abierta';
  exception when unique_violation then
    raise notice 'Hay usuarios con más de un turno abierto: cierra los duplicados y vuelve a ejecutar este bloque.';
  end;

  begin
    create unique index if not exists uq_cliente_documento
      on public.clientes (documento) where documento is not null;
  exception when unique_violation then
    raise notice 'Hay clientes con documento repetido: corrígelos y vuelve a ejecutar este bloque.';
  end;
end $$;


-- =============================================================================
-- 3. FUNCIÓN AUXILIAR: ¿EL USUARIO ACTUAL ES ADMINISTRADOR?
-- =============================================================================
-- SECURITY DEFINER evita la recursión de RLS al consultar la tabla usuarios
-- desde las propias políticas.
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


-- =============================================================================
-- 4. TRIGGERS DE PROTECCIÓN
--    (RLS controla filas, no columnas: estos triggers cubren la diferencia)
--    Las consultas desde el SQL Editor (auth.uid() nulo) no se bloquean.
-- =============================================================================

-- Un usuario no administrador solo puede cambiar su propio "debe_cambiar_password".
-- Así nadie puede darse a sí mismo el rol de admin.
create or replace function public.proteger_usuarios()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.es_admin() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.rol is distinct from old.rol
     or new.email is distinct from old.email
     or new.nombre_completo is distinct from old.nombre_completo then
    raise exception 'Solo un administrador puede modificar estos datos del usuario.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_usuarios on public.usuarios;
create trigger trg_proteger_usuarios
  before update on public.usuarios
  for each row execute function public.proteger_usuarios();

-- Un cajero puede descontar stock al vender, pero no cambiar nombre, marca,
-- categoría ni precio de un producto.
-- Mejora pendiente: cuando la venta sea una función atómica (RPC), restringir
-- además a que el cajero solo pueda REDUCIR el stock.
create or replace function public.proteger_productos()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.es_admin() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.nombre is distinct from old.nombre
     or new.marca  is distinct from old.marca
     or new.tipo   is distinct from old.tipo
     or new.precio is distinct from old.precio then
    raise exception 'Solo un administrador puede modificar los datos del producto.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_productos on public.productos;
create trigger trg_proteger_productos
  before update on public.productos
  for each row execute function public.proteger_productos();


-- =============================================================================
-- 5. PERMISOS BASE
-- =============================================================================
-- Sin sesión (anon) no se accede a nada. Con sesión, RLS decide qué filas.
revoke all on public.usuarios, public.clientes, public.productos, public.caja_turnos,
              public.ventas, public.detalle_ventas, public.retiros_caja from anon;

grant select, insert, update, delete on public.usuarios, public.clientes, public.productos,
  public.caja_turnos, public.ventas, public.detalle_ventas, public.retiros_caja to authenticated;


-- =============================================================================
-- 6. SEGURIDAD A NIVEL DE FILA (RLS)
-- =============================================================================
alter table public.usuarios       enable row level security;
alter table public.clientes       enable row level security;
alter table public.productos      enable row level security;
alter table public.caja_turnos    enable row level security;
alter table public.ventas         enable row level security;
alter table public.detalle_ventas enable row level security;
alter table public.retiros_caja   enable row level security;

-- ---- usuarios --------------------------------------------------------------
-- Cada quien ve su fila; el admin ve y crea a todos. No se puede borrar.
drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios for select to authenticated
  using (id = auth.uid() or public.es_admin());

drop policy if exists usuarios_insert on public.usuarios;
create policy usuarios_insert on public.usuarios for insert to authenticated
  with check (public.es_admin());

drop policy if exists usuarios_update on public.usuarios;
create policy usuarios_update on public.usuarios for update to authenticated
  using (id = auth.uid() or public.es_admin())
  with check (id = auth.uid() or public.es_admin());

-- ---- clientes --------------------------------------------------------------
-- Todos los usuarios con sesión leen y registran clientes; solo el admin edita o borra.
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using (true);

drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes for insert to authenticated
  with check (true);

drop policy if exists clientes_update on public.clientes;
create policy clientes_update on public.clientes for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists clientes_delete on public.clientes;
create policy clientes_delete on public.clientes for delete to authenticated
  using (public.es_admin());

-- ---- productos -------------------------------------------------------------
-- Todos leen. Solo el admin crea y borra. La actualización la ve todo usuario
-- (el cajero descuenta stock) pero el trigger limita al cajero a la columna stock.
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select to authenticated
  using (true);

drop policy if exists productos_insert on public.productos;
create policy productos_insert on public.productos for insert to authenticated
  with check (public.es_admin());

drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos for update to authenticated
  using (true) with check (true);

drop policy if exists productos_delete on public.productos;
create policy productos_delete on public.productos for delete to authenticated
  using (public.es_admin());

-- ---- caja_turnos -----------------------------------------------------------
-- El cajero abre, ve y cierra SOLO sus turnos (y únicamente mientras estén abiertos).
-- El admin ve todos los turnos.
drop policy if exists turnos_select on public.caja_turnos;
create policy turnos_select on public.caja_turnos for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

drop policy if exists turnos_insert on public.caja_turnos;
create policy turnos_insert on public.caja_turnos for insert to authenticated
  with check (usuario_id = auth.uid() and estado = 'Abierta');

drop policy if exists turnos_update on public.caja_turnos;
create policy turnos_update on public.caja_turnos for update to authenticated
  using (usuario_id = auth.uid() and estado = 'Abierta')
  with check (usuario_id = auth.uid());

-- ---- ventas ----------------------------------------------------------------
-- El cajero registra ventas a su nombre dentro de su turno abierto.
-- Nadie puede editar ni borrar ventas desde la app (no hay políticas de update/delete).
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

drop policy if exists ventas_insert on public.ventas;
create policy ventas_insert on public.ventas for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and exists (
      select 1 from public.caja_turnos t
      where t.id = caja_turno_id and t.usuario_id = auth.uid() and t.estado = 'Abierta'
    )
  );

-- ---- detalle_ventas --------------------------------------------------------
drop policy if exists detalle_select on public.detalle_ventas;
create policy detalle_select on public.detalle_ventas for select to authenticated
  using (
    public.es_admin()
    or exists (select 1 from public.ventas v where v.id = venta_id and v.usuario_id = auth.uid())
  );

drop policy if exists detalle_insert on public.detalle_ventas;
create policy detalle_insert on public.detalle_ventas for insert to authenticated
  with check (
    exists (select 1 from public.ventas v where v.id = venta_id and v.usuario_id = auth.uid())
  );

-- ---- retiros_caja ----------------------------------------------------------
-- Solo un admin inserta (también cuando el cajero pide el retiro: la app usa la
-- sesión del admin que se autentica). El cajero puede ver los retiros de sus turnos.
drop policy if exists retiros_select on public.retiros_caja;
create policy retiros_select on public.retiros_caja for select to authenticated
  using (
    public.es_admin()
    or exists (
      select 1 from public.caja_turnos t
      where t.id = caja_turno_id and t.usuario_id = auth.uid()
    )
  );

drop policy if exists retiros_insert on public.retiros_caja;
create policy retiros_insert on public.retiros_caja for insert to authenticated
  with check (public.es_admin() and autorizado_por = auth.uid());


-- =============================================================================
-- 7. CHEQUEO RÁPIDO (opcional): tablas con RLS activado
-- =============================================================================
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;


-- =============================================================================
-- 8. PRIMER ADMINISTRADOR (se hace una sola vez, a mano)
-- =============================================================================
-- Nadie puede crear al primer admin desde la app, porque crear usuarios exige ser admin.
--   1) Supabase → Authentication → Users → "Add user" (correo y contraseña).
--   2) Quita los "--" de abajo, cambia el correo y el nombre, y ejecuta:
--
-- insert into public.usuarios (id, nombre_completo, email, rol, debe_cambiar_password)
-- select id, 'Nombre del administrador', email, 'admin', false
-- from auth.users
-- where email = 'admin@ejemplo.com';
