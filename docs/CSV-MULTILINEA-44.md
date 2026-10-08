# Tarea 44 · Lectura de registros CSV completos

Propuesta local para revisión independiente. Base `integracion/austral-demo@a3c702c`.
No publica ni modifica el CRM remoto. No requiere migración o dependencia nueva.

## Fallo reproducido

Un CSV con encabezado `nombre,negocio,notas` y un contacto con nota
`"Primera linea\nEva,Norte"` se dividía en dos contactos válidos. El consumidor
pasaba ambos al preview del servidor porque el parser no reportaba errores.

## Corrección

`parseLeadsCsv` lee campos y registros completos con estados de comillas,
conservando LF, CRLF y CR dentro de un campo. Las líneas vacías dentro de
comillas son contenido; las líneas vacías fuera de registros se ignoran.
El separador se detecta en el encabezado, sin contar signos entre comillas.

Se conservan alias, BOM, recorte de espacios en los extremos y validaciones
de fórmula, teléfono, email, nombre, negocio, país e idioma. Un campo no
entrecomillado puede contener comillas literales por compatibilidad; la comilla
abre un campo sólo al inicio, después de espacios. Un campo entrecomillado
exige un cierre correcto y luego sólo espacios, separador o fin del registro.

Comillas sin cerrar, contenido después del cierre y columnas sobrantes
**con contenido** invalidan todo el archivo (las sobrantes vacías, como una
coma final, se ignoran desde la revisión del 07/10): `rows` queda vacío y `errors` explica la causa.
Las columnas faltantes siguen vacías como antes. Los errores usan la línea
física inicial del registro, incluso después de notas de varias líneas.

El límite visible del CRM sigue siendo **500 contactos / 2 MB**. El tamaño
se controla en el componente existente antes de FileReader. El parser ahora
rechaza 501 contactos en vez de permitir que el consumidor corte el archivo
silenciosamente con `slice(0, 500)`. Las filas vacías no cuentan como contactos.

## Verificaciones

- Pruebas existentes de CSV y 15 regresiones nuevas: lectura multilinea,
  comillas escapadas, BOM, encabezado con signos dentro de comillas, errores
  sintácticos, numeración física, fórmulas, límite 500/501 y exportar→importar.
- Matriz adicional de 30 archivos válidos con ambos separadores y tres clases
  de salto de línea: preservación exacta del contenido, sin filas adicionales.
- Verificación del 07/10/2026: lint PASS, npm test PASS, suite completa con
  threads/un worker/cache desactivado PASS (44 archivos / 646 tests), build
  PASS con salida fuera del repo y git diff --check OK. Node 24.18.0.
  Log de unitarios: `C:/Users/lauti/Documents/Codex/2026-10-03/quiero-que-armes-la-lista-completa/work/csv-44-unit.log`.

## Qué revisar antes de integrar

1. El diff afecta sólo la utilidad CSV, pruebas y este documento. No modificar
   `CRMLeadsWorkspace`, permisos de plataforma ni RPC en esta propuesta.
2. Revisar la compatibilidad deliberada de espacios y comillas literales, la
   numeración física y el rechazo en lugar del truncado para más de 500 filas.
3. Probar en el modal real del CRM con un usuario de plataforma autorizado:
   archivo válido con nota multilinea, error visible y ausencia de preview
   remoto en un archivo inválido. No se ejecutó esa prueba aquí.
4. El roundtrip local no implica que el CRM preserve notas al guardar:
   confirmar el contrato de la RPC y la persistencia en una prueba autorizada.

Sin e2e, importaciones reales, escritura en Supabase, mensajes, push o deploy.
La tarea queda sin tildar, preparada para revisión.

## Revisión independiente — 07/10/2026 (Claude)

Regresión corregida: una coma final o columnas sobrantes vacías (`Ana,Salon,`
con encabezado de dos columnas) se importaban antes y la propuesta rechazaba
el archivo entero. Ahora se ignoran; las sobrantes con contenido siguen
invalidando todo el archivo. Tres pruebas en `src/lib/csvImport.revision.test.js`
(dos fallaban sobre `c4e2338`). Revisado sin cambios: multilínea, CR/CRLF,
BOM, comillas escapadas y literales, texto tras el cierre, comillas sin
cerrar, numeración física, 500/501 y fórmulas al inicio de la celda (una
fórmula en la segunda línea de una nota no se ejecuta al abrir el CSV, por lo
que no se marca). Pendiente igual que antes: modal CRM y persistencia reales.
