# Auth y landing: corrección de producción

## Alcance

Esta etapa corrige el renderizado de la landing y el circuito de confirmación de email sin tocar reservas, RLS, billing, WhatsApp, n8n, Evolution ni datos productivos.

## Landing

La causa técnica identificada en el frontend era que `Landing` se cargaba como un chunk lazy dentro del `Suspense` global. Un retraso o fallo de ese chunk dejaba al usuario con el canvas/decoración ya pintado, pero sin un contenido de recuperación específico para la superficie pública. La solución mantiene el split de rutas y agrega:

- fallback público visible con headline, explicación y CTAs;
- fallback durante la resolución de sesión en `/`;
- boundary específico para que un fallo persistente del chunk no deje una pantalla vacía;
- fallback responsive y respetuoso de `prefers-reduced-motion`.

La causa no se pudo correlacionar con un log remoto de Cloudflare desde este entorno: el dominio no respondió a las comprobaciones externas disponibles. El comportamiento es reproducible a nivel de arquitectura y queda cubierto por la prueba pública del hero y las recargas directas.

## Redirects de Auth

Los flujos de registro, reenvío de confirmación, recuperación y cambio de email ahora usan `src/lib/authRedirect.js` y apuntan a:

`https://barberia.cuchitron.lat/auth/confirm?next=...`

En desarrollo se conserva el origen local sólo cuando la aplicación se ejecuta explícitamente en `localhost`, `127.0.0.1` o `::1`. Los previews de Cloudflare Pages también se aceptan para pruebas. No se confía en `next` sin una allowlist de rutas relativas.

La ruta `/auth/confirm`:

- intercambia códigos PKCE con `exchangeCodeForSession`;
- acepta el flujo hash de Supabase mediante `setSession`;
- distingue confirmación, recuperación, email ya confirmado y enlace vencido/inválido;
- limpia tokens y parámetros de la URL después de procesarlos;
- no muestra `error_code`, `error_description`, tokens ni mensajes crudos;
- permite reenviar un email con loading, rate-limit sanitizado e idempotencia del lado de Auth.

## Configuración manual de Supabase Producción

En **Authentication → URL Configuration** del proyecto `ssagttjdgtypxjcgdnrw`:

- Site URL: `https://barberia.cuchitron.lat`
- Redirect URLs: `https://barberia.cuchitron.lat/auth/confirm`, `https://barberia.cuchitron.lat/onboarding`, `https://barberia.cuchitron.lat/recuperar`, `https://barberia.cuchitron.lat/cuenta`
- Mantener URLs localhost únicamente como entradas explícitas de desarrollo local, nunca como Site URL.

No se modificó esa configuración desde el repositorio porque requiere permisos administrativos del proyecto Supabase. No pegar secretos en el chat.

## Templates

Se prepararon templates HTML simples, responsive y sin secretos en `docs/auth-templates/`:

- `confirm-signup.html`
- `reset-password.html`
- `change-email.html`
- `invite-user.html`

Aplicar sólo los templates de los flujos realmente usados en **Authentication → Email Templates**, conservando las variables oficiales de Supabase. SMTP propio y dominio de envío quedan pendientes; no se habilitó ningún proveedor pago.

## QA y seguridad

- No se usa `service_role` en el frontend.
- `.env.e2e.local` continúa ignorado.
- Los scripts E2E siguen bloqueando el ref productivo y exigen el proyecto QA explícito.
- El callback no es un open redirect y nunca imprime credenciales.
- El test estático `scripts/verify-auth-production-polish.mjs` se ejecuta dentro de `npm test`.

## Pendientes manuales

1. Confirmar Site URL y Redirect URLs en Supabase Producción.
2. Pegar los templates en el dashboard de Auth.
3. Repetir un registro y recuperación con una cuenta QA autorizada, sin usar datos de clientes.
4. Verificar el último deployment de Cloudflare y la consola del navegador con acceso autenticado al proveedor.
