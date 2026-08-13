import { useEffect, useId, useState } from 'react'

const SDK_SRC = 'https://sdk.mercadopago.com/js/v2'
let sdkPromise

function loadMercadoPagoSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Mercado Pago sólo puede inicializarse en el navegador.'))
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SDK_SRC}"]`)
    const script = existing || document.createElement('script')
    const finish = () => window.MercadoPago ? resolve(window.MercadoPago) : reject(new Error('No se pudo cargar el formulario seguro de Mercado Pago.'))
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error('No se pudo cargar el formulario seguro de Mercado Pago.')), { once: true })
    if (!existing) {
      script.src = SDK_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
  return sdkPromise
}

/**
 * Card fields are rendered and tokenized by Mercado Pago.js. PAN/CVV never
 * enter React state, application logs, Supabase, or the API request body.
 */
export default function MercadoPagoCardTokenForm({ publicKey, amount, currency = 'ARS', email = '', onToken, onCancel, disabled = false }) {
  const id = useId().replace(/:/g, '')
  const formId = `mp-card-form-${id}`
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    let cardForm
    if (!publicKey || disabled) {
      setStatus('disabled')
      return undefined
    }
    loadMercadoPagoSdk().then((MercadoPago) => {
      if (disposed) return
      const mp = new MercadoPago(publicKey, { locale: 'es-AR' })
      cardForm = mp.cardForm({
        amount: String(amount),
        iframe: true,
        form: {
          id: formId,
          cardNumber: { id: `${formId}-card-number`, placeholder: 'Número de tarjeta' },
          expirationDate: { id: `${formId}-expiration`, placeholder: 'MM/AA' },
          securityCode: { id: `${formId}-security-code`, placeholder: 'CVV' },
          cardholderName: { id: `${formId}-cardholder`, placeholder: 'Nombre del titular' },
          cardholderEmail: { id: `${formId}-email`, placeholder: 'Email' },
          issuer: { id: `${formId}-issuer`, placeholder: 'Banco emisor' },
          installments: { id: `${formId}-installments`, placeholder: 'Cuotas' },
          identificationType: { id: `${formId}-identification-type`, placeholder: 'Tipo de documento' },
          identificationNumber: { id: `${formId}-identification-number`, placeholder: 'Número de documento' },
        },
        callbacks: {
          onFormMounted: (mountError) => {
            if (disposed) return
            if (mountError) {
              setError('No se pudo preparar el formulario seguro.')
              setStatus('error')
            } else setStatus('ready')
          },
          onSubmit: (event) => {
            event.preventDefault()
            if (disposed) return
            setError('')
            setStatus('processing')
            try {
              const data = cardForm.getCardFormData()
              if (!data?.token) throw new Error('Mercado Pago no devolvió un token válido.')
              onToken(data.token)
            } catch {
              setError('No se pudo validar la tarjeta. Revisá los datos e intentá nuevamente.')
              setStatus('error')
            }
          },
          onFetching: (resource) => {
            if (disposed) return
            setStatus(resource ? 'processing' : 'ready')
          },
        },
      })
    }).catch((loadError) => {
      if (disposed) return
      setError(loadError.message)
      setStatus('error')
    })
    return () => {
      disposed = true
      if (cardForm?.unmount) cardForm.unmount()
      if (cardForm?.destroy) cardForm.destroy()
    }
  }, [amount, disabled, formId, onToken, publicKey])

  if (disabled || !publicKey) return <div className="billing-card-disabled" role="status">El checkout productivo todavía no está habilitado.</div>

  return (
    <form id={formId} className="billing-card-form" onSubmit={(event) => event.preventDefault()} aria-describedby={`${formId}-help`}>
      <p id={`${formId}-help`} className="billing-helper">Datos protegidos por Mercado Pago. Austral recibe únicamente un token de un solo uso.</p>
      <div className="billing-card-grid">
        <label htmlFor={`${formId}-card-number`}>Número de tarjeta<input id={`${formId}-card-number`} autoComplete="cc-number" inputMode="numeric" /></label>
        <label htmlFor={`${formId}-expiration`}>Vencimiento<input id={`${formId}-expiration`} autoComplete="cc-exp" inputMode="numeric" /></label>
        <label htmlFor={`${formId}-security-code`}>Código de seguridad<input id={`${formId}-security-code`} autoComplete="cc-csc" inputMode="numeric" /></label>
        <label htmlFor={`${formId}-cardholder`}>Titular<input id={`${formId}-cardholder`} autoComplete="cc-name" /></label>
        <label htmlFor={`${formId}-email`}>Email de facturación<input id={`${formId}-email`} defaultValue={email} autoComplete="email" type="email" /></label>
        <label htmlFor={`${formId}-identification-type`}>Documento<select id={`${formId}-identification-type`} defaultValue=""><option value="" disabled>Tipo</option></select></label>
        <label htmlFor={`${formId}-identification-number`}>Número de documento<input id={`${formId}-identification-number`} inputMode="numeric" /></label>
        <label htmlFor={`${formId}-issuer`}>Banco emisor<select id={`${formId}-issuer`} defaultValue=""><option value="" disabled>Seleccioná</option></select></label>
        <label htmlFor={`${formId}-installments`}>Cuotas<select id={`${formId}-installments`} defaultValue=""><option value="" disabled>Seleccioná</option></select></label>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="billing-card-actions">
        <button className="btn btn-primary" type="submit" disabled={status !== 'ready'}>{status === 'processing' ? 'Verificando…' : `Suscribirme por ${new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(Number(amount))}`}</button>
        {onCancel && <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  )
}
