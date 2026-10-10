# Auditoría general de la app · 09/10/2026

Estado: correcciones locales para revisión independiente. No cierra la
auditoría general ni las tareas. Base c74b3fd, rama
fix/auditoria-app-qa-20261009, carpeta
C:/Users/lauti/Documents/Codex/work/auditoria-app-qa-20261009.
No se modificaron otros worktrees, QA remoto, producción, RPC, RLS ni n8n.

## Fallos reproducidos y correcciones

1. Ficha de cliente: un turno sin cliente_id se atribuía por el nombre. Dos
   personas con el mismo nombre podían ver el mismo turno en sus fichas.
   También se perdían vínculos por diferencias número/string o nombres de
   reserva distintos de la ficha. Ahora usa identificador y verifica negocio
   si ambos registros lo incluyen. Soporta paciente_id/clienteId de datos
   locales antiguos; no asocia un turno sin ID sólo por el nombre.
2. Clientes: alta/edición/ficha carecían de diálogo accesible y Escape. Varios
   campos no estaban asociados a su etiqueta y el nombre de la tabla era un
   div clickeable inaccesible con teclado. Reutilizan FocusTrap, etiquetas
   vinculadas y botón semántico; Tab queda dentro, Escape cierra fuera de un
   guardado, y el foco vuelve al botón que abrió el formulario. data-autofocus
   evita que autoFocus robe el foco antes de capturar su origen.
3. Cobro: cerrar/cancelar/click afuera o cambiar importe/método seguían activos
   con onConfirm pendiente. Ahora se bloquean mientras guarda. Un error
   conserva valores y habilita reintentar/cerrar. No se modifica la operación
   financiera, su clave idempotente ni la validación de la base.
4. FocusTrap compartido: un control data-autofocus deshabilitado bloqueaba el
   foco inicial; con todos los controles deshabilitados, Tab podía escapar.
   Ahora enfoca un control disponible o el contenedor y recupera foco externo.
5. Configuración: copiar invitación anunciaba éxito sin API de portapapeles,
   o dejaba una promesa rechazada sin manejar al denegarse permiso. Sólo
   confirma después de writeText; ante error conserva, enfoca y selecciona
   el enlace para copiarlo manualmente. No crea ni envía nuevas invitaciones.

Los turnos históricos sin identificador ya no figuran automáticamente en una
ficha por coincidencia de nombre; siguen existiendo en Agenda. Asociarlos
requiere selección fiable y revisión separada, nunca un backfill por nombre.

## Evidencia de las regresiones

- Clientes.audit.test.jsx inicial: 5 fallos antes de corregir.
- Teclado de la tabla y foco al cerrar: 2 fallos adicionales antes de corregir.
- FocusTrap.test.jsx: 3 regresiones nuevas fallaban antes.
- TenantSettings.audit.test.jsx: 2 fallos y 1 rechazo sin manejar antes; el
  camino exitoso ya pasaba. Se corrigió un matcher del test, no la condición.
- Después: pruebas enfocadas PASS y suite completa 60 archivos/732 tests PASS.
- Lint, npm test (contratos offline) y build PASS. Build fuera del repo.

Logs en el workspace privado de este chat: work/auditoria-*.log. Vitest no
lee .env. El servidor Vite de auditoría usa sólo un mock en 127.0.0.1:54401,
con clave de marcador; no contiene credenciales reales ni se publica.

## Navegador

- Panel demo: diez vistas (Resumen, Agenda, Equipo, Mensajes, Clientes, Notas,
  Estadísticas, Operación, Configuración, Facturación). Navegación y estado
  renderizado a 1280 px y 375 px, claro/oscuro, sin desborde horizontal.
  Esto es un smoke visual; no prueba cada operación ni servicios reales.
- Alta ficticia de cliente: guardada en la demo, aviso único. Escape en alta
  cierra y devuelve foco. Etiquetas verificadas en DOM y árbol accesible.
- Reserva pública ARS: campos vacíos, corrección, volver atrás conservando
  borrador/horario, confirmar en mock, éxito y enlace de calendario coherente.
  Móvil claro/oscuro sin desborde; no demuestra persistencia/RLS/realtime real.
- Un error de HMR mientras se estaba aplicando un parche JSX desapareció al
  completar el archivo. Registrar por separado errores nuevos tras la recarga
  final; no confundir ese diagnóstico de edición con un error del recorrido.

## Lo que sigue pendiente

Revisión independiente, integración del parche, prueba con datos/backend QA,
roles, concurrencia y recorridos de Auth. No se corrieron e2e, no hubo cobros,
mensajes ni reservas remotos. Las tareas 46/47 mantienen su revisión/integración
propia; esta entrega no reemplaza sus correcciones de zona horaria o cargas.
La auditoría general permanece abierta para seguir probando otras operaciones.

Reversión local: retirar únicamente este parche. No borrar datos ni quitar
las mejoras de WhatsApp/Reatime de la base c74b3fd. Antes de integrar comprobar
estado limpio del destino y conflictos con los commits de otros chats.
