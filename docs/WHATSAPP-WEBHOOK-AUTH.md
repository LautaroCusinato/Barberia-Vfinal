# Autenticación de webhooks de WhatsApp Shadow

Estado: preparación offline. No se conectó al servidor, no se cambió Evolution,
n8n ni ningún webhook, y no se activó el workflow `5UQMp5vAMfBfJtSy`.

## Contrato V1

El endpoint privado del Shadow Pilot acepta únicamente un POST que incluya el
header HTTP `X-Austral-Webhook-Secret`. El valor se compara con
`EVOLUTION_WEBHOOK_SECRET` usando una comparación de tiempo constante. El
contrato es deliberadamente pequeño:

| Situación | Respuesta | Regla |
| --- | --- | --- |
| Header correcto y secreto configurado | 200/continúa | recién aquí se valida el evento |
| Header ausente o vacío | 401 | no resolver tenant ni invocar IA/Supabase |
| Header incorrecto | 401 | no revelar si el nombre existe |
| Variable ausente o vacía | 401 | fail-closed; requiere intervención operativa |

No se registra el header, el secreto, Authorization, API keys, cookies, cuerpo
completo ni datos privados. El helper reutilizable está en
`scripts/whatsapp-webhook-auth.mjs`. La validación es la primera etapa del
flujo de prueba y queda separada de la resolución estricta de instancia y
receptor.

La comparación usa buffers de tamaño fijo y `timingSafeEqual`; además exige
igualdad de longitud y valores no vacíos. Esto evita utilizar una igualdad de
cadenas con salida temprana. La protección no reemplaza TLS ni la rotación de
secretos.

## Qué soporta Evolution API 2.3.7

La documentación pública de Evolution describe `headers` configurables en
`POST /webhook/set/{instanceName}` y el header `apikey` para autenticar las
llamadas hacia Evolution. No se encontró un campo público que configure una
firma HMAC saliente por webhook en la versión auditada. Por eso V1 usa un
header estático compartido, que debe considerarse una protección de transporte
aditiva, no una firma criptográfica por evento.

- [Set Webhook](https://docs.evolutionfoundation.com.br/en/evolution-api/set-webhook)
- [Get Webhook](https://docs.evolutionfoundation.com.br/es/evolution-api/get-webhook)
- [Authentication](https://evolutionapi-evolution-api-90.mintlify.app/concepts/authentication)

El header se agrega sólo al nuevo destino del Shadow Pilot. El workflow legacy
`gRTZDLTXvGgNq4BZ` no se edita ni se detiene. Si la instancia comparte un
destino, la aplicación debe detenerse y pedir una decisión: no se sobreescribe
la configuración existente a ciegas.

## Procedimiento para mañana (servidor privado)

Ejecutar desde una copia del repositorio, con variables privadas cargadas en el
entorno del operador. Nunca pegar valores en el chat ni en Git.

1. Confirmar que el host, el contenedor y la instancia son los autorizados:
   `miwsp`. Confirmar que producción Supabase no es objetivo de ninguna prueba.
2. Verificar que `EVOLUTION_BASE_URL` sea la ruta n8n -> Evolution correcta,
   `EVOLUTION_API_KEY` esté disponible en el entorno privado y
   `EVOLUTION_INSTANCE=miwsp` (o aceptar el valor por defecto documentado).
3. Ejecutar primero el dry-run, que sólo hace GET y muestra nombres de
   headers, eventos y estado:

   ```text
   npm run whatsapp:webhook:dry-run
   ```

4. Revisar que el destino sea el del Shadow Pilot, que los eventos/base64/
   `webhookByEvents` permanezcan iguales y que no se afecte el legacy.
5. Cargar `EVOLUTION_WEBHOOK_SECRET` desde el gestor privado. No generarlo en
   el shell compartido ni imprimirlo.
6. Con backup reciente y autorización explícita, aplicar una sola vez:

   ```text
   npm run whatsapp:webhook:apply
   ```

   El script guarda en una ruta privada un backup sanitizado (sólo metadata y
   nombres de headers), preserva URL/eventos/base64/by-events y headers
   existentes, agrega únicamente `X-Austral-Webhook-Secret`, vuelve a consultar
   y confirma sólo su presencia.
7. Verificar que n8n compare el mismo header antes de tenant/IA/Supabase. El
   workflow shadow debe seguir inactivo para tráfico externo hasta autorizar el
   fixture controlado.
8. Ejecutar un único fixture QA anonimizado, repetir su
   `integration_id + event_id`, y revisar `mutation_blocked=true`, cero mensajes
   y cero reservas.

El script nunca usa `--apply` por defecto. En esta preparación offline no se
ejecutó `--apply`, no se llamó a Evolution y no se generó ningún secreto.

## Rollback reversible

Ante cualquier diferencia, detener el piloto y conservar el legacy. Con la
misma instancia/header y la metadata privada del backup:

```text
npm run whatsapp:webhook:rollback
```

El rollback vuelve a leer `miwsp`, elimina sólo el header que esta herramienta
agregó si no existía previamente, conserva los demás campos y vuelve a validar
la presencia de la configuración sin imprimir valores. Si el header ya existía
antes del apply, se conserva y el operador debe seguir el procedimiento manual
de restauración del gestor privado.

## HMAC futuro (no desplegado)

Si se necesita autenticidad por evento, agregar un gateway privado que reciba
Evolution, valide una firma HMAC con timestamp/nonce y reenvíe a n8n sólo el
payload aceptado. Debe tener replay protection, rotación, allowlist de origen,
logs sanitizados y un kill switch. No se implementó ni se activó en esta etapa.

## Evidencia offline

`npm run whatsapp:webhook:self-test` verifica preservación de configuración,
no exposición del valor y rollback. `npm run whatsapp:shadow:offline` verifica
el contrato A-G, fixture `E2E_QA_WA_SHADOW_001`, identidad cruzada, modos no
permitidos, timeout/JSON inválido de mocks, disponibilidad vacía/disponible,
idempotencia y cero mutaciones/mensajes. Ambas pruebas no hacen red.
