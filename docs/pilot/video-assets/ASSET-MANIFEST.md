# Austral video asset manifest

**Captura:** 2026-09-03  ·  **Viewport:** 1440×900  ·  **Tema:** oscuro  ·  **Audio:** ninguno

## SCREENSHOTS_CAPTURED

Todos los archivos son PNG, 1440×900, capturados con Playwright desde el entorno autorizado. Los hashes SHA-256 permiten verificar que no fueron reemplazados.

| Archivo | Pantalla / origen | Bytes | SHA-256 | Nota de seguridad |
|---|---|---:|---|---|
| `screens/01-landing.png` | Landing pública `/` | 174460 | `BECCF7406F1CFDFE7AAC00DC374862BB6C63217FE70010AF55789E339F499D13` | Propuesta y marca; sin datos reales. |
| `screens/02-public-booking.png` | Sección de reserva pública del landing | 100070 | `542F60347009501CADFD4FA6909CABD93BE4C5A06DFDA0394218138FB52225A9` | Representación comercial de reserva pública; el slug público demo no estaba disponible. |
| `screens/03-booking-selection.png` | Workspace `/demo` → Agenda → Nuevo turno | 221310 | `78F884914B3E4005C9CF76350D3D898922AFB81A302FE36ABBEC404AA4592F3B` | Selector de turno con datos ficticios; no se confirmó ni guardó. |
| `screens/04-dashboard.png` | Workspace `/demo` → Resumen | 195686 | `D0121223DC7F49F3E70EA84EAC5F0CFC4ACFE896876A598A8B52683FA258A3C8` | Dashboard demo. |
| `screens/05-agenda.png` | Workspace `/demo` → Agenda | 190204 | `14BCB865BFFBB25754CF603F86F21EDBDB93F5BA16C7DD52F3D16791F1A06E26` | Turnos y estados ficticios. |
| `screens/06-clientes.png` | Workspace `/demo` → Clientes | 162136 | `09B7B077100F5FE7679B7F8E63AE824D3BC63961926B699DEF8B7CC23F20EF3A` | Clientes y teléfonos sintéticos del fixture demo. |
| `screens/07-servicios.png` | Workspace `/demo` → Operación (Servicios y precios) | 226566 | `C41DB48D38A480CC96AEB6CC5ED135C8BA98CF027C14303DC9BCD317371E7BC9` | Catálogo demo, sin datos reales. |
| `screens/08-equipo.png` | Workspace `/demo` → Equipo | 165172 | `006869E12409E5BFE2B116A7751D1E6061898EF8FC75F5BF9A3EBACD1B952DB6` | Barberos demo y horarios ficticios. |
| `screens/09-configuracion.png` | Workspace `/demo` → Configuración | 157662 | `F54E234C84A5E0F60540962F1FFFC526EBE5485F7FAC8947C00E1CF365A9CD9B` | Reglas de agenda y branding demo. |
| `screens/10-facturacion.png` | Workspace `/demo` → Facturación | 177793 | `A437D11D9C1B3B3F6944AAE80C5310153E2E6222DD26A2CCF36119C77334DC73` | Precio/trial visibles; nombres de proveedores de pago sanitizados. |

## VIDEO_CLIPS_CAPTURED

`0` — omitidos. No se creó grabación WebM porque las capturas estáticas son suficientes y evitan introducir audio, mutaciones o complejidad innecesaria.

## BRANDING_ASSETS_READY

No hay archivos independientes de logo o wordmark. Ver [`branding/README.md`](./branding/README.md); la marca queda preservada en las capturas.

## Fuente y límites

- Fuente: <https://barberia-qa.cuchitron.lat/> y su ruta segura `/demo`.
- No se utilizaron credenciales, producción, developer tools, consola, URLs internas ni datos privados.
- No se realizaron envíos, cobros, trials, reservas reales ni cambios persistentes.
- `03-booking-selection.png` abre un modal de selección y se captura antes de pulsar “Agendar turno”.
