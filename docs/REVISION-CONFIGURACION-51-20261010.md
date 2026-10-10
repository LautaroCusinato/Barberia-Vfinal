# Revisión independiente de Configuración (tareas 51 y 50) · 10/10/2026

Revisión de eaa1d14 contra ddd08e5 (incluye el cambio de portapapeles de la
tarea 50). Worktree propio: `revision-51-indep`, rama
`review/configuracion-51-indep` desde eaa1d14. Sin push, merge, despliegue,
invitaciones reales ni llamadas remotas. Las tareas siguen sin completar.

## Veredicto

eaa1d14 corrige lo que promete: lectura fallida/vacía/ajena sin campos
editables, borrador conservado al crear/cancelar invitaciones, guardado único
y bloqueado, respuesta confirmada en lugar de relectura, respuestas tardías de
otro negocio ignoradas (también en StrictMode) y reintento que termina aunque
una invitación concluya durante la lectura. No encontré pérdidas de borrador
ni éxitos falsos en esos caminos. Sí encontré siete defectos menores; el
commit de esta revisión los corrige con pruebas que fallan contra eaa1d14.

## Hallazgos y correcciones

1. **Foco perdido al guardar con teclado** (introducido por el fieldset de
   eaa1d14). Enter en un campo deshabilita el fieldset y Chrome deja el foco
   en `<body>`; al terminar no vuelve. Medido en navegador: durante y después
   del guardado `activeElement = BODY`. Ahora vuelve al control que lo tenía,
   salvo que la persona ya se haya movido a otro lugar.
2. **Reintentar dejaba el foco en `<body>`**: el skeleton reemplaza la vista.
   Ahora va a «Nombre comercial» si la lectura vuelve, o de nuevo a
   «Reintentar configuración» si vuelve a fallar.
3. **«Cargar logo» no era alcanzable con teclado** (previo al parche): el
   input usaba `hidden` y no aparecía en el orden de tabulación. Ahora usa
   `sr-only` y el botón visible muestra el anillo de foco (`:has(:focus-visible)`).
4. **El aviso de limpieza del logo desaparecía** al copiar el enlace, crear o
   cancelar una invitación o cambiar un rol, porque compartía `error`. Ahora es
   un aviso propio que sólo se limpia con otro guardado o subida.
5. **El logo anterior se borraba comparando con el borrador**, no con la
   respuesta confirmada. Si el servidor todavía lo referencia no se borra.
6. **Cancelar la invitación recién creada dejaba su enlace copiable** con
   «Enlace copiado». Ahora se retira el enlace y se avisa que ya no sirve
   (se usa el `id` que devuelve `create_barberia_invitation`).
7. **Doble envío de invitación**: la guarda dependía de estado de React; dos
   submits en el mismo ciclo creaban dos RPC. Ahora usa una ref sincrónica.
   En navegador real cada clic es un evento discreto, así que el riesgo es bajo.

## Evidencia

- `TenantSettings.revision.audit.test.jsx`: 9 pruebas. Contra eaa1d14 fallan
  7 (hallazgos 1–7) y pasan 2: StrictMode + invitación terminada después del
  reintento con su recarga pendiente, y no robar el foco si la persona se movió.
- Conjunto TenantSettings: 26/26 PASS.
- `npm run lint` sin errores ni advertencias; `npm test` PASS;
  `npm run test:unit` 62 archivos / 755 tests PASS (pool por defecto y threads);
  `vite build` PASS con salida fuera del repo.
- Navegador (pane integrado) con TenantSettings real en StrictMode y Supabase
  en memoria (arnés fuera del repo; sin red salvo una imagen `mock.invalid`):
  - 375×812: `innerWidth` 375, `scrollWidth` 375, grid de una columna, sin
    elementos fuera del viewport; acciones y enlace de invitación legibles.
  - 1280×800: dos columnas, sin desborde horizontal.
  - Teclado: Tab desde «Dirección» enfoca el input de logo con contorno
    visible; foco devuelto tras guardar; Reintentar fallido → Reintentar,
    exitoso → «Nombre comercial».
  - Portapapeles: rechazo real del navegador (sin gesto de usuario) y API
    ausente muestran error, enfocan y seleccionan el enlace completo; éxito
    con `writeText` simulado anuncia «Enlace copiado». En los tres casos el
    aviso de limpieza del logo sigue visible. No se escribió el portapapeles
    real del equipo.
  - Cancelar la invitación recién creada conserva el borrador de Descripción,
    retira el enlace y no relee preferencias.
  - Tema oscuro: tarjetas `#211E1A` con texto `#F1ECE4`; error y aviso con
    contraste suficiente. Consola sin errores de la app.

## Límites

- Sin QA autenticado, roles reales, RLS ni e2e. El contrato de las RPC se
  verificó leyendo `20260807040000_commercial_operations_foundation.sql`
  (`id`, `nombre`, `slug` no nulos en el esquema QA base); producción no se
  consultó.
- El éxito real del portapapeles sólo se probó con stub; no se cubren todos
  los navegadores. El arnés no reemplaza el panel completo (`App.jsx`).
- Siguen fuera de alcance: aviso al navegar con borrador, huérfanos de
  Storage al subir dos logos sin guardar o cambiar de negocio a mitad de una
  subida, input de archivo que no se reinicia, cancelar una invitación ya
  aceptada sin aviso (0 filas sin error) y skeleton completo durante el
  reintento (vuelve a montar WhatsApp e invitaciones).

## Integración recomendada

Una sola vez, con aprobación: ddd08e5 (48–50) → eaa1d14 (51) → el commit de
código de esta revisión → este documento. Repetir lint, npm test, test:unit y
build sobre la combinación.
