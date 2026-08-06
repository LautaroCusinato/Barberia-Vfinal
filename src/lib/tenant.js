const DEFAULT_TENANT_ID_FALLBACK = 1

export const VERTICALS = Object.freeze({
  barberia: { label: 'Barbería', staffLabel: 'barberos', customerLabel: 'clientes', serviceLabel: 'servicios', appointmentLabel: 'turnos' },
  peluqueria: { label: 'Peluquería', staffLabel: 'profesionales', customerLabel: 'clientes', serviceLabel: 'servicios', appointmentLabel: 'turnos' },
  salon: { label: 'Salón de belleza', staffLabel: 'profesionales', customerLabel: 'clientes', serviceLabel: 'servicios', appointmentLabel: 'turnos' },
  spa: { label: 'Spa', staffLabel: 'profesionales', customerLabel: 'clientes', serviceLabel: 'tratamientos', appointmentLabel: 'turnos' },
  veterinaria: { label: 'Veterinaria', staffLabel: 'profesionales', customerLabel: 'tutores', serviceLabel: 'servicios', appointmentLabel: 'turnos' },
  gimnasio: { label: 'Gimnasio', staffLabel: 'profesores', customerLabel: 'socios', serviceLabel: 'clases', appointmentLabel: 'reservas' },
  clinica: { label: 'Clínica', staffLabel: 'profesionales', customerLabel: 'pacientes', serviceLabel: 'prestaciones', appointmentLabel: 'turnos' },
  taller: { label: 'Taller', staffLabel: 'técnicos', customerLabel: 'clientes', serviceLabel: 'servicios', appointmentLabel: 'reservas' },
  custom: { label: 'Negocio', staffLabel: 'profesionales', customerLabel: 'clientes', serviceLabel: 'servicios', appointmentLabel: 'reservas' },
})

function envValue(name, fallback = '') {
  return import.meta.env?.[name] || fallback
}

export function parseTenantId(value, fallback = DEFAULT_TENANT_ID_FALLBACK) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeVertical(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(VERTICALS, normalized) ? normalized : 'custom'
}

export const DEFAULT_TENANT_ID = parseTenantId(envValue('VITE_BARBERIA_ID'))
export const DEFAULT_BUSINESS_NAME = envValue('VITE_BUSINESS_NAME', 'Barbería Central')
export const DEFAULT_VERTICAL = normalizeVertical(envValue('VITE_BUSINESS_VERTICAL', 'barberia'))
export const PRODUCT_NAME = envValue('VITE_PRODUCT_NAME', 'Agenda')

export function getVerticalProfile(vertical = DEFAULT_VERTICAL) {
  return VERTICALS[normalizeVertical(vertical)]
}

export function getRuntimeTenant() {
  return {
    id: DEFAULT_TENANT_ID,
    name: DEFAULT_BUSINESS_NAME,
    vertical: DEFAULT_VERTICAL,
    productName: PRODUCT_NAME,
    profile: getVerticalProfile(DEFAULT_VERTICAL),
  }
}

export function tenantStorageKey(key, tenantId = DEFAULT_TENANT_ID) {
  return `tenant-${parseTenantId(tenantId)}-${String(key).replace(/[^a-z0-9_-]/gi, '-')}`
}

