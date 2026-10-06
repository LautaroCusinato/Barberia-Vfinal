# Moneda del catálogo público — propuesta local de tarea 20

Preparada para revisión sobre `5298537` (incluye 09 y rediseño 37). No aplicada
a QA ni producción. La comprobación de migraciones y fingerprint remoto del
05/10/2026 devolvió Unauthorized en ambos proyectos; el drift sigue pendiente.

La moneda de servicios pertenece a `barberias.moneda`, incorporada en
`20260807000000_self_service_onboarding.sql`. No es la moneda del plan SaaS.
La definición del catálogo en `20260807040000` no la devuelve y el consumidor
cae a ARS. La nueva migración agrega solamente `barberia.moneda` al JSON.
Firma, campos anteriores, filtros, precios numéricos, volatilidad, owner y ACL
se mantienen. No hay conversión, nuevos grants ni acceso directo para anon.

## Preflight y rollback

Leer `scripts/sql/catalogo-moneda/preflight-readonly.sql` en el entorno elegido
antes de aplicar. No devuelve datos de clientes. Revisar también owner/ACL,
el snapshot de la definición completa y la existencia de la columna.

La migración se niega a sobrescribir una función distinta de las dos versiones
revisadas, mediante fingerprint del cuerpo sin whitespace y comprobación de
lenguaje, stable, security definer y search_path. Los hashes no son una prueba
de seguridad o de ausencia de drift general: delimitan qué definición se revisó.
Si se bloquea, **no quitar el guard ni aplicar todas las migraciones**: comparar
y adaptar la propuesta preservando el trabajo remoto.

`scripts/sql/catalogo-moneda/rollback.sql` restaura el contrato anterior sobre
esas mismas versiones, sin tocar tablas, datos, owner ni ACL. Antes de usarlo
en remoto hace falta snapshot y revisión del estado actual. No usar el fixture
`baseline.sql` como bootstrap o rollback de producción.

## Comprobaciones locales

```text
pwsh -File scripts/sql/catalogo-moneda/run.ps1
npm run test:unit -- src/pages/PublicBooking.test.jsx --maxWorkers=1
```

El runner crea PostgreSQL local efímero, un puerto libre y una base aislada;
no carga .env, no acepta URL remota y fija host/usuario/base en cada llamada.
El arranque de pg_ctl usa un proceso oculto y espera sólo al padre para no
bloquear PowerShell. La limpieza valida la ruta temporal absoluta y detiene
primero el cluster propio. Si detenerlo falla, conserva la carpeta.

Prueba SQL en PostgreSQL 18: línea de base que reproduce ausencia de moneda,
ARS/USD/null legado, importe sin conversión, catálogo pausado, slug ausente y
malicioso, servicios filtrados por negocio/actividad, ausencia de campos
privados, contrato anterior salvo moneda, owner/ACL/definer/search_path,
ejecución anon/authenticated sin SELECT directo, doble aplicación, rollback y
rechazo de una definición ajena. Es un esquema mínimo con RLS, no reproduce
todas las políticas ni restricciones del proyecto real.

Frontend: cuatro regresiones nuevas sobre selección/resumen/confirmación con
ARS, USD o campo ausente y cambio de moneda antes de confirmar. La creación
no envía precio o moneda del navegador. Suite total: 28 archivos/395 tests.
Lint, npm test y build pasaron. No e2e, navegador real ni pruebas remotas.

## Pendiente

Revisar diff/SQL y compatibilidad de consumidores, comparar remoto, acordar
despliegue y comprobar la reserva integrada con datos reales. La garantía
atómica del precio y la idempotencia de creación siguen siendo límites de 09;
esta tarea no los resuelve. Mantener 20 sin tildar.
