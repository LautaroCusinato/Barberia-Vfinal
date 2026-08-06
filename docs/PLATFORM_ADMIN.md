# Administrador inicial de la plataforma

La tabla `platform_members` separa al equipo interno del SaaS de los usuarios
de cada negocio (`barberia_members`). Nunca se debe crear este registro desde
el frontend ni exponer una `service_role` en variables `VITE_*`.

## Owner creado

Se verifico previamente que el UID exista en `auth.users` y que su email sea
`australautomatizaciones@gmail.com`. Luego se ejecuto una operacion idempotente
que inserta o corrige solamente ese usuario con rol `owner`.

`barberia@gmail.com` no pertenece a `platform_members`; continua siendo un
usuario del negocio/demo.

## Repetir la operacion de forma segura

El SQL reproducible esta en
`supabase/operations/seed-platform-owner.sql`. Ejecutarlo solamente desde el
SQL Editor de Supabase o una conexion administrativa. La operacion:

1. valida UID y email contra `auth.users`;
2. rechaza si el usuario demo aparece como miembro de plataforma;
3. usa `on conflict (user_id)` para que sea idempotente;
4. no lee ni modifica clientes, turnos o miembros del negocio.

## Preflight y rollback

La migracion SaaS `20260806060000_saas_foundation.sql` fue aplicada al proyecto
Supabase `ssagttjdgtypxjcgdnrw` despues de comprobar el proyecto, las
migraciones existentes y conteos de datos (`barberias=2`, `clientes=27`,
`turnos=148`). Es aditiva: no elimina filas ni columnas existentes.

Antes de aplicar cambios posteriores, crear un backup desde el panel de
Supabase. Para volver atras en produccion, restaurar ese backup; no ejecutar un
`drop table` manual porque las tablas SaaS pueden contener datos comerciales.

## Roles disponibles

`owner`, `admin`, `sales`, `support`, `readonly` y `automation`. Las politicas
RLS nuevas permiten acceso a datos de plataforma solo a miembros autenticados;
las credenciales privilegiadas quedan fuera del navegador.
