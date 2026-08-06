import { PREFIJO_AR, formatTelefonoAR } from '../lib/text'

// Campo único para toda la aplicación. El estado conserva el valor visible
// (+54 9 11 0000-0000); al persistir cada flujo lo normaliza con soloDigitos.
export default function PhoneField({ value = PREFIJO_AR, onChange, className = '', ...inputProps }) {
  const telefono = value || PREFIJO_AR

  return (
    <div className={`phone-field ${className}`.trim()}>
      <span className="phone-prefix" aria-hidden="true">{PREFIJO_AR}</span>
      <input
        {...inputProps}
        className={`text-input phone-input ${inputProps.className || ''}`.trim()}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="0000-0000"
        value={telefono.slice(PREFIJO_AR.length)}
        onChange={(event) => onChange(formatTelefonoAR(event.target.value))}
      />
    </div>
  )
}
