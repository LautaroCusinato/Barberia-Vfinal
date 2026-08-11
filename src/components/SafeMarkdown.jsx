import { Fragment } from 'react'

// Markdown acotado: negrita, listas simples y saltos. React escapa el texto
// por defecto; nunca se interpreta HTML proveniente del mensaje.
export function stripMarkdown(value = '') {
  return String(value)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
}

function inlineMarkdown(value) {
  const parts = String(value).split(/(\*\*[^*]+\*\*|__[^_]+__)/g)
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*(.+)\*\*$/) || part.match(/^__(.+)__$/)
    return bold
      ? <strong key={index}>{bold[1]}</strong>
      : <Fragment key={index}>{part}</Fragment>
  })
}

export default function SafeMarkdown({ value = '', className = '' }) {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let list = []

  const flushList = () => {
    if (!list.length) return
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}
      </ul>
    )
    list = []
  }

  lines.forEach((line, index) => {
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (item) {
      list.push(item[1])
      return
    }
    flushList()
    if (!line.trim()) return
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(line)}</p>)
  })
  flushList()

  return <div className={`safe-markdown ${className}`.trim()}>{blocks}</div>
}
