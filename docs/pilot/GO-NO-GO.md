# Go / No-Go del primer piloto

Decidir por evidencia, no por entusiasmo comercial. La firma final corresponde a la persona responsable del producto y de la operación.

## Bloqueos obligatorios

Debe haber cero P0 y cero P1 abiertos. Un P0/P1 de seguridad, datos, aislamiento, reserva básica, Auth o infraestructura impide el GO aunque la interfaz se vea bien.

## Checklist previo

- [ ] RC aprobado y commit documentado; branch/artefacto reproducible.
- [ ] Backup verificable y restore drill exitoso; rollback escrito.
- [ ] Servidor y servicios críticos saludables, con acceso operativo confirmado.
- [ ] Historial/migraciones revisado; cambios productivos aprobados explícitamente.
- [ ] Entorno y variables productivas revisados sin exponer secretos.
- [ ] Smoke de login, onboarding, Agenda, Servicios, Equipo, Clientes y reserva pública.
- [ ] Trial server-side de 15 días y continuidad manual entendidos.
- [ ] Billing automático, pagos y cargos permanecen deshabilitados salvo aprobación separada.
- [ ] WhatsApp dedicado y alcance aprobado; `miwsp` intacta; outbound/auto-reply apagados por defecto.
- [ ] Tenant isolation, RLS, RPC, idempotencia y guards verificados.
- [ ] Soporte, severidades, contacto y primera revisión de 24 h acordados.
- [ ] Legal/comercial: privacidad, trial, precios, continuidad y cancelación revisados.

## Decisión

**GO** sólo si todos los checks obligatorios están marcados, el dueño conoce el alcance y existe una ventana de rollback. **NO-GO** si falta backup/restore, hay P0/P1, un servicio crítico no está verificable, se requiere una mutación no aprobada o los textos comerciales prometen funciones no definidas.

Registrar fecha, commit, responsable, cohort/tenant sanitizado, checks ejecutados, pendientes P2/P3 y próxima revisión. Un GO de piloto no es autorización para billing productivo, WhatsApp productivo ni ampliar la cohorte sin nueva revisión.
