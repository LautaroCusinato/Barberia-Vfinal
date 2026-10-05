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

En desarrollo se conserva el origen local sólo cuando Vite está en modo `DEV` y la aplicación se ejecuta explícitamente en `localhost`, `127.0.0.1` o `::1`. El origen del navegador no habilita redirects de QA. Los builds sin configuración QA válida usan el dominio canónico de producción. `next` sólo acepta rutas relativas internas.

### Builds de QA y previews (tarea 08)

QA usa builds con `DEV=false`, igual que producción. Para que los enlaces de registro, reenvío, recuperación, cambio de email e invitaciones permanezcan en QA, configurar conjuntamente al compilar:

```dotenv
VITE_SUPABASE_URL=https://cmsymmszlzikqpvfqjre.supabase.co
VITE_APP_BASE_URL=https://barberia-qa.cuchitron.lat
```

La anon key debe pertenecer al mismo proyecto QA. También se admite como base un preview explícito `https://<rama-o-hash>.barberia-177.pages.dev`, con un solo nivel de subdominio. No se admite cualquier `pages.dev`, HTTP remoto, puertos alternativos ni URLs con credenciales. El dominio raíz `barberia-177.pages.dev` no se considera un preview de QA. Agregar otro proyecto o dominio requiere revisar esta lista en el código.

Una URL de QA con backend productivo, desconocido o vacío no habilita el redirect QA. La configuración inválida conserva el fallback canónico anterior; no habilitar pruebas de email hasta verificar las dos variables del build. Cambiar variables de hosting requiere reconstruir el sitio.

Antes de enviar emails, revisar **únicamente en Supabase QA** su Site URL y Redirect URLs explícitas. Los templates que usan `{{ .SiteURL }}` siguen dependiendo de esa configuración aunque el frontend envíe `redirectTo`. La corrección local no modifica el dashboard ni los templates remotos y no demuestra la entrega de emails. Probar registro, reenvío, recuperación, cambio de email e invitación con cuentas QA después de aprobar esos ajustes; nunca agregar previews a la configuración de Auth de producción.

La ruta `/auth/confirm`:

- intercambia códigos PKCE con `exchangeCodeForSession`;
- verifica enlaces nuevos con `verifyOtp({ token_hash, type })`, siguiendo el flujo recomendado por Supabase;
- acepta el flujo hash de Supabase mediante `setSession`;
- distingue confirmación, recuperación, cambio de email, invitación, email ya confirmado y enlace vencido/inválido;
- limpia tokens y parámetros de la URL después de procesarlos;
- no muestra `error_code`, `error_description`, tokens ni mensajes crudos;
- permite reenviar un email con loading, rate-limit sanitizado y un cooldown de 30 segundos para evitar clicks repetidos.

Los templates versionados construyen el callback con `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`. Esto evita depender del endpoint default de verificación y permite que la propia aplicación controle los estados de expiración y reutilización. El `Site URL` del proyecto sigue siendo una configuración administrativa obligatoria: si permanece en `localhost`, cualquier template que use `.SiteURL` seguirá heredando ese valor.

## Configuración manual de Supabase Producción

En **Authentication → URL Configuration** del proyecto `ssagttjdgtypxjcgdnrw`:

- Site URL: `https://barberia.cuchitron.lat`
- Redirect URLs mínimas: `https://barberia.cuchitron.lat/auth/confirm`, `https://barberia.cuchitron.lat/onboarding`, `https://barberia.cuchitron.lat/recuperar`, `https://barberia.cuchitron.lat/cuenta`
- Mantener URLs localhost únicamente como entradas explícitas de desarrollo local, nunca como Site URL.
- Eliminar URLs wildcard u orígenes que no pertenezcan al dominio de producción. No agregar `*`, `**` ni un dominio de preview como redirect productivo.

No se modificó esa configuración desde el repositorio porque requiere permisos administrativos del proyecto Supabase. No pegar secretos en el chat.

## Templates

Se prepararon templates HTML simples, responsive y sin secretos en `docs/auth-templates/`:

- `confirm-signup.html`
- `reset-password.html`
- `change-email.html`
- `invite-user.html`

Asuntos recomendados en el dashboard:

- Confirm Signup: `Confirmá tu cuenta de Austral Automatizaciones`
- Reset Password: `Restablecé tu contraseña de Austral Automatizaciones`
- Change Email: `Confirmá tu nuevo email de Austral Automatizaciones`
- Invite User: `Te invitaron a Austral Automatizaciones`

Aplicar sólo los templates de los flujos realmente usados en **Authentication → Email Templates**, conservando las variables oficiales de Supabase. SMTP propio y dominio de envío quedan pendientes; no se habilitó ningún proveedor pago.

## QA y seguridad

- No se usa `service_role` en el frontend.
- `.env.e2e.local` continúa ignorado.
- Los scripts E2E siguen bloqueando el ref productivo y exigen el proyecto QA explícito.
- El callback no es un open redirect y nunca imprime credenciales.
- Los links de invitación compartibles también usan el origen canónico, no `window.location.origin`.
- El test estático `scripts/verify-auth-production-polish.mjs` se ejecuta dentro de `npm test`.

## Diagnóstico del incidente observado

El `localhost:3000/#error=access_denied&error_code=otp_expired` no lo genera el copy del frontend. Es la combinación de una configuración de `Site URL`/redirect de Supabase que todavía apuntaba a un entorno local y un enlace anterior expirado o ya utilizado. Los enlaces enviados antes de corregir la configuración no se pueden reparar: deben descartarse y probarse con un email nuevo. El frontend ahora convierte ese resultado en “Este enlace ya no es válido”, ofrece reenvío y nunca expone los parámetros técnicos.

## Evidencia y límites de esta entrega

Desde este entorno no hay una sesión administrativa de Supabase Management API, por lo que no se pudo leer ni escribir la configuración real de `ssagttjdgtypxjcgdnrw`, ni inspeccionar el remitente efectivo. El código, los templates y los tests quedaron preparados; la confirmación productiva requiere completar los pasos manuales y recibir un email nuevo. El remitente seguirá siendo el configurado actualmente por Supabase hasta habilitar SMTP propio.

## Pendientes manuales

1. En **Authentication → URL Configuration** del proyecto `ssagttjdgtypxjcgdnrw`, guardar el Site URL y la allowlist indicada arriba; quitar el Site URL local y redirects wildcard.
2. En **Authentication → Email Templates**, pegar los cuatro HTML y sus asuntos. Confirm Signup debe usar exactamente el template con `TokenHash`.
3. Guardar/actualizar el template antes de enviar la prueba; links viejos no sirven para validar el cambio.
4. Crear una cuenta nueva con prefijo `E2E_QA_` en el proyecto QA, solicitar un email nuevo, comprobar que el enlace no contiene `localhost`, confirmar y luego iniciar sesión.
5. Repetir recuperación, cambio de email y resend con una cuenta QA; probar también un token vencido/reutilizado y verificar el estado sanitizado.
6. Ejecutar un registro manual productivo controlado sólo después de los pasos anteriores, sin usar datos de clientes reales.
7. Verificar el último deployment de Cloudflare y la consola del navegador con acceso autenticado al proveedor.

La API oficial de Supabase documenta `verifyOtp({ token_hash, type: 'email' })` para este flujo y expone `TokenHash`/`SiteURL` como variables de templates: [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates) y [JavaScript verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).
