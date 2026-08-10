# AuditorÃ­a UI/UX de Austral SaaS

Fecha de revisiÃ³n: 2026-08-09  
AplicaciÃ³n auditada: barberia.cuchitron.lat  
Alcance: experiencia pÃºblica, workspace de negocio, workspace de plataforma y estados responsive.

## Alcance y garantÃ­as

Esta entrega es exclusivamente un diagnÃ³stico visual y de experiencia. No se modificaron componentes funcionales, reglas de negocio, Supabase, billing, RLS, Edge Functions, n8n, Evolution ni producciÃ³n. No se crearon commits ni se hizo push.

Los Ãºnicos artefactos agregados son este informe y la evidencia dentro de docs/ui-audit/.

La revisiÃ³n aplica explÃ­citamente:

- Austral SaaS Architecture: preservar contratos multi-tenant, aislamiento, observabilidad, billing y workflows existentes. Las recomendaciones estÃ¡n limitadas a la capa de presentaciÃ³n y no duplican lÃ³gica de backend.
- Austral Design System: foundation semÃ¡ntica, primitives reutilizables, mobile-first, estados completos, dark mode de primera clase, WCAG AA, foco visible y una misma gramÃ¡tica visual para pÃºblico, negocio y plataforma.

## MÃ©todo y cobertura

Se recorrieron rutas directas con la sesiÃ³n autenticada disponible y se inspeccionaron los estados renderizados, semÃ¡ntica accesible, consola del navegador y estructura CSS.

| Ãrea | Rutas/estados revisados | Evidencia |
|---|---|---|
| Marketing pÃºblico | /para/barberia, landing con hero, beneficios, pasos, planes, FAQ y CTA | snapshot DOM y revisiÃ³n de Landing.jsx/index.css |
| Acceso | /ingresar, /registro, /recuperar | snapshot DOM; campos, foco inicial, acciones |
| ActivaciÃ³n | /onboarding | snapshot DOM; progreso de 8 pasos, guardado y primer paso |
| Demo | /demo | snapshot DOM; sandbox aislado, vertical, color, servicios y reserva ficticia |
| Reservas pÃºblicas | /reservar/barberia-central | snapshot DOM; servicios, fecha, profesionales, horarios, datos y estado sin disponibilidad |
| Negocio | resumen, agenda, equipo, mensajes, clientes, notas, estadÃ­sticas, operaciÃ³n, configuraciÃ³n, facturaciÃ³n | navegaciÃ³n SPA por Sidebar y snapshot de cada vista |
| Plataforma | /plataforma: CRM, Negocios y leads, Agente, Piloto, Seguimientos y FacturaciÃ³n SaaS | navegaciÃ³n SPA y snapshot de cada vista |

Breakpoints objetivo revisados por cÃ³digo y mediciÃ³n del runtime: 360x800, 390x844, 768x1024, 1366x768 y 1920x1080.

Evidencia visual disponible:

- [selector de workspace en 390x844](ui-audit/workspace-selector-390x844.png)

El selector muestra evidencia directa de recorte horizontal en mÃ³vil: la tarjeta supera el viewport y el contenido del lado derecho queda cortado. Las capturas adicionales de pÃ¡gina completa no pudieron persistirse porque el comando CDP Page.captureScreenshot agotÃ³ el tiempo en esas rutas; no se fabricaron imÃ¡genes sintÃ©ticas. El resto de los hallazgos estÃ¡ respaldado por snapshots DOM, CSS y mediciones read-only.

La consola no reportÃ³ errores durante la navegaciÃ³n auditada (dev.logs vacÃ­o). Esto no sustituye una prueba de red offline ni una sesiÃ³n con permisos de cada rol.

## Resumen ejecutivo

| DimensiÃ³n | Puntaje | Lectura |
|---|---:|---|
| JerarquÃ­a y claridad | 7/10 | El producto tiene una narrativa y tÃ­tulos claros; algunas pantallas mezclan demasiadas capas de informaciÃ³n. |
| Consistencia visual | 6/10 | Negocio, booking y plataforma comparten tokens parciales, pero landing y booking mantienen sistemas de color separados. |
| Responsive | 5/10 | Hay breakpoints y tabbar mÃ³vil, pero el selector de workspace se recorta y varias tablas dependen de scroll horizontal. |
| Accesibilidad | 6/10 | Hay labels, aria-label y focus-visible; faltan traps de foco, anuncios de estado y una revisiÃ³n sistemÃ¡tica del orden de foco. |
| Dark mode | 6/10 | Negocio y reservas tienen modo oscuro; landing, registro, demo y plataforma no ofrecen una experiencia oscura equivalente. |
| Reservas pÃºblicas | 7/10 | El flujo respeta disponibilidad y refresco; falta mÃ¡s orientaciÃ³n paso a paso y hay un mensaje de validaciÃ³n telefÃ³nica incorrecto. |
| Agenda operativa | 7/10 | El calendario y filtros son Ãºtiles; la pausa tiene dos selects con nombres ambiguos y la densidad mÃ³vil es alta. |
| CRM/plataforma | 6/10 | Buen aislamiento y estados explÃ­citos; las tablas y controles quedan muy densos en mÃ³vil. |
| Base SaaS | 8/10 | Hay separaciÃ³n de workspaces, estado de trial y controles sandbox claros; la capa visual todavÃ­a no expresa una arquitectura Ãºnica. |

Score global orientativo: 6,4/10. La base es vendible desde el punto de vista funcional, pero conviene resolver primero el layout mÃ³vil, la unificaciÃ³n de primitives y la accesibilidad de overlays antes de escalar adquisiciÃ³n.

## Top 20 de hallazgos priorizados

Severidades: CrÃ­tico bloquea o recorta una tarea; Alto degrada una conversiÃ³n o flujo central; Medio genera fricciÃ³n repetida; Bajo es deuda visual o de consistencia.

| # | Severidad | CategorÃ­a | Hallazgo y evidencia | Impacto | RecomendaciÃ³n futura |
|---:|---|---|---|---|---|
| 1 | CrÃ­tico | Responsive | El selector de workspace en 390 px se sale del viewport; la tarjeta queda cortada en workspace-selector-390x844.png. El estilo estÃ¡ concentrado en App.jsx y no comparte container responsive. | El owner puede no ver completa la opciÃ³n de negocio/plataforma. | Crear AuthShell/WorkspaceSelector con width:min(100%,420px), box-sizing:border-box, padding seguro y pruebas a 360/390 px. |
| 2 | Alto | Reservas | PublicBooking.jsx valida 13 dÃ­gitos (prefijo + nÃºmero), pero muestra â€œIngresÃ¡ los 8 dÃ­gitosâ€. PhoneField espera los 8 dÃ­gitos locales despuÃ©s de +54 9 11. | Mensaje contradictorio y riesgo de abandono o soporte innecesario. | Centralizar copy y regla en una primitive de telÃ©fono; anunciar formato y ejemplo una sola vez. |
| 3 | Alto | Marketing/dark | Landing usa colores hardcodeados (#f7f4ee, #26231f, #9b6a2f) y no ofrece toggle oscuro, mientras booking y negocio sÃ­ lo ofrecen. | La promesa de marca cambia entre entrada, demo y producto. | Mapear landing a tokens semÃ¡nticos y aÃ±adir dark mode respetando preferencia del sistema. |
| 4 | Alto | Responsive/CRM | crm-leads-table declara min-width:780px y obliga scroll horizontal en mÃ³vil. Varias tablas del CRM y billing quedan en formato desktop. | Lectura y ediciÃ³n difÃ­ciles en 360/390 px. | Definir tabla responsive: tarjetas por fila en mÃ³vil, columnas prioritarias y scroll con encabezado persistente sÃ³lo cuando sea necesario. |
| 5 | Alto | NavegaciÃ³n | Las vistas de negocio y plataforma son estado SPA (setView), no URLs independientes. Un refresh o enlace profundo no conserva agenda, mensajes o Negocios y leads. | PÃ©rdida de contexto, enlaces no compartibles y back del navegador poco predecible. | Usar rutas hijas o query state con guardas de permisos; mantener el contrato multi-tenant en el loader. |
| 6 | Alto | Accesibilidad | El sheet MÃ¡s secciones se abre desde Sidebar.jsx, pero no hay evidencia de trap de foco, devoluciÃ³n de foco ni aria-modal. | Usuarios de teclado/lector pueden escapar al contenido detrÃ¡s del overlay. | Primitive Sheet con foco inicial, Escape, retorno de foco y fondo inert. |
| 7 | Alto | Responsive | La tabbar mÃ³vil es fija (60 px) pero no usa env(safe-area-inset-bottom). | En iPhone con home indicator puede tapar acciones y dejar objetivos tÃ¡ctiles bajos. | AÃ±adir safe area, Ã¡rea tÃ¡ctil mÃ­nima de 44â€“48 px y pruebas reales de iOS/Android. |
| 8 | Alto | Booking UX | Reserva pÃºblica es una pÃ¡gina larga: servicio, fecha, profesional, horario y datos aparecen en una sola secuencia; no hay resumen persistente ni indicador de paso. | El usuario pierde la selecciÃ³n al desplazarse y no sabe cuÃ¡nto falta. | Stepper progresivo o layout con resumen sticky; mantener el refresco de disponibilidad como estado visible. |
| 9 | Medio | Formularios | Fecha usa input nativo sin texto de ayuda de zona horaria ni rango legible; el control depende del picker del sistema. | Diferencias entre Android/iPhone y confusiÃ³n de fechas cercanas a medianoche. | Mostrar fecha formateada, zona horaria del negocio y lÃ­mites; conservar picker nativo como fallback. |
| 10 | Medio | Feedback | Booking usa Cargando reservasâ€¦/Actualizando disponibilidadâ€¦ como texto simple; varios paneles usan Cargando facturaciÃ³nâ€¦. | Baja percepciÃ³n de continuidad y cambios de layout. | Skeletons por secciÃ³n y aria-live=polite para estados de carga/Ã©xito/error. |
| 11 | Medio | OperaciÃ³n | La pantalla de operaciÃ³n muestra dos combobox de pausa con nombres repetidos (Pausa / Break opcional y un segundo select sin label visible). | No queda claro si se define inicio/fin del descanso; especialmente riesgoso en mÃ³vil. | Control compuesto Desde/Hasta con una sola etiqueta, ayuda y validaciÃ³n de intervalo. |
| 12 | Medio | TipografÃ­a | CRM, filtros y badges usan tamaÃ±os de 10â€“12 px en varias reglas. | Lectura pobre en pantallas pequeÃ±as y para usuarios con baja visiÃ³n. | Escala mÃ­nima de 12/13 px para datos secundarios y contraste AA comprobado. |
| 13 | Medio | Componentes | Hay familias separadas de botones: .btn, .landing-button, .booking-button y toggles propios. | Estados hover/focus/disabled no son uniformes. | Definir Button semÃ¡ntico con variantes primary, secondary, ghost, danger, link y tamaÃ±os consistentes. |
| 14 | Medio | Estados | Los empty states cambian copy y jerarquÃ­a entre agenda, notas, mensajes, CRM y facturaciÃ³n. | El producto se siente como mÃ³dulos separados y no guÃ­a la prÃ³xima acciÃ³n. | Primitive EmptyState con tÃ­tulo, contexto, acciÃ³n primaria y estado de retry. |
| 15 | Medio | CRM | La vista inicial de leads puede quedar en â€œ0 leadsâ€ aunque haya negocios; el pipeline no ofrece un resumen visual de etapas en el primer viewport. | Baja comprensiÃ³n del funnel comercial. | Mantener aislamiento por entorno, pero mostrar mÃ©tricas de etapa y filtro activo en un header compacto. |
| 16 | Medio | Plataforma | El panel sandbox es seguro y fijo a tenant 6, pero la informaciÃ³n tÃ©cnica ocupa un bloque denso con texto pequeÃ±o. | Owner/admin puede confundir estado interno, externo y seguridad. | Separar Seguridad, Plan, Checkout y ReconciliaciÃ³n en cards con status y explicaciÃ³n corta. |
| 17 | Medio | ComunicaciÃ³n | Mensajes muestran contenido extenso del bot en el hilo sin resumen ni salto al Ãºltimo mensaje. | Mucho scroll y difÃ­cil detectar el Ãºltimo estado de la conversaciÃ³n. | AÃ±adir resumen de conversaciÃ³n, timestamps agrupados y botÃ³n Ir al Ãºltimo mensaje. |
| 18 | Bajo | Datos/visual | Booking muestra precios con $ y el panel usa $, ARS o USD segÃºn contexto; landing publica USD. | El usuario puede no saber moneda antes de confirmar. | Siempre mostrar sÃ­mbolo + cÃ³digo (ARS 10.000) segÃºn configuraciÃ³n del tenant/proveedor. |
| 19 | Bajo | Branding | Panel de barberia, Clientes y barberos quedan visibles aunque el SaaS ofrece peluquerÃ­a, estÃ©tica, tattoo y otros verticales. | El producto no comunica completamente su capacidad multi-vertical. | Resolver labels desde el perfil vertical y conservar tÃ©rminos tÃ©cnicos sÃ³lo donde correspondan. |
| 20 | Bajo | Performance percibida | App.jsx combina realtime y polling cada 6 segundos; no es un problema funcional observado, pero no se comunica el estado de sincronizaciÃ³n. | Consumo y cambios silenciosos pueden percibirse como parpadeo en equipos lentos. | Instrumentar indicador de frescura y backoff; mantener realtime como fuente principal y polling degradado. |

## AuditorÃ­a por ruta y flujo

### Landing y adquisiciÃ³n â€” /para/:vertical

**Lo que funciona**

- Hero con propuesta concreta, CTA de prueba de 14 dÃ­as, demo aislada y promesa de no pedir tarjeta.
- Narrativa en tres pasos, planes, FAQ y CTA final.
- El vertical se incorpora al tÃ­tulo y existe preparaciÃ³n para otros perfiles.

**Problemas**

- En mÃ³vil se ocultan enlaces secundarios de navegaciÃ³n (Planes, Demo aislada, Ingresar) sin menÃº equivalente. SÃ³lo queda la CTA de registro.
- El lenguaje visual es independiente del resto: colores y superficies hardcodeados en index.css; no responde a data-theme=dark.
- El preview ilustrativo no tiene una alternativa textual equivalente mÃ¡s rica para lector de pantalla.
- Los precios estÃ¡n fijos en USD, mientras que checkout y tenants pueden operar en moneda local.

Prioridad: Alta para menÃº mÃ³vil, dark mode y coherencia de pricing; media para preview/a11y.

### Registro y acceso â€” /ingresar, /registro, /recuperar

**Lo que funciona**

- Login corto con foco inicial en email.
- Registro pide nombre, email, contraseÃ±a y repeticiÃ³n; copy de mÃ­nimo 8 caracteres.
- RecuperaciÃ³n explica que Supabase actualiza de forma segura.

**Problemas**

- El shell visual de auth es distinto del landing y del workspace; falta una jerarquÃ­a compartida (logo, ayuda, volver).
- No se observaron en el snapshot mensajes de error/Ã©xito persistentes ni aria-live; deben probarse con email duplicado, contraseÃ±a invÃ¡lida y enlace vencido.
- No existe control visible de mostrar/ocultar contraseÃ±a en los formularios auditados.

Prioridad: Media, subir a alta antes de campaÃ±as de adquisiciÃ³n.

### Onboarding â€” /onboarding

**Lo que funciona**

- Progreso explÃ­cito de 8 pasos, â€œGuardadoâ€ y promesa de prueba gratuita.
- Primer paso pide sÃ³lo nombre del negocio, acorde al objetivo de fricciÃ³n baja.

**Problemas**

- Los ocho indicadores son genÃ©ricos y no nombran el contenido de cada paso; en mÃ³vil no ayudan a volver a un paso concreto.
- No se ve un resumen persistente de datos completados ni una indicaciÃ³n de quÃ© es opcional.
- Falta una salida â€œguardar y continuar despuÃ©sâ€ evidente para abandono controlado.

Prioridad: Media-alta; impacta activaciÃ³n y conversiÃ³n de trial.

### Demo â€” /demo

**Lo que funciona**

- El snapshot comunica aislamiento: no usa tenants productivos, sesiÃ³n en navegador y sin Supabase/mensajes.
- Permite elegir vertical, color y servicios ficticios.
- La reserva estÃ¡ marcada como sandbox.

**Problemas**

- La demo expone muchos controles de una vez en desktop y se vuelve larga en mÃ³vil.
- Color de marca es un input nativo sin presets ni contraste automÃ¡tico.
- La selecciÃ³n de servicio y reserva ficticia no tiene resumen final compacto.

Prioridad: Media; es una oportunidad de conversiÃ³n, no un bloqueo.

### Reservas pÃºblicas â€” /reservar/:slug

**Lo que funciona**

- El catÃ¡logo llega del tenant por RPC y muestra Ãºnicamente servicios/profesionales con slots.
- La disponibilidad se refresca por foco y cada 30 segundos; antes de confirmar se reconsulta.
- El botÃ³n de modo oscuro tiene nombre accesible y el stylesheet define tokens claros para light/dark.
- En domingo sin agenda el mensaje â€œNo hay horarios disponibles para esta fechaâ€ es claro.
- PhoneField reutiliza el mismo prefijo y formateador que el panel administrativo.

**Problemas**

- El mensaje de telÃ©fono es incorrecto (hallazgo #2).
- Es un flujo de pÃ¡gina Ãºnica sin stepper, resumen ni confirmaciÃ³n de zona horaria.
- La carga de slots puede cambiar servicio y resetear hora; falta explicar por quÃ© se actualizÃ³.
- Los precios no incluyen cÃ³digo de moneda.
- No hay aria-live para cambio de disponibilidad, errores RPC o Ã©xito.

Prioridad: Alta para copy de telÃ©fono, feedback y resumen; media para stepper.

### Workspace de negocio

**Resumen:** checklist visible al 70%, mÃ©tricas de hoy, CTA Nuevo, estado vacÃ­o de agenda y conversaciones recientes. En mÃ³vil existe tabbar con cuatro secciones y MÃ¡s.

**Agenda:** calendario mensual con filtro de barbero, cambio mes/semana, navegaciÃ³n anterior/hoy/siguiente y acciÃ³n Agendar en este dÃ­a. Los turnos tienen nombres/horas y el dÃ­a seleccionado ofrece empty state. La densidad de 42 celdas + panel de dÃ­a necesita prueba especÃ­fica a 360 px; la tabbar debe respetar safe area. La vista semanal necesita leyenda de estados que no dependa sÃ³lo de color.

**Equipo:** tarjetas por barbero con turnos, ingresos y prÃ³ximos turnos. Son comprensibles, pero en mÃ³vil conviene separar resumen y detalle.

**Mensajes:** lista, bÃºsqueda, hilo y bot. Los textos largos dominan el viewport; falta resumen/Ãºltimo mensaje.

**Clientes:** tabla con nombre, telÃ©fono, visita, prÃ³ximo turno, notas y acciones. En mÃ³vil debe transformarse a tarjeta o asegurar scroll con encabezado visible.

**Notas:** estado vacÃ­o con bÃºsqueda y contexto; conviene un CTA explÃ­cito cuando no hay notas.

**EstadÃ­sticas:** KPIs, estados, servicios, serie de 8 dÃ­as y caja. Falta leyenda textual accesible para visualizaciones y cÃ³digo de moneda consistente.

**OperaciÃ³n:** reÃºne servicios, precios, duraciÃ³n, habilidades, dÃ­as, horario y breaks. La ediciÃ³n de tres servicios y tres barberos en una pantalla es densa; los dos selects de pausa tienen etiqueta repetida.

**ConfiguraciÃ³n:** identidad, slug, contacto, WhatsApp, logo, colores, regiÃ³n, reservas y colaboradores. â€œRLS activoâ€ comunica confianza; conviene navegar secciones en pantallas pequeÃ±as.

**FacturaciÃ³n:** en el momento auditado sÃ³lo mostrÃ³ Cargando facturaciÃ³nâ€¦. Debe tener skeleton y estado de error/retry visible.

### Workspace de plataforma â€” /plataforma

**Lo que funciona**

- Rol owner visible, navegaciÃ³n lateral clara y todos los botones respondieron al recorrido.
- CRM lista negocios; existe separaciÃ³n de ProducciÃ³n, Demo, Sandbox e Interno.
- Agente y piloto declaran aprobaciÃ³n humana y ausencia de envÃ­os externos.
- Billing expone tenant tÃ©cnico #6, proveedor sandbox, precio, plan, checkout y regla de no activar por URL.

**Problemas**

- En mÃ³vil el menÃº lateral no tiene variante; las vistas dependen de un aside desktop y son densas.
- Negocios y leads usa tablas; leads declara min-width:780px.
- Agente y piloto muestran muchos campos/checklist en el primer viewport; falta resumen de â€œquÃ© falta para aprobarâ€.
- El bloque sandbox mezcla secrets, plan, checkout, reconciliaciÃ³n y seguridad en una sola card.
- Los estados tÃ©cnicos usan texto pequeÃ±o y labels de infraestructura sin ayuda contextual.

Prioridad: Alta para tablas/mobile; media para densidad y agrupamiento del control sandbox.

## AuditorÃ­a de componentes

| Tratamiento | Componentes/reglas actuales | DecisiÃ³n futura |
|---|---|---|
| Mantener | .panel, .table-scroll, .table, .btn, .link-btn, .btn-icon-plain, .phone-field, .status-pill, PhoneField | Documentar contratos, tamaÃ±os y estados. |
| Fusionar | .btn + .landing-button + .booking-button; theme-toggle de Sidebar y booking | Una primitive Button con variantes y tokens. |
| Fusionar | Empty states de Agenda, Notas, CRM, Billing y booking | EmptyState con tÃ­tulo, contexto, CTA y retry. |
| Extraer | Encabezados de negocio, CRM, billing y onboarding | PageHeader con kicker, tÃ­tulo, descripciÃ³n, acciones y breadcrumb opcional. |
| Extraer | Panel lateral mÃ³vil y modales | Sheet/Modal accesible con foco, Escape, overlay y safe area. |
| Crear | Layout global | AppShell, WorkspaceShell, AuthShell, PublicShell, PlatformShell. |
| Crear | Datos tabulares | DataTable + CardList mÃ³vil, sorting, filtros y empty state. |
| Crear | Formularios | FormField, FieldMessage, PasswordField, DateField y PhoneField extendido. |
| Crear | Estados | StatusBadge, AsyncState, Toast, LiveRegion y ProgressStepper. |
| Deprecar gradualmente | style inline para colores, tamaÃ±os y layouts | Reemplazar por tokens o variantes; conservar sÃ³lo branding dinÃ¡mico. |

## Austral Design System propuesto

### Foundations

- Color semÃ¡ntico: bg.canvas, bg.surface, bg.elevated, fg.default, fg.muted, border.default, brand.primary, status.success/warning/danger/info, con pares light/dark y contraste AA.
- Espaciado en escala 4 px: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- TipografÃ­a: UI Inter; display Fraunces/serif sÃ³lo para marketing y tÃ­tulos. MÃ­nimo 12 px secundarios, 14â€“16 px cuerpo, line-height 1.45â€“1.6.
- Forma: radius-sm 8, md 12, lg 16, xl 22; pill sÃ³lo para estados/filtros.
- Foco: outline 2 px y offset 2, visible en ambos temas.
- Movimiento: 150â€“250 ms, respetar prefers-reduced-motion.
- Breakpoints: 360/390 compacto, 640 mÃ³vil ancho, 768 tablet, 1024 laptop, 1280 desktop. La lÃ³gica de negocio no depende del breakpoint.

### Primitives y contratos

1. Button: primary, secondary, ghost, danger, link; sm/md/lg; loading, disabled, pressed.
2. Field: label, hint, error, required, aria-describedby y aria-invalid.
3. Panel: tÃ­tulo, descripciÃ³n, acciones y density comfortable/compact.
4. StatusBadge: texto + icono opcional; nunca depender sÃ³lo del color.
5. DataTable/CardList: misma fuente de datos, presentaciÃ³n adaptativa.
6. Modal/Sheet: foco contenido, Escape, retorno de foco, aria-labelledby y aria-describedby.
7. Toast/LiveRegion: feedback no bloqueante y anuncios para carga/Ã©xito/error.
8. ProgressStepper: pasos con nombre, completado, actual, bloqueado y guardado.
9. DateTime/SlotPicker: zona horaria visible, disponibilidad, estado reservado/no disponible, touch targets de 48 px.
10. PhoneField: formato visible +54 9 11 0000-0000, valor canÃ³nico interno y copy derivado de la misma regla.

## Recomendaciones por dispositivo

### 360â€“390 px

- Corregir primero el selector de workspace, Ãºnico recorte visual directo observado.
- AÃ±adir padding-bottom con safe-area al shell de negocio.
- Convertir tablas a tarjetas o priorizar cuatro columnas.
- Mantener botones y slots a 48 px.
- Booking debe mostrar resumen sticky de servicio/fecha/hora antes del formulario.
- Landing necesita menÃº compacto.

### 768â€“1024 px

- Agenda debe pasar de calendario + panel lateral a columna priorizada o panel desplegable.
- CRM debe usar filtros apilados.
- Onboarding puede conservar dos columnas sÃ³lo desde 900 px.

### 1366â€“1920 px

- Mantener max-width de lectura de 1180â€“1440 px.
- Separar datos operativos de acciones de alto riesgo.
- Usar whitespace para jerarquÃ­a sin aumentar tamaÃ±os pequeÃ±os.

## Flujos crÃ­ticos

### Agenda y breaks

El modelo permite editar inicio, fin y break por barbero. Visualmente el descanso debe presentarse como intervalo Desde/Hasta, explicar que bloquea disponibilidad y prevenir intervalos fuera de la jornada. El calendario debe mostrar el motivo de un slot no disponible sin depender sÃ³lo del color.

### Reserva pÃºblica

El flujo actual es seguro por reconsulta de disponibilidad y RPC. La mejora prioritaria es hacerlo comprensible: paso actual, zona horaria, resumen, error asociado al campo y estado live cuando la disponibilidad se actualiza.

### CRM/plataforma

Separar ProducciÃ³n, Demo, Sandbox e Interno desde el encabezado del workspace, no sÃ³lo desde un combobox. En Mercado Pago conservar tenant/plan/provider fijados y usar cards de lectura rÃ¡pida; no crear controles genÃ©ricos reutilizables en producciÃ³n.

### Landing y conversiÃ³n

El CTA de prueba es claro. Antes de trÃ¡fico comercial conviene resolver navegaciÃ³n mÃ³vil, dark mode, moneda/cÃ³digo de precio y vÃ­nculo visible a demo desde cualquier viewport.

## Rendimiento percibido y observabilidad visual

- App.jsx mantiene realtime y polling cada 6 segundos; no se observÃ³ error de consola, pero conviene mostrar frescura, backoff y estado degradado.
- Loading text-only debe evolucionar a skeleton estable.
- Grandes hilos de WhatsApp y tablas deben paginar o virtualizar antes de crecer.
- Las acciones de billing sandbox deben conservar confirmaciÃ³n, loading, error sanitizado e idempotencia visible.
- AÃ±adir telemetrÃ­a de UX sin datos sensibles: route_view, onboarding_step_viewed, booking_slot_selected, booking_validation_error, crm_filter_changed y responsive_error_boundary.

## Quick wins

1. Corregir copy de telÃ©fono y asociar error al input.
2. Resolver ancho del selector de workspace a max-width:100%.
3. AÃ±adir safe area y foco de retorno al sheet mÃ³vil.
4. Unificar sÃ­mbolo + cÃ³digo de moneda.
5. Convertir Cargandoâ€¦ a skeleton + aria-live.
6. Nombrar Pausa desde y Pausa hasta.
7. AÃ±adir menÃº mobile a landing.
8. Mostrar ARS/USD segÃºn tenant/proveedor.
9. Crear leyenda textual para colores de agenda.
10. Mostrar breadcrumb o tÃ­tulo de workspace en vistas internas.

## Roadmap recomendado

| Fase | Objetivo | Impacto | Esfuerzo | Dependencias | AceptaciÃ³n |
|---|---|---|---|---|---|
| 0 | Hardening responsive y a11y crÃ­tica | Muy alto | S | Ninguna funcional | Cero recortes a 360/390; sheet accesible; safe area. |
| 1 | Primitives y tokens semÃ¡nticos | Alto | M | Revisar branding dinÃ¡mico | Botones, campos, paneles, estados y tablas comparten light/dark. |
| 2 | Booking guiado | Muy alto | M | Mantener RPC actual | Paso/summary, copy correcto, disponibilidad live, moneda clara. |
| 3 | Agenda/operaciÃ³n mobile-first | Alto | M | Validar breaks existentes | Jornada/break legibles, slots con motivo, ediciÃ³n mÃ³vil. |
| 4 | CRM/plataforma responsive | Alto | M | No tocar RLS/billing | Tablas/cards adaptativas y sandbox claramente aislado. |
| 5 | Landing/onboarding conversiÃ³n | Alto | M | Copy aprobado | MenÃº mobile, dark coherente, pricing por moneda, abandono medible. |
| 6 | Performance y escala | Medio-alto | L | Crecimiento de datos | PaginaciÃ³n/virtualizaciÃ³n, realtime con backoff y mÃ©tricas. |

## Riesgos pendientes y preguntas

- Validar tÃ©rminos de cada vertical con usuarios reales.
- Probar lectores de pantalla y teclado completo en Chrome, Safari iOS y Android; la navegaciÃ³n confirmÃ³ nombres semÃ¡nticos bÃ¡sicos, no cumplimiento total.
- Confirmar contraste de colores de marca introducidos por tenants.
- Probar estado offline, RPC lento y expiraciÃ³n de sesiÃ³n sin leer ni persistir tokens en frontend.
- Mantener pricing/moneda separado del backend de billing: este informe sÃ³lo recomienda presentaciÃ³n.
- Repetir capturas visuales cuando se resuelva el timeout de captura CDP para completar la galerÃ­a por ruta y viewport.

## Entrega de esta etapa

- Informe: docs/UI-UX-AUDITORIA.md.
- Evidencia visual: docs/ui-audit/workspace-selector-390x844.png.
- Cambios funcionales: ninguno.
- Migraciones: ninguna.
- Supabase/RLS/billing/n8n/Evolution: sin cambios.
- Git: sin commits ni push.

Siguiente etapa recomendada: Fase 0, corregir selector de workspace, navegaciÃ³n mÃ³vil, focus management, mensajes de formulario y safe area como conjunto aislado de primitives UI, sin alterar contratos de datos ni reglas de negocio.


