-- Cajas Rurales (12/11/2026)
-- Va en el MISMO proyecto de Supabase de Cobros, con tablas aparte (todas empiezan con cr_).
-- No toca ninguna tabla de Cobros. Se puede correr más de una vez sin problema.
--
-- Quién puede qué:
--   · César (usuario "cesar" de Cobros): todo. Los usuarios tienda/facturacion NO ven nada de aquí.
--   · Encargadas: no son usuarios de Supabase. Entran con usuario y contraseña que César pone en
--     la app; solo pueden leer el saldo y los movimientos de SU caja, por 30 días por sesión.
--
-- OJO: si alguna vez se vuelve a correr supabase/seguridad.sql de Cobros, después hay que volver
-- a correr ESTE archivo (aquel le quita a la clave pública el permiso de las funciones de entrada).

create extension if not exists pgcrypto with schema extensions;

-- ===== Administradores (solo César) =====
create table if not exists public.cr_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
insert into public.cr_admins(user_id)
  select id from auth.users where lower(email) = 'cesar@cobros.local'
  on conflict do nothing;

create or replace function public.cr_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.cr_admins where user_id = auth.uid());
$$;

-- ===== Cuentas y saldos iniciales =====
create table if not exists public.cr_cuentas (
  id text primary key check (id in ('bam', 'ss', 'sr')),
  nombre text not null,
  saldo_inicial numeric(14,2) not null default 0,
  configurada boolean not null default false,
  actualizado timestamptz not null default now()
);
insert into public.cr_cuentas(id, nombre) values
  ('bam', 'Tarjeta BAM'), ('ss', 'Caja Santa Sofía'), ('sr', 'Caja San Rafael')
  on conflict (id) do nothing;

-- ===== Movimientos =====
-- tipo: retiro (−) o abono (+). cuenta: bam = solo la tarjeta; ss/sr = una caja.
-- afecta_tarjeta: en un retiro a caja, si también sube la deuda de la tarjeta (el "candado").
-- Nunca se borran: si hay error se anulan y dejan de contar.
create table if not exists public.cr_movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  tipo text not null check (tipo in ('retiro', 'abono')),
  cuenta text not null references public.cr_cuentas(id),
  monto numeric(14,2) not null check (monto > 0),
  afecta_tarjeta boolean not null,
  anulado boolean not null default false,
  anulado_en timestamptz,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  constraint cr_mov_regla_tarjeta check (
    (cuenta = 'bam' and afecta_tarjeta)
    or (cuenta <> 'bam' and (tipo = 'retiro' or not afecta_tarjeta))
  )
);
create index if not exists cr_mov_fecha on public.cr_movimientos(fecha desc, creado_en desc);
create index if not exists cr_mov_cuenta on public.cr_movimientos(cuenta, fecha);

-- ===== Accesos de encargadas =====
create table if not exists public.cr_accesos (
  caja text primary key references public.cr_cuentas(id) check (caja in ('ss', 'sr')),
  nombre text not null default '',
  usuario text unique,
  clave_hash text,
  activo boolean not null default false,
  intentos int not null default 0,
  bloqueado_hasta timestamptz,
  actualizado timestamptz not null default now()
);
insert into public.cr_accesos(caja) values ('ss'), ('sr') on conflict do nothing;

-- Sesiones de encargadas (se guarda solo la huella del código, nunca el código)
create table if not exists public.cr_sesiones (
  token_hash text primary key,
  caja text not null references public.cr_accesos(caja) on delete cascade,
  expira timestamptz not null,
  creada timestamptz not null default now()
);

-- ===== Reglas: solo César lee y escribe cuentas y movimientos =====
alter table public.cr_admins enable row level security;
alter table public.cr_cuentas enable row level security;
alter table public.cr_movimientos enable row level security;
alter table public.cr_accesos enable row level security;
alter table public.cr_sesiones enable row level security;

drop policy if exists cr_solo_admin on public.cr_cuentas;
create policy cr_solo_admin on public.cr_cuentas for all to authenticated
  using (public.cr_es_admin()) with check (public.cr_es_admin());
drop policy if exists cr_solo_admin on public.cr_movimientos;
create policy cr_solo_admin on public.cr_movimientos for all to authenticated
  using (public.cr_es_admin()) with check (public.cr_es_admin());

-- Movimientos: no se borran (solo se anulan)
revoke delete on public.cr_movimientos from authenticated;
-- Accesos, sesiones y administradores: nadie entra directo, solo por las funciones de abajo
revoke all on public.cr_admins, public.cr_accesos, public.cr_sesiones from anon, authenticated;
revoke all on public.cr_cuentas, public.cr_movimientos from anon;

-- ===== Entrada de encargadas =====
create or replace function public.cr_login(p_usuario text, p_clave text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.cr_accesos;
  t text;
begin
  select * into a from public.cr_accesos
   where usuario is not null and lower(usuario) = lower(trim(coalesce(p_usuario, '')));
  if not found then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'Usuario o contraseña incorrectos.');
  end if;
  if a.bloqueado_hasta is not null and a.bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'Demasiados intentos. Prueba de nuevo en 15 minutos.');
  end if;
  if a.clave_hash is null or crypt(coalesce(p_clave, ''), a.clave_hash) <> a.clave_hash then
    update public.cr_accesos
       set intentos = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
           bloqueado_hasta = case when intentos + 1 >= 5 then now() + interval '15 minutes' else null end
     where caja = a.caja;
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'Usuario o contraseña incorrectos.');
  end if;
  if not a.activo then
    return json_build_object('ok', false, 'error', 'Este acceso está desactivado.');
  end if;
  update public.cr_accesos set intentos = 0, bloqueado_hasta = null where caja = a.caja;
  delete from public.cr_sesiones where expira < now();
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.cr_sesiones(token_hash, caja, expira)
    values (encode(digest(t, 'sha256'), 'hex'), a.caja, now() + interval '30 days');
  return json_build_object('ok', true, 'token', t, 'caja', a.caja, 'nombre', a.nombre);
end;
$$;

-- Lo que ve la encargada: saldo y movimientos de su caja, con el saldo después de cada uno
create or replace function public.cr_datos(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.cr_sesiones;
  a public.cr_accesos;
  c public.cr_cuentas;
begin
  select * into s from public.cr_sesiones
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expira > now();
  if not found then
    return json_build_object('ok', false);
  end if;
  select * into a from public.cr_accesos where caja = s.caja;
  if not a.activo then
    delete from public.cr_sesiones where caja = a.caja;
    return json_build_object('ok', false);
  end if;
  select * into c from public.cr_cuentas where id = s.caja;
  return json_build_object(
    'ok', true, 'caja', c.id, 'cuenta', c.nombre, 'nombre', a.nombre, 'expira', s.expira,
    'saldo', c.saldo_inicial + coalesce((
      select sum(case when m.tipo = 'retiro' then -m.monto else m.monto end)
        from public.cr_movimientos m where m.cuenta = c.id and not m.anulado), 0),
    'movimientos', coalesce((
      select json_agg(json_build_object('fecha', x.fecha, 'tipo', x.tipo, 'monto', x.monto, 'saldo', x.saldo)
                      order by x.fecha desc, x.creado_en desc)
        from (select m.fecha, m.tipo, m.monto, m.creado_en,
                     c.saldo_inicial + sum(case when m.tipo = 'retiro' then -m.monto else m.monto end)
                       over (order by m.fecha, m.creado_en rows between unbounded preceding and current row) as saldo
                from public.cr_movimientos m
               where m.cuenta = c.id and not m.anulado) x), '[]'::json)
  );
end;
$$;

create or replace function public.cr_salir(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.cr_sesiones where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- ===== Accesos (solo César) =====
create or replace function public.cr_ver_accesos() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cr_es_admin() then raise exception 'Sin permiso'; end if;
  return (select json_agg(json_build_object(
            'caja', caja, 'nombre', nombre, 'usuario', usuario, 'activo', activo,
            'tiene_clave', clave_hash is not null, 'actualizado', actualizado) order by caja desc)
            from public.cr_accesos);
end;
$$;

create or replace function public.cr_guardar_acceso(p_caja text, p_nombre text, p_usuario text, p_clave text, p_activo boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  a public.cr_accesos;
  u text := lower(regexp_replace(coalesce(p_usuario, ''), '\s', '', 'g'));
  k text := coalesce(p_clave, '');
  cerrar boolean := false;
begin
  if not public.cr_es_admin() then raise exception 'Sin permiso'; end if;
  select * into a from public.cr_accesos where caja = p_caja for update;
  if not found then return json_build_object('ok', false, 'error', 'Caja no válida.'); end if;
  if length(u) < 3 then return json_build_object('ok', false, 'error', 'El usuario debe tener al menos 3 letras.'); end if;
  if u in ('cesar', 'tienda', 'facturacion') then
    return json_build_object('ok', false, 'error', 'Ese usuario ya se usa en Cobros. Elige otro.');
  end if;
  if exists(select 1 from public.cr_accesos where caja <> p_caja and lower(usuario) = u) then
    return json_build_object('ok', false, 'error', 'Ese usuario ya lo tiene la otra caja.');
  end if;
  if k <> '' and length(k) < 6 then
    return json_build_object('ok', false, 'error', 'La contraseña debe tener al menos 6 caracteres.');
  end if;
  if coalesce(p_activo, false) and k = '' and a.clave_hash is null then
    return json_build_object('ok', false, 'error', 'Pon una contraseña antes de activar el acceso.');
  end if;
  cerrar := k <> '' or not coalesce(p_activo, false) or coalesce(lower(a.usuario), '') <> u;
  update public.cr_accesos set
    nombre = trim(coalesce(p_nombre, '')),
    usuario = u,
    clave_hash = case when k <> '' then crypt(k, gen_salt('bf')) else clave_hash end,
    activo = coalesce(p_activo, false),
    intentos = 0, bloqueado_hasta = null,
    actualizado = now()
  where caja = p_caja;
  if cerrar then delete from public.cr_sesiones where caja = p_caja; end if;
  return json_build_object('ok', true, 'sesiones_cerradas', cerrar);
end;
$$;

-- ===== Permisos de las funciones =====
revoke all on function public.cr_es_admin() from public, anon;
revoke all on function public.cr_login(text, text) from public;
revoke all on function public.cr_datos(text) from public;
revoke all on function public.cr_salir(text) from public;
revoke all on function public.cr_ver_accesos() from public, anon;
revoke all on function public.cr_guardar_acceso(text, text, text, text, boolean) from public, anon;
grant execute on function public.cr_login(text, text) to anon, authenticated;
grant execute on function public.cr_datos(text) to anon, authenticated;
grant execute on function public.cr_salir(text) to anon, authenticated;
grant execute on function public.cr_es_admin() to authenticated;
grant execute on function public.cr_ver_accesos() to authenticated;
grant execute on function public.cr_guardar_acceso(text, text, text, text, boolean) to authenticated;

-- ===== Revisión: debe salir admins = 1 =====
select (select count(*) from public.cr_admins) as admins,
       (select count(*) from public.cr_cuentas) as cuentas,
       (select count(*) from public.cr_accesos) as accesos;
