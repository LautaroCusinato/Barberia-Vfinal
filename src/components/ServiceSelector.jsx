import { CheckCircle2 } from 'lucide-react'

export default function ServiceSelector({ servicios, selectedId, onSelect }) {
  return (
    <div className="service-grid-public">
      {servicios.map(s => {
        const seleccionado = s.id === selectedId
        return (
          <button
            key={s.id}
            className={`service-card ${seleccionado ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="service-card-header">
              <span className="service-name">{s.nombre}</span>
              {seleccionado && <CheckCircle2 size={20} className="service-check" />}
            </div>
            <div className="service-card-details">
              <span>⏱ {s.duracion} min</span>
              <span className="service-price">${s.precio}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}