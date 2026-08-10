import { cloneElement, forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, X } from 'lucide-react'
import ExistingPhoneField from '../PhoneField'
import './ui.css'

const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const joinClass = (...values) => values.filter(Boolean).join(' ')

export const Button = forwardRef(function Button({ variant = 'default', size = 'md', className = '', type = 'button', loading = false, disabled = false, children, ...props }, ref) {
  return <button ref={ref} type={type} className={joinClass('ui-button', 'ui-button-' + variant, 'ui-button-' + size, className)} disabled={loading || disabled} {...props}>{loading && <Spinner size="1em" />}{children}</button>
})

export const IconButton = forwardRef(function IconButton({ label, className = '', type = 'button', children, ...props }, ref) {
  return <button ref={ref} type={type} className={joinClass('ui-icon-button', className)} aria-label={label} title={props.title || label} {...props}>{children}</button>
})

export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={joinClass('ui-input', className)} {...props} />
})

export function PasswordField({ className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  return <div className="ui-password-field"><Input {...props} className={className} type={visible ? 'text' : 'password'} /><IconButton label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="ui-password-toggle" onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>
}

export const PhoneField = ExistingPhoneField

export const Select = forwardRef(function Select({ className = '', children, ...props }, ref) {
  return <select ref={ref} className={joinClass('ui-input', 'ui-select', className)} {...props}>{children}</select>
})

export const Textarea = forwardRef(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={joinClass('ui-input', 'ui-textarea', className)} {...props} />
})

export function Checkbox({ label, className = '', ...props }) {
  return <label className={joinClass('ui-check', className)}><input type="checkbox" {...props} /><span>{label}</span></label>
}

export function Switch({ checked = false, onChange, onClick, label, className = '', ...props }) {
  return <button type="button" role="switch" aria-checked={checked} className={joinClass('ui-switch', checked && 'is-on', className)} onClick={(event) => { onChange?.(!checked); onClick?.(event) }} {...props}><span className="ui-switch-knob" />{label && <span>{label}</span>}</button>
}

export function Badge({ variant = 'muted', className = '', children }) {
  return <span className={joinClass('ui-badge', 'ui-badge-' + variant, className)}>{children}</span>
}

export function StatusBadge({ status, label, className = '' }) {
  const normalized = String(status || 'unknown').toLowerCase().replaceAll(' ', '-')
  const variant = normalized.includes('error') || normalized.includes('cancel') || normalized.includes('failed') ? 'danger' : normalized.includes('pending') || normalized.includes('trial') ? 'warning' : normalized.includes('active') || normalized.includes('confirm') || normalized.includes('success') ? 'success' : 'muted'
  return <Badge variant={variant} className={className}>{label || status || 'Sin estado'}</Badge>
}

export function Card({ as: Component = 'article', className = '', children, ...props }) {
  return <Component className={joinClass('ui-card', className)} {...props}>{children}</Component>
}

export function Panel({ as: Component = 'section', className = '', children, ...props }) {
  return <Component className={joinClass('ui-panel', className)} {...props}>{children}</Component>
}

export function FocusTrap({ open = true, onEscape, className = '', children, ...props }) {
  const containerRef = useRef(null)
  const returnFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    returnFocusRef.current = document.activeElement
    const container = containerRef.current
    if (!container) return undefined
    const focusFirst = () => {
      const target = container.querySelector('[data-autofocus], ' + FOCUSABLE_SELECTOR)
      target?.focus()
    }
    const frame = window.requestAnimationFrame(focusFirst)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onEscape?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    container.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      container.removeEventListener('keydown', handleKeyDown)
      returnFocusRef.current?.focus?.()
    }
  }, [onEscape, open])

  return <div ref={containerRef} className={joinClass('ui-focus-trap', className)} {...props}>{children}</div>
}

export function Modal({ open, onClose, title, labelledBy, children, className = '' }) {
  const generatedTitleId = useId()
  if (!open) return null
  const titleId = labelledBy || generatedTitleId
  return <div className="ui-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}><FocusTrap onEscape={onClose} className={joinClass('ui-modal', className)} role="dialog" aria-modal="true" aria-labelledby={titleId}><header className="ui-modal-header"><h2 id={titleId}>{title}</h2><IconButton label="Cerrar" onClick={onClose}><X size={18} /></IconButton></header>{children}</FocusTrap></div>
}

export function Sheet({ open, onClose, title, children, className = '' }) {
  const titleId = useId()
  if (!open) return null
  return <div className="ui-overlay ui-overlay-sheet" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}><FocusTrap onEscape={onClose} className={joinClass('ui-sheet', className)} role="dialog" aria-modal="true" aria-labelledby={titleId}><header className="ui-sheet-header"><h2 id={titleId}>{title}</h2><IconButton label="Cerrar" onClick={onClose}><X size={18} /></IconButton></header>{children}</FocusTrap></div>
}

export function EmptyState({ icon, title, description, action, className = '' }) {
  return <div className={joinClass('ui-empty-state', className)}>{icon}{title && <h3>{title}</h3>}{description && <p>{description}</p>}{action}</div>
}

export function Skeleton({ width = '100%', height = 12, className = '' }) {
  return <span aria-hidden="true" className={joinClass('ui-skeleton', className)} style={{ width, height }} />
}

export function Spinner({ size = 18, className = '' }) {
  return <LoaderCircle aria-hidden="true" className={joinClass('ui-spinner', className)} size={size} />
}

export function PageHeader({ kicker, title, description, actions, className = '' }) {
  return <header className={joinClass('ui-page-header', className)}><div><p className="ui-kicker">{kicker}</p><h1>{title}</h1>{description && <p className="ui-description">{description}</p>}</div>{actions && <div className="ui-page-actions">{actions}</div>}</header>
}

export function SectionHeader({ title, description, actions, className = '' }) {
  return <header className={joinClass('ui-section-header', className)}><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div>{actions}</div>}</header>
}

export function FormField({ label, hint, error, id, required, children, className = '' }) {
  const generatedId = useId()
  const fieldId = id || generatedId
  const hintId = hint ? fieldId + '-hint' : undefined
  const errorId = error ? fieldId + '-error' : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const control = children && typeof children === 'object' ? cloneElement(children, { id: children.props.id || fieldId, required: children.props.required ?? required, 'aria-describedby': children.props['aria-describedby'] || describedBy, 'aria-invalid': error ? 'true' : children.props['aria-invalid'] }) : children
  return <div className={joinClass('ui-form-field', className)}><label htmlFor={fieldId}>{label}{required && <span aria-hidden="true"> *</span>}</label>{control}{hint && <span id={hintId} className="ui-field-hint">{hint}</span>}{error && <span id={errorId} className="ui-field-error" role="alert">{error}</span>}</div>
}

export function Toast({ tone = 'info', children, onClose }) {
  return <div className={joinClass('ui-toast', 'ui-toast-' + tone)} role={tone === 'danger' ? 'alert' : 'status'} aria-live="polite"><span>{children}</span>{onClose && <IconButton label="Cerrar" onClick={onClose}><X size={15} /></IconButton>}</div>
}

export function Tooltip({ label, children }) {
  const id = useId()
  return <span className="ui-tooltip-wrap"><span aria-describedby={id}>{children}</span><span id={id} role="tooltip" className="ui-tooltip">{label}</span></span>
}
