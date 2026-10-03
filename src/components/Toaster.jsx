import { X } from 'lucide-react'
import './toasts.css'

export default function Toaster({ toasts, onClose }) {
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }) {
  return (
    <div className={`toast${toast.saliendo ? ' is-leaving' : ''}`} style={{ '--toast-duration': `${toast.duracion}ms` }}>
      <span className="toast-text">{toast.mensaje}</span>
      {toast.deshacer && (
        <button type="button" className="toast-undo" onClick={() => onClose(toast.id, 'undo')}>Deshacer</button>
      )}
      <button type="button" className="toast-close" onClick={() => onClose(toast.id, 'expire')} aria-label="Cerrar aviso">
        <X size={14} aria-hidden="true" />
      </button>
      <span className="toast-timer" aria-hidden="true" />
    </div>
  )
}
