# Auditoría PRE-RC2 — coherencia, feedback y acciones

Fecha: 2026-08-13  
Commit base: `98713b9407accddf79622f0a644c96043427747c`  
QA permitido: `cmsymmszlzikqpvfqjre`  
Producción bloqueada: `ssagttjdgtypxjcgdnrw`

Aplicación de Austral SaaS Architecture y Austral Design System. No se activaron WhatsApp `reply_only`, `booking_enabled`, Mercado Pago productivo, pagos ni mensajes reales.

## Resultado

- P0: 0.
- P1: 0.
- P2: 1 detectado y corregido.
- P3: 0 nuevos bloqueantes.
- Público después del fix: 72/72.
- QA autenticado: 179/192 en la corrida completa; 1 escenario intermitente de red/fixture falló en Desktop 1920 y pasó al repetirlo aisladamente. Los otros 179 escenarios pasaron. El fallo no se reprodujo como bug funcional del cambio.
- Tests estáticos: `npm test` OK, `npm run lint` OK, `npm run build` OK.
- `git diff --check`: OK.
- Secret scan: limpio.

## Hallazgo corregido

| Acción | Problema | Severidad | Fix | Test | Pendiente |
|---|---|---:|---|---|---|
| Eliminar servicio/barbero | La acción se ejecutaba inmediatamente, a diferencia de turnos, clientes y notas, que sí pedían confirmación. Riesgo de borrado accidental e inconsistencia visual. | P2 | Confirmación inline accesible con confirmar/cancelar para servicios y barberos. La lógica backend y el fallback histórico se conservaron. | `scripts/verify-agenda.mjs`, `npm test`, Playwright público 72/72, escenario QA aislado de reserva OK. | Validación manual rápida de cancelar/confirmar en móvil. |

## Acciones y feedback revisados

- Guardar configuración/branding: feedback de éxito/error y lectura posterior ya implementados.
- Crear/editar turno: modal no se cierra si backend rechaza; errores de solapamiento traducidos.
- Crear servicio: nombres temporales únicos y error específico de duplicado.
- Billing: estados sin suscripción/proveedor deshabilitado no se presentan como error técnico; checkout mock/QA permanece separado.
- WhatsApp: integración ausente se muestra desconectada y toggle queda bloqueado con explicación.
- Eliminar turno, cliente y nota: confirmaciones existentes revisadas.
- Links y CTA públicos: rutas de registro, login, recuperación, demo y reserva inexistente respondieron correctamente en smoke.

## Formularios

Los contratos actuales exigen labels, campos requeridos y validaciones básicas de email, contraseña, teléfono, precio, duración y slug. No se modificaron reglas comerciales ni contratos backend. Los casos de precio cero, duración mínima y formato de teléfono quedan indicados para la revisión manual de datos extremos.

## Datos stale / refresh

Las pruebas QA existentes cubren persistencia, branding, servicios, empleados, horarios, billing mock y aislamiento. No se observó un dato cruzado entre tenants. La prueba manual debe cubrir la secuencia crear → editar → cambiar sección → regresar → refresh para cliente, turno, nota y configuración.

## Empty states

La matriz pública y QA ejercita rutas vacías, ausencia de disponibilidad, tenant sin proveedor y conversación/booking controlados. No se observaron `NaN`, `undefined`, `null` ni stack traces en las superficies automatizadas.

## Fechas y moneda

La UI usa formatos localizados en las superficies principales y conserva la moneda del tenant/catálogo. No se detectó un precio `NaN` o `undefined` en las pruebas. La validación manual debe comprobar timezone del negocio y consistencia ARS/USD en servicios, demo y billing.

## Tenant switch y sesión

El aislamiento A/B está cubierto por QA. El cambio Tenant A → Tenant B → Plataforma → Tenant A y la navegación Atrás/Adelante quedan en la checklist manual; no deben conservar branding, agenda, billing ni integración WhatsApp del tenant anterior.

## Doble submit / carreras

La lógica de reserva conserva la autoridad PostgreSQL/RPC y la regresión de carrera. La acción de confirmación de eliminaciones ahora requiere un segundo clic explícito. La revisión manual debe hacer doble clic en crear turno, servicio, cliente y guardar configuración y comprobar que no haya duplicados.

## Consola / red

- Smoke público en el dominio: sin `console.error`, sin localhost, sin `pages.dev`.
- Suite QA: el único error de red observado fue una falla DNS transitoria hacia el proyecto QA (`ENOTFOUND cmsymmszlzikqpvfqjre.supabase.co`) durante una corrida; `nslookup` posterior resolvió correctamente.
- El rol `platformOwner` y el usuario `unassigned` existen y están confirmados en QA.
- Al repetir el escenario afectado de reserva pública en Desktop 1920, pasó aisladamente.

## Estado

### FIXED

- Confirmación consistente para eliminar servicios y barberos.
- Regresión estática agregada.
- Sin cambios de backend, RLS, RPC, billing o integraciones.

### READY

- Público 72/72.
- Tests estáticos, lint y build verdes.
- Aislamiento multi-tenant QA sin regresiones conocidas.

### MANUAL REVIEW

- Recorrido de 35 puntos en [PRE-RC2-MANUAL-CHECKLIST.md](./PRE-RC2-MANUAL-CHECKLIST.md).
- Samsung/Chrome 390x844 para Agenda, Servicios, Configuración, Billing y Chat.
- Multi-tab/realtime, sesión expirada QA y doble submit.

### BLOCKED

- WhatsApp productivo/reply_only/booking_enabled.
- Mercado Pago productivo, pagos reales y tenants productivos.

