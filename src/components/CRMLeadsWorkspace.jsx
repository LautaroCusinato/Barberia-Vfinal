import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Filter, GitMerge, Import, RefreshCw, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { exportarCSV, parseLeadsCsv } from '../lib/csv'

const STAGES = ['discovered', 'qualified', 'contacted', 'replied', 'interested', 'demo', 'trial', 'negotiating', 'won', 'lost', 'do_not_contact']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const PAGE_SIZE = 25
const stageLabel = (value) => String(value || 'discovered').replaceAll('_', ' ')
const dateLabel = (value) => value ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin fecha'

export default function CRMLeadsWorkspace({ role = 'owner' }) {
  const [leads, setLeads] = useState([]); const [metrics, setMetrics] = useState(null); const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0); const [search, setSearch] = useState(''); const [stage, setStage] = useState(''); const [priority, setPriority] = useState(''); const [environment, setEnvironment] = useState('production')
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [importOpen, setImportOpen] = useState(false); const [preview, setPreview] = useState(null); const [importing, setImporting] = useState(false)
  const [expanded, setExpanded] = useState(null); const fileRef = useRef(null)
  const canWrite = ['owner', 'admin', 'sales', 'automation'].includes(role); const canExport = ['owner', 'admin', 'sales'].includes(role)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    let query = supabase.from('crm_leads').select('id, negocio_id, nombre_contacto, cargo, email, telefono, canal_preferido, pipeline_stage, estado_conversacion, prioridad, score, score_level, score_reasons, do_not_contact, fecha_seguimiento_at, responsable_id, updated_at, crm_negocios(id,nombre,rubro,pais,do_not_contact)', { count: 'exact' }).order('updated_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (search.trim()) query = query.or(`nombre_contacto.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,telefono.ilike.%${search.trim()}%`)
    if (stage) query = query.eq('pipeline_stage', stage)
    if (priority) query = query.eq('prioridad', priority)
    query = query.eq('environment', environment)
    const [result, metricResult] = await Promise.all([query, supabase.rpc('get_crm_pipeline_metrics', { p_environment: environment })])
    if (result.error || metricResult.error) setError(result.error?.message || metricResult.error?.message || 'No se pudo cargar el CRM')
    setLeads(result.data || []); setTotal(result.count || 0); setMetrics(metricResult.data || null); setLoading(false)
  }, [environment, page, priority, search, stage])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [environment, search, stage, priority])

  const groupedDuplicates = useMemo(() => {
    const groups = new Map()
    leads.forEach((lead) => { const key = (lead.email || lead.telefono || '').trim().toLowerCase(); if (key) groups.set(key, [...(groups.get(key) || []), lead]) })
    return [...groups.values()].filter((group) => group.length > 1)
  }, [leads])

  const updateStage = async (lead, nextStage) => {
    const { error: updateError } = await supabase.rpc('set_crm_lead_stage', { p_lead_id: lead.id, p_stage: nextStage, p_note: 'Actualizado desde el pipeline' })
    if (updateError) setError(updateError.message); else { setNotice('Etapa actualizada y auditada.'); load() }
  }
  const updateDnc = async (lead, value) => {
    const { error: updateError } = await supabase.rpc('set_crm_lead_do_not_contact', { p_lead_id: lead.id, p_value: value, p_reason: 'Decisión manual desde CRM' })
    if (updateError) setError(updateError.message); else { setNotice(value ? 'Lead excluido de futuras automatizaciones.' : 'Exclusión removida.'); load() }
  }
  const score = async (lead) => {
    const { error: scoreError } = await supabase.rpc('calculate_crm_lead_score', { p_lead_id: lead.id })
    if (scoreError) setError(scoreError.message); else { setNotice('Score recalculado con razones auditadas.'); load() }
  }
  const mergeDuplicates = async (group) => {
    const keep = group[0]; const duplicateIds = group.slice(1).map((item) => item.id)
    if (!window.confirm(`Combinar ${duplicateIds.length} duplicado(s) dentro de ${keep.nombre_contacto || 'este lead'}? Esta acción conserva historial en el principal.`)) return
    const { error: mergeError } = await supabase.rpc('merge_crm_leads', { p_keep_id: keep.id, p_duplicate_ids: duplicateIds, p_reason: 'Duplicado detectado por email/teléfono' })
    if (mergeError) setError(mergeError.message); else { setNotice('Duplicados combinados y auditados.'); load() }
  }
  const exportLeads = async () => {
    if (!canExport) return setError('Tu rol no tiene permiso para exportar datos masivamente.')
    const { data, error: exportError } = await supabase.rpc('export_crm_leads', { p_environment: environment })
    if (exportError) return setError(exportError.message)
    exportarCSV('leads-crm.csv', data || [], [
      { key: 'negocio', label: 'negocio' }, { key: 'rubro', label: 'rubro' }, { key: 'pais', label: 'pais' }, { key: 'idioma', label: 'idioma' },
      { key: 'nombre_contacto', label: 'nombre' }, { key: 'email', label: 'email' }, { key: 'telefono', label: 'telefono' },
      { key: 'etapa', label: 'etapa' }, { key: 'prioridad', label: 'prioridad' }, { key: 'score', label: 'score' }, { key: 'seguimiento', label: 'seguimiento' },
    ])
    setNotice(`Exportación preparada con ${data?.length || 0} leads y registrada en auditoría.`)
  }
  const handleFile = (event) => {
    const file = event.target.files?.[0]; if (!file) return
    if (file.size > 2 * 1024 * 1024) return setError('El CSV no puede superar 2 MB.')
    const reader = new FileReader(); reader.onload = () => setPreview({ ...parseLeadsCsv(reader.result), name: file.name }); reader.readAsText(file, 'utf-8')
  }
  const importRows = async () => {
    if (!preview || preview.errors.length || !preview.rows.length) return
    setImporting(true); setError('')
    const { data, error: importError } = await supabase.rpc('import_crm_leads', { p_rows: preview.rows.slice(0, 500), p_filename: preview.name })
    if (importError) setError(importError.message); else { setNotice(`Importación completada: ${data?.ok || 0} nuevos, ${data?.duplicates || 0} duplicados, ${data?.errors || 0} errores.`); setImportOpen(false); setPreview(null); load() }
    setImporting(false)
  }

  return <div className="crm-leads-workspace">
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="settings-notice" role="status">{notice}</div>}
    <div className="crm-toolbar">
      <label className="crm-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, email o teléfono" aria-label="Buscar leads" /></label>
      <label className="crm-filter"><Filter size={14} /><select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Filtrar por etapa"><option value="">Todas las etapas</option>{STAGES.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}</select></label>
      <label className="crm-filter"><select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filtrar por prioridad"><option value="">Toda prioridad</option>{PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="crm-filter"><select value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label="Separar entorno"><option value="production">Producción</option><option value="demo">Demo</option><option value="sandbox">Sandbox</option><option value="internal">Interno</option></select></label>
      <button className="btn" onClick={load} disabled={loading}><RefreshCw size={14} /> Actualizar</button>
      {canExport && <button className="btn" onClick={exportLeads}><Download size={14} /> Exportar</button>}
      {canWrite && <button className="btn btn-primary" onClick={() => setImportOpen(true)}><Import size={14} /> Importar CSV</button>}
    </div>
    {metrics && <div className="crm-pipeline-metrics"><div><small>Leads</small><strong>{metrics.leads_total || 0}</strong></div><div><small>Demos</small><strong>{metrics.demos || 0}</strong></div><div><small>Trials</small><strong>{metrics.trials || 0}</strong></div><div><small>Convertidos</small><strong>{metrics.won || 0}</strong></div><div><small>Vencidos</small><strong>{metrics.overdue_actions || 0}</strong></div><div><small>Alta prioridad</small><strong>{metrics.high_priority || 0}</strong></div></div>}
    {groupedDuplicates.length > 0 && <div className="crm-duplicate-alert"><GitMerge size={15} /><span>{groupedDuplicates.length} posible(s) grupo(s) duplicado(s) en esta página.</span><button className="btn" onClick={() => mergeDuplicates(groupedDuplicates[0])}>Revisar primero</button></div>}
    <div className="table-scroll"><table className="table platform-table crm-leads-table"><thead><tr><th>Lead / negocio</th><th>Etapa</th><th>Score</th><th>Prioridad</th><th>Seguimiento</th><th>Controles</th></tr></thead><tbody>{loading ? <tr><td colSpan="6"><div className="empty-state">Cargando leads...</div></td></tr> : leads.length === 0 ? <tr><td colSpan="6"><div className="empty-state">No hay leads con estos filtros.</div></td></tr> : leads.map((lead) => <tr key={lead.id} className={lead.do_not_contact ? 'crm-row-dnc' : ''}>
      <td><button className="crm-lead-summary" onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}><strong>{lead.nombre_contacto || 'Sin nombre'}</strong><small>{lead.crm_negocios?.nombre || 'Sin negocio'} · {lead.email || lead.telefono || 'Sin contacto'}</small></button>{expanded === lead.id && <div className="crm-lead-detail"><span>{lead.crm_negocios?.rubro || 'custom'}{lead.crm_negocios?.pais ? ` · ${lead.crm_negocios.pais}` : ''}</span><span>{lead.score_reasons?.length ? lead.score_reasons.map((reason) => reason.reason).join(' · ') : 'Score todavía no calculado.'}</span></div>}</td>
      <td><select className="crm-inline-select" disabled={!canWrite} value={lead.pipeline_stage || 'discovered'} onChange={(event) => updateStage(lead, event.target.value)} aria-label={`Etapa de ${lead.nombre_contacto || 'lead'}`}>{STAGES.filter((item) => item !== 'do_not_contact').map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}{(lead.do_not_contact || lead.pipeline_stage === 'do_not_contact') && <option value="do_not_contact">do not contact</option>}</select></td>
      <td><button className={`score-badge score-${lead.score_level || 'low'}`} onClick={() => canWrite && score(lead)} title="Recalcular score explicable">{lead.score || 0} · {lead.score_level || 'low'} <Sparkles size={12} /></button></td>
      <td><span className={`priority-badge priority-${lead.prioridad || 'normal'}`}>{lead.prioridad || 'normal'}</span></td>
      <td>{dateLabel(lead.fecha_seguimiento_at)}</td>
      <td><div className="crm-row-actions"><label className="crm-dnc-check"><input type="checkbox" checked={Boolean(lead.do_not_contact)} disabled={!canWrite} onChange={(event) => updateDnc(lead, event.target.checked)} /> <ShieldCheck size={13} /> DNC</label>{canWrite && <button className="btn-icon-plain" onClick={() => { const group = groupedDuplicates.find((items) => items.some((item) => item.id === lead.id)); if (group) mergeDuplicates(group); else setNotice('No se detectó un duplicado por email/teléfono en esta página.') }} title="Combinar duplicado" aria-label="Combinar duplicado"><GitMerge size={14} /></button>}</div></td>
    </tr>)}</tbody></table></div>
    <div className="crm-pagination"><span>{total ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} de ${total}` : '0 leads'}</span><div><button className="btn" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</button><button className="btn" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div></div>
    {importOpen && <div className="modal-overlay" onClick={() => { setImportOpen(false); setPreview(null) }}><div className="modal-box crm-import-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><h2 className="panel-title"><Upload size={17} /> Importar leads CSV</h2><p className="panel-subtitle">Sólo roles de plataforma autorizados · máximo 500 filas y 2 MB.</p></div><button className="btn-icon-plain" onClick={() => { setImportOpen(false); setPreview(null) }} aria-label="Cerrar"><X size={18} /></button></div><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" /><button className="btn" onClick={() => fileRef.current?.click()}>Elegir CSV</button>{preview && <><p className="panel-subtitle">Columnas detectadas: {preview.headers.join(', ') || 'ninguna'}</p>{preview.errors.length > 0 && <div className="error-banner"><strong>{preview.errors.length} error(es):</strong> {preview.errors.slice(0, 4).map((item) => `Fila ${item.row}: ${item.message}`).join(' · ')}{preview.errors.length > 4 ? ' · ...' : ''}</div>}<div className="table-scroll crm-preview"><table className="table"><thead><tr><th>Nombre</th><th>Negocio</th><th>Email</th><th>Teléfono</th><th>Rubro</th></tr></thead><tbody>{preview.rows.slice(0, 8).map((row, index) => <tr key={index}><td>{row.nombre}</td><td>{row.negocio}</td><td>{row.email}</td><td>{row.telefono}</td><td>{row.rubro}</td></tr>)}</tbody></table></div><div className="modal-actions"><button className="btn" onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = '' }}>Limpiar</button><button className="btn btn-primary" disabled={importing || preview.errors.length > 0 || !preview.rows.length} onClick={importRows}>{importing ? 'Importando...' : `Importar ${Math.min(preview.rows.length, 500)} filas`}</button></div></>}</div></div>}
  </div>
}
