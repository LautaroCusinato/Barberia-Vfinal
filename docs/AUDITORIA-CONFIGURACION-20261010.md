# Configuración: carga, borradores y respuestas tardías · 10/10/2026

Preparada localmente para revisión independiente, sin completar la tarea.
Rama fix/auditoria-app-qa-20261009; base de este parche ddd08e5. Carpeta:
C:/Users/lauti/Documents/Codex/work/auditoria-app-qa-20261009.

## Defectos reproducidos

- Una lectura fallida o vacía dejaba valores por defecto editables y permitía
  enviarlos como preferencias reales. Ahora exige una respuesta del negocio
  actual; muestra error y reintento antes de permitir editar.
- Crear/cancelar invitaciones recargaba las preferencias y reemplazaba el
  borrador. Ahora esas acciones actualizan colaboradores, invitaciones y
  actividad; conservan los campos sin guardar.
- Los campos podían cambiar mientras se guardaba. Se bloquean durante
  guardado/subida; una guarda sincrónica evita dos envíos simultáneos incluso
  ante un segundo submit. Un error conserva el borrador y permite reintentar.
- El guardado ignoraba los datos confirmados por la RPC y volvía a leerlos.
  Ahora usa la respuesta validada de update_tenant_settings, incluido el ID;
  una respuesta vacía o ajena no anuncia éxito ni aplica branding.
- Una respuesta del negocio anterior podía poblar el nuevo o actualizar su
  branding. Estado independiente por negocio y controles de vigencia ignoran
  resultados tardíos, también en el montaje doble de React StrictMode.
- La recarga posterior ocultaba el error de limpiar el logo anterior. Conserva
  ese aviso junto con el éxito del guardado; no afirma que Storage se limpió.

Además se reprodujo un fallo de la primera versión del arreglo: terminar una
invitación durante un reintento de lectura invalidaba esa lectura y dejaba el
skeleton indefinidamente. Lecturas de preferencias y listas auxiliares tienen
versiones separadas; la regresión pasa sin dejar la pantalla cargando.

## Contratos y límites

No se modifican SQL, RLS, roles, firma/argumentos de RPC ni Storage. La
migración 20260807040000_commercial_operations_foundation.sql documenta que
get_tenant_settings devuelve un objeto con ID y preferencias, y que
update_tenant_settings devuelve ese mismo contrato después de guardar.
Validarlo en el cliente no reemplaza la autorización del servidor.

Cambiar de negocio invalida respuestas en la UI; no cancela una escritura
que ya se envió legítimamente para el negocio anterior. Descartar su borrador
al cambiar de negocio es deliberado. No se agregaron avisos de navegación.

La respuesta exitosa confirma las preferencias guardadas, pero no demuestra
que las listas auxiliares estén actualizadas. El formulario sigue esperando
su recarga tras guardar, como antes. No se solucionan aquí todos los posibles
huérfanos de Storage ni el vencimiento de invitaciones mientras la vista está
abierta. No se publicaron cambios ni se crearon/revocaron accesos reales.

## Evidencia y controles

TenantSettings.cargas.audit.test.jsx: ocho regresiones iniciales fallaron
contra ddd08e5. Se añadieron respuesta ajena/vacía, limpieza de logo y
StrictMode. Una regresión adicional de operaciones superpuestas falló contra
la primera corrección; ahora pasa. Total específico: 14 pruebas nuevas más
3 de portapapeles, 17 PASS.

Lint sin errores ni advertencias; npm test, test:unit (61 archivos/746 tests)
y build PASS. Logs en el workspace de este chat:
work/auditoria-config-{lint,contracts,unit,build}.log;
regresiones en auditoria-config-cargas-before.log y
auditoria-config-concurrencia-before.log. Build fuera del repo.

Navegador con TenantSettings real y backend en memoria sin llamadas remotas:
error inicial sin campos editables, reintento con reservas públicas desactivadas
y anticipación 90; invitación ficticia conserva nombre y no relee preferencias;
guardado pendiente bloquea campos; error conserva nombre; éxito aplica nombre
confirmado; cambio 928→929 ignora branding de la respuesta anterior. Consola
sin errores/advertencias. Escritorio medido a 1280 px, sin desborde horizontal.

La emulación móvil no se aplicó a la pestaña de prueba (innerWidth seguía en
1280). No se cuenta como validación a 375 px. Se restauró el viewport; quedan
móvil, temas/teclado, integración y QA autenticado con roles para otra revisión.
No se ejecutaron e2e ni acciones de negocio reales.

## Revisión e integración

Revisar diff contra ddd08e5, buscar pérdidas de borrador y cruces de respuestas;
comprobar errores de preferencias/listas, StrictMode y transiciones de negocio.
Integrar ddd08e5 sólo una vez (incluye tareas 48–50) y después este parche,
con aprobación, resolviendo conflictos con otras sesiones. Retirar sólo este
parche revierte la corrección; no borrar datos ni revertir la base WhatsApp.
