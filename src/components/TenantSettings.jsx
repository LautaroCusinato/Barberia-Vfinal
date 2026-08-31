import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ImagePlus, Save, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { getAppOrigin } from '../lib/authRedirect'
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel.jsx'
import { EmptyState, Skeleton } from './ui'

const DEFAULTS = {
  nombre: '', descripcion: '', slug: '', vertical: 'barberia', pais: 'AR', locale: 'es-AR', zona_horaria: 'America/Argentina/Buenos_Aires', moneda: 'ARS', direccion: '', email: '', telefono: '', whatsapp: '', logo_url: '', logo_storage_path: '', color_principal: '#9B6A2F', color_secundario: '#EDE6D8', reservas_publicas: true, politica_cancelacion: '', anticipacion_minutos: 60, max_dias_reserva: 60, intervalo_reserva_min: 15,
}

const ROLE_LABELS = { admin: 'Administrador', recepcionista: 'Recepción', empleado: 'Empleado', readonly: 'Sólo lectura', barbero: 'Barbero' }

function cleanError(error) { return String(error?.message || 'No se pudo completar la operación.').replace(/^.*?ERROR:\s*/i, '').replace(/\s*DETAIL:.*$/i, '') }

function SettingsLoadingState() {
  return (
    <div className="management-screen management-settings settings-page settings-loading-state" role="status" aria-busy="true" aria-label="Cargando configuración">
      <span className="sr-only">Cargando configuración…</span>
      <header className="settings-loading-header">
        <div className="settings-loading-stack">
          <Skeleton width="112px" height={10} />
          <Skeleton width="min(280px, 70vw)" height={30} />
          <Skeleton width="min(360px, 82vw)" height={12} />
        </div>
        <Skeleton width="116px" height={26} />
      </header>

      <section className="panel settings-loading-whatsapp">
        <div className="settings-loading-card-heading">
          <div className="settings-loading-stack">
            <Skeleton width="130px" height={10} />
            <Skeleton width="220px" height={18} />
            <Skeleton width="min(520px, 82vw)" height={11} />
          </div>
          <Skeleton width="94px" height={25} />
        </div>
        <Skeleton width="100%" height={62} />
        <div className="settings-loading-actions"><Skeleton width="132px" height={36} /><Skeleton width="112px" height={36} /></div>
      </section>

      <div className="settings-grid">
        {[1, 2, 3].map((card) => (
          <section className="panel settings-card settings-loading-card" key={card}>
            <Skeleton width="170px" height={18} />
            <div className="settings-loading-fields">
              <div className="settings-loading-field"><Skeleton width="92px" height={10} /><Skeleton width="100%" height={40} /></div>
              <div className="settings-loading-field"><Skeleton width="118px" height={10} /><Skeleton width="100%" height={40} /></div>
              <div className="settings-loading-field-row"><Skeleton width="100%" height={40} /><Skeleton width="100%" height={40} /></div>
            </div>
          </section>
        ))}
      </div>

      <section className="panel settings-card settings-loading-card settings-loading-collaborators">
        <div className="settings-loading-stack"><Skeleton width="170px" height={18} /><Skeleton width="min(520px, 82vw)" height={11} /></div>
        <div className="settings-loading-invite-row"><Skeleton width="100%" height={40} /><Skeleton width="150px" height={40} /><Skeleton width="132px" height={40} /></div>
        <div className="settings-loading-list"><div className="settings-loading-list-row"><Skeleton width="150px" height={14} /><Skeleton width="108px" height={32} /></div><div className="settings-loading-list-row"><Skeleton width="190px" height={14} /><Skeleton width="108px" height={32} /></div></div>
      </section>

      <section className="panel settings-card settings-loading-card settings-loading-activity">
        <div className="settings-loading-stack"><Skeleton width="160px" height={18} /><Skeleton width="min(460px, 78vw)" height={11} /></div>
        <div className="settings-loading-list"><Skeleton width="100%" height={40} /><Skeleton width="100%" height={40} /></div>
      </section>
    </div>
  )
}

export default function TenantSettings({ barberiaId, onBrandingChange, demoMode = false }) {
  const demoStorageKey = `austral-demo-settings:${barberiaId}`
  const demoDefaults = useMemo(() => ({ ...DEFAULTS, nombre: 'Barbería Demo Austral', descripcion: 'Un negocio de servicios listo para ordenar su operación.', slug: 'barberia-demo-austral', pais: 'AR', locale: 'es-AR', zona_horaria: 'America/Argentina/Buenos_Aires', moneda: 'ARS', direccion: 'Av. Demo 123, CABA', email: 'hola@barberia-demo.invalid', telefono: '+54 9 11 0000 0000', whatsapp: '+54 9 11 0000 0000', reservas_publicas: true, color_principal: '#9B6A2F', color_secundario: '#EDE6D8' }), [])
  const readDemoForm = useCallback(() => { try { return { ...demoDefaults, ...(JSON.parse(localStorage.getItem(demoStorageKey) || 'null') || {}) } } catch { return demoDefaults } }, [demoDefaults, demoStorageKey])
  const [form, setForm] = useState(() => (demoMode ? readDemoForm() : DEFAULTS))
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured && !demoMode)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingOldLogoPath, setPendingOldLogoPath] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'empleado', expires: 7 })
  const [inviteLink, setInviteLink] = useState('')
  const [inviteSaving, setInviteSaving] = useState(false)
  const [memberPending, setMemberPending] = useState({})
  const [invitationNow] = useState(() => Date.now())
  const inviteEmailRef = useRef(null)

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const load = useCallback(async () => {
    if (demoMode) {
      setForm(readDemoForm())
      setMembers([{ id: 'demo-owner', role: 'owner', profiles: { full_name: 'Equipo Demo Austral' } }])
      setInvitations([]); setActivity([]); setLoading(false); return
    }
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [settingsResult, membersResult, invitationsResult, activityResult] = await Promise.all([
        supabase.rpc('get_tenant_settings', { p_barberia_id: barberiaId }),
        // `barberia_members.user_id` references auth.users, not public.profiles;
        // embedding profiles here makes PostgREST return PGRST200 and breaks
        // the whole settings screen. Keep the member list tenant-scoped and
        // fall back to the safe user id when a display profile is unavailable.
        supabase.from('barberia_members').select('id, user_id, role, created_at').eq('barberia_id', barberiaId).order('created_at'),
        supabase.from('barberia_invitaciones').select('id, email, role, status, expires_at, created_at').eq('barberia_id', barberiaId).order('created_at', { ascending: false }).limit(20),
        supabase.from('saas_audit_log').select('id, event_name, metadata, created_at').eq('barberia_id', barberiaId).order('created_at', { ascending: false }).limit(20),
      ])
      if (settingsResult.error) setError(cleanError(settingsResult.error))
      if (settingsResult.data) setForm((current) => ({ ...current, ...settingsResult.data }))
      if (!membersResult.error) setMembers(membersResult.data || [])
      if (!invitationsResult.error) setInvitations(invitationsResult.data || [])
      if (!activityResult.error) setActivity(activityResult.data || [])
    } catch (loadError) {
      setError(cleanError(loadError))
    } finally {
      setLoading(false)
    }
  }, [barberiaId, demoMode, readDemoForm])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      if (demoMode) {
        localStorage.setItem(demoStorageKey, JSON.stringify(form))
        setNotice('Configuración demo guardada. Sólo afecta esta sesión local.')
        onBrandingChange?.({ nombre: form.nombre, logo_url: form.logo_url, logo_storage_path: form.logo_storage_path, color_principal: form.color_principal, color_secundario: form.color_secundario, zona_horaria: form.zona_horaria })
        return
      }
      const { error: saveError } = await supabase.rpc('update_tenant_settings', {
        p_barberia_id: barberiaId, p_nombre: form.nombre, p_descripcion: form.descripcion, p_slug: form.slug, p_vertical: form.vertical,
        p_pais: form.pais, p_locale: form.locale, p_zona_horaria: form.zona_horaria, p_moneda: form.moneda, p_direccion: form.direccion,
        p_email: form.email, p_telefono: form.telefono, p_whatsapp: form.whatsapp, p_logo_url: form.logo_url, p_logo_storage_path: form.logo_storage_path,
        p_color_principal: form.color_principal, p_color_secundario: form.color_secundario, p_reservas_publicas: form.reservas_publicas,
        p_politica_cancelacion: form.politica_cancelacion, p_anticipacion_minutos: Number(form.anticipacion_minutos), p_max_dias_reserva: Number(form.max_dias_reserva), p_intervalo_reserva_min: Number(form.intervalo_reserva_min),
      })
      if (saveError) { setError(cleanError(saveError)); return }
      if (pendingOldLogoPath && pendingOldLogoPath !== form.logo_storage_path) {
        const { error: cleanupError } = await supabase.storage.from('tenant-logos').remove([pendingOldLogoPath])
        if (cleanupError) setError('Configuración guardada, pero no se pudo limpiar el logo anterior.')
      }
      setPendingOldLogoPath('')
      setNotice('Configuración guardada.')
      onBrandingChange?.({ nombre: form.nombre, logo_url: form.logo_url, logo_storage_path: form.logo_storage_path, color_principal: form.color_principal, color_secundario: form.color_secundario })
      await load()
    } catch (saveError) {
      setError(cleanError(saveError))
    } finally {
      setSaving(false)
    }
  }

  const uploadLogo = async (event) => {
    if (demoMode) { setError('La demo no sube archivos. Podés probar colores y branding sin tocar Storage.'); return }
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('El logo debe ser PNG, JPG, WebP o SVG y pesar hasta 2 MB.'); return }
    setUploading(true); setError('')
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${barberiaId}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })
      if (uploadError) { setError(cleanError(uploadError)); return }
      const { data } = supabase.storage.from('tenant-logos').getPublicUrl(path)
      update('logo_url', data.publicUrl); update('logo_storage_path', path)
      if (form.logo_storage_path && form.logo_storage_path !== path) setPendingOldLogoPath(form.logo_storage_path)
      setNotice('Logo cargado. Guardá la configuración para publicarlo.')
    } catch (uploadError) {
      setError(cleanError(uploadError))
    } finally {
      setUploading(false)
    }
  }

  const createInvite = async (event) => {
    event.preventDefault()
    if (demoMode) { setNotice('Las invitaciones se habilitan al crear tu cuenta real.'); return }
    if (inviteSaving) return
    setInviteSaving(true); setError(''); setNotice(''); setInviteLink('')
    try {
      const { data, error: inviteError } = await supabase.rpc('create_barberia_invitation', { p_barberia_id: barberiaId, p_email: invite.email, p_role: invite.role, p_expires_days: Number(invite.expires) })
      if (inviteError) { setError(cleanError(inviteError)); return }
      if (!data?.token) { setError('La invitación se creó, pero no se recibió un enlace para compartir.'); return }
      const link = `${getAppOrigin()}/invitacion/${data.token}`
      setInviteLink(link)
      setInvite({ email: '', role: 'empleado', expires: 7 })
      setNotice('Invitación creada. Copiá y compartí el enlace manualmente; no se envía email automático.')
      await load()
    } catch (inviteError) {
      setError(cleanError(inviteError))
    } finally {
      setInviteSaving(false)
    }
  }

  const copyInvite = async () => { await navigator.clipboard?.writeText(inviteLink); setNotice('Enlace copiado para compartir manualmente.') }
  const cancelInvite = async (id) => {
    if (demoMode || memberPending[`invite:${id}`]) return
    setMemberPending((current) => ({ ...current, [`invite:${id}`]: true })); setError('')
    try {
      const { error: cancelError } = await supabase.from('barberia_invitaciones').update({ status: 'canceled' }).eq('id', id).eq('barberia_id', barberiaId).eq('status', 'pending')
      if (cancelError) setError(cleanError(cancelError)); else await load()
    } catch (cancelError) {
      setError(cleanError(cancelError))
    } finally {
      setMemberPending((current) => ({ ...current, [`invite:${id}`]: false }))
    }
  }

  const invitationState = (item) => {
    if (item.status === 'pending' && item.expires_at && new Date(item.expires_at).getTime() <= invitationNow) return { label: 'Vencida', tone: 'expired', actionable: false }
    if (item.status === 'accepted') return { label: 'Aceptada', tone: 'accepted', actionable: false }
    if (item.status === 'canceled') return { label: 'Cancelada', tone: 'canceled', actionable: false }
    if (item.status === 'rejected') return { label: 'Rechazada', tone: 'canceled', actionable: false }
    return { label: 'Pendiente', tone: 'pending', actionable: true }
  }
  const changeRole = async (member, role) => {
    const key = `member:${member.id}`
    if (demoMode || member.role === 'owner' || memberPending[key]) return
    setMemberPending((current) => ({ ...current, [key]: true })); setError('')
    try {
      const { error: roleError } = await supabase.from('barberia_members').update({ role }).eq('id', member.id).eq('barberia_id', barberiaId)
      if (roleError) setError(cleanError(roleError)); else await load()
    } catch (roleError) {
      setError(cleanError(roleError))
    } finally {
      setMemberPending((current) => ({ ...current, [key]: false }))
    }
  }
  const removeMember = async (member) => {
    const key = `member:${member.id}`
    if (demoMode || member.role === 'owner' || memberPending[key] || !window.confirm(`¿Retirar el acceso de ${member.profiles?.full_name || member.user_id}?`)) return
    setMemberPending((current) => ({ ...current, [key]: true })); setError('')
    try {
      const { error: removeError } = await supabase.from('barberia_members').delete().eq('id', member.id).eq('barberia_id', barberiaId)
      if (removeError) setError(cleanError(removeError)); else await load()
    } catch (removeError) {
      setError(cleanError(removeError))
    } finally {
      setMemberPending((current) => ({ ...current, [key]: false }))
    }
  }

  const publicUrl = useMemo(() => form.slug ? `${window.location.origin}/reservar/${form.slug}` : '', [form.slug])

  if (loading) return <SettingsLoadingState />
  if (!isSupabaseConfigured && !demoMode) return <div className="panel empty-state">Configurá Supabase para editar el negocio.</div>

  return <div className="management-screen management-settings settings-page fade-in">
    <div className="page-header"><div><p className="page-kicker">Negocio y marca</p><h1 className="page-title">Configuración del negocio</h1><p className="page-date">{demoMode ? 'Probá branding y preferencias sin modificar ningún negocio real.' : 'Los cambios se validan y afectan sólo a este negocio.'}</p></div><span className="billing-security"><ShieldCheck size={14} /> {demoMode ? 'Sesión aislada' : 'Acceso protegido'}</span></div>
    {error && <div className="error-banner" role="alert">{error}</div>}{notice && <div className="settings-notice" role="status"><Check size={15} /> {notice}</div>}
    <WhatsAppConnectionPanel barberiaId={barberiaId} demoMode={demoMode} />
    <form className="settings-grid" onSubmit={save} aria-busy={saving || uploading}>
      <section className="panel settings-card"><h2 className="panel-title">Identidad y contacto</h2><div className="settings-fields">
        <label>Nombre comercial<input className="text-input" required value={form.nombre} onChange={(e) => update('nombre', e.target.value)} /></label>
        <label>Descripción<textarea className="text-input" rows="3" value={form.descripcion || ''} onChange={(e) => update('descripcion', e.target.value)} /></label>
        <label>Slug público<input className="text-input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(e) => update('slug', e.target.value.toLowerCase())} /><small>Reservas: {publicUrl || '—'}</small></label>
        <div className="settings-two"><label>Email<input className="text-input" type="email" value={form.email || ''} onChange={(e) => update('email', e.target.value)} /></label><label>Teléfono<input className="text-input" inputMode="tel" value={form.telefono || ''} onChange={(e) => update('telefono', e.target.value)} /></label></div>
        <div className="settings-two"><label>WhatsApp<input className="text-input" inputMode="tel" value={form.whatsapp || ''} onChange={(e) => update('whatsapp', e.target.value)} /></label><label>Dirección<input className="text-input" value={form.direccion || ''} onChange={(e) => update('direccion', e.target.value)} /></label></div>
      </div></section>
      <section className="panel settings-card"><h2 className="panel-title">Logo y colores</h2><div className="logo-preview">{form.logo_url ? <img src={form.logo_url} alt="Logo del negocio" /> : <ImagePlus size={28} />}<label className="btn"><ImagePlus size={14} /> {uploading ? 'Subiendo…' : 'Cargar logo'}<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} disabled={uploading} /></label></div><div className="settings-two"><label>Color principal<input className="color-input" type="color" value={form.color_principal || '#9B6A2F'} onChange={(e) => update('color_principal', e.target.value)} /></label><label>Color secundario<input className="color-input" type="color" value={form.color_secundario || '#EDE6D8'} onChange={(e) => update('color_secundario', e.target.value)} /></label></div></section>
      <section className="panel settings-card"><h2 className="panel-title">Región y reservas</h2><div className="settings-fields"><div className="settings-two"><label>País<input className="text-input" value={form.pais || ''} onChange={(e) => update('pais', e.target.value.toUpperCase())} /></label><label>Idioma<input className="text-input" value={form.locale || ''} onChange={(e) => update('locale', e.target.value)} /></label></div><div className="settings-two"><label>Zona horaria<input className="text-input" value={form.zona_horaria || ''} onChange={(e) => update('zona_horaria', e.target.value)} /></label><label>Moneda<input className="text-input" value={form.moneda || ''} onChange={(e) => update('moneda', e.target.value.toUpperCase())} /></label></div><label className="settings-check"><input type="checkbox" checked={Boolean(form.reservas_publicas)} onChange={(e) => update('reservas_publicas', e.target.checked)} /> Permitir reservas públicas</label><div className="settings-three"><label>Anticipación (min)<input className="text-input" type="number" min="0" max="10080" value={form.anticipacion_minutos} onChange={(e) => update('anticipacion_minutos', e.target.value)} /></label><label>Máximo (días)<input className="text-input" type="number" min="1" max="365" value={form.max_dias_reserva} onChange={(e) => update('max_dias_reserva', e.target.value)} /></label><label>Intervalo (min)<input className="text-input" type="number" min="5" max="120" value={form.intervalo_reserva_min} onChange={(e) => update('intervalo_reserva_min', e.target.value)} /></label></div><label>Política de cancelación<textarea className="text-input" rows="3" value={form.politica_cancelacion || ''} onChange={(e) => update('politica_cancelacion', e.target.value)} /></label></div></section>
      <div className="settings-actions"><button className="btn btn-primary" type="submit" disabled={saving || uploading}><Save size={15} /> {saving ? 'Guardando…' : 'Guardar configuración'}</button></div>
    </form>
    <section className="panel settings-card"><div className="panel-header-inline"><div><h2 className="panel-title"><UsersRound size={16} /> Colaboradores</h2><p className="panel-subtitle">Las invitaciones no envían emails: copiá el enlace y compartilo manualmente.</p></div></div><form className="invite-form" onSubmit={createInvite} aria-busy={inviteSaving}><input ref={inviteEmailRef} className="text-input" type="email" required aria-label="Email de la invitación" placeholder="email@negocio.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /><select className="text-input" aria-label="Rol de la invitación" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} disabled={inviteSaving}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select className="text-input" aria-label="Duración de la invitación" value={invite.expires} onChange={(e) => setInvite({ ...invite, expires: Number(e.target.value) })} disabled={inviteSaving}><option value={1}>Vence en 1 día</option><option value={7}>Vence en 7 días</option><option value={14}>Vence en 14 días</option><option value={30}>Vence en 30 días</option></select><button className="btn btn-primary" type="submit" disabled={inviteSaving}><UserPlus size={14} /> {inviteSaving ? 'Creando…' : 'Crear invitación'}</button></form>{inviteLink && <div className="invite-link"><input className="text-input" readOnly value={inviteLink} aria-label="Enlace de invitación generado" /><button className="btn" type="button" onClick={copyInvite}><Copy size={14} /> Copiar enlace</button></div>}<div className="member-list">{members.length === 0 ? <EmptyState className="empty-state" icon={<UsersRound size={26} aria-hidden="true" style={{ color: 'var(--border-strong)' }} />} title="Todavía no hay colaboradores" action={<button type="button" className="btn btn-primary" onClick={() => inviteEmailRef.current?.focus()}><UserPlus size={14} /> Invitar miembro</button>} /> : members.map((member) => { const memberName = member.profiles?.full_name || member.user_id; const memberBusy = memberPending[`member:${member.id}`]; return <div className="member-row" key={member.id}><div><strong>{memberName}</strong><small>{member.role === 'owner' ? 'Owner protegido' : 'Miembro del negocio'}</small></div><div className="member-actions"><select className="text-input" aria-label={`Rol de ${memberName}`} value={member.role} disabled={member.role === 'owner' || memberBusy} aria-busy={memberBusy} onChange={(e) => changeRole(member, e.target.value)}>{[['owner', 'Owner'], ...Object.entries(ROLE_LABELS)].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{member.role !== 'owner' && <button className="btn-icon-plain" type="button" onClick={() => removeMember(member)} disabled={memberBusy} aria-busy={memberBusy} aria-label="Retirar acceso"><Trash2 size={15} /></button>}</div></div> })}</div><div className="member-list invitations-list">{invitations.length === 0 ? <div className="empty-state">Todavía no hay invitaciones.</div> : invitations.map((item) => { const state = invitationState(item); const inviteBusy = memberPending[`invite:${item.id}`]; return <div className="member-row" key={item.id}><div><strong>{item.email}</strong><small>Invitación · {ROLE_LABELS[item.role] || item.role} · vence {new Date(item.expires_at).toLocaleDateString()}</small></div><div className="member-actions"><span className={`status-pill invitation-status invitation-status--${state.tone}`}>{state.label}</span>{state.actionable && <button className="btn-icon-plain" type="button" onClick={() => cancelInvite(item.id)} disabled={inviteBusy} aria-busy={inviteBusy} aria-label={`Cancelar invitación para ${item.email}`}>×</button>}</div></div> })}</div></section>
    <section className="panel settings-card"><div className="panel-header-inline"><div><h2 className="panel-title">Actividad reciente</h2><p className="panel-subtitle">Cambios relevantes del negocio, sin secretos ni tokens.</p></div></div>{activity.length === 0 ? <div className="empty-state">Todavía no hay actividad registrada.</div> : <div className="member-list">{activity.map((item) => <div className="member-row" key={item.id}><div><strong>{item.event_name.replaceAll('_', ' ')}</strong><small>{new Date(item.created_at).toLocaleString()} · {item.metadata?.slug || ''}</small></div></div>)}</div>}</section>
  </div>
}
