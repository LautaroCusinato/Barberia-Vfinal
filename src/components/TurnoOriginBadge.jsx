import { Globe2, MessageCircle } from 'lucide-react'

const ORIGINS = {
  whatsapp: { label: 'WhatsApp', title: 'Agendado por WhatsApp', modifier: 'wsp', Icon: MessageCircle },
  reserva_web: { label: 'Web', title: 'Agendado desde la web', modifier: 'web', Icon: Globe2 },
}

export default function TurnoOriginBadge({ origen, compact = false }) {
  const origin = Object.hasOwn(ORIGINS, origen) ? ORIGINS[origen] : null
  if (!origin) return null
  if (compact) return <span className={`origen-indicator origen-indicator--${origin.modifier}`} title={origin.title} aria-label={origin.title} />
  const Icon = origin.Icon
  return <span className={`origen-badge origen-badge--${origin.modifier}`} title={origin.title}>
    <Icon size={10} strokeWidth={2.5} aria-hidden="true" />{origin.label}
  </span>
}
