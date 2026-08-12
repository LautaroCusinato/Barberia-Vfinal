import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, ImagePlus, LoaderCircle, Save, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { getAppOrigin } from '../lib/authRedirect'

const DEFAULTS = {
  nombre: '', descripcion: '', slug: '', vertical: 'barberia', pais: 'AR', locale: 'es-AR', zona_horaria: 'America/Argentina/Buenos_Aires', moneda: 'ARS', direccion: '', email: '', telefono: '', whatsapp: '', logo_url: '', logo_storage_path: '', color_principal: '#9B6A2F', color_secundario: '#EDE6D8', reservas_publicas: true, politica_cancelacion: '', anticipacion_minutos: 60, max_dias_reserva: 60, intervalo_reserva_min: 15,
}

const ROLE_LABELS = { admin: 'Administrador', recepcionista: 'Recepción', empleado: 'Empleado', readonly: 'Sólo lectura', barbero: 'Barbero' }

function cleanError(error) { return String(error?.message || 'No se pudo completar la operación.').replace(/^.*?ERROR:\s*/i, '').replace(/\s*DETAIL:.*$/i, '') }

export default function TenantSettings({ barberiaId }) {
  const [form, setForm] = useState(DEFAULTS)
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'empleado', expires: 7 })
  const [inviteLink, setInviteLink] = useState('')

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true); setError('')
    const [settingsResult, membersResult, invitationsResult, activityResult] = await Promise.all([
      supabase.rpc('get_tenant_settings', { p_barberia_id: barberiaId }),
      supabase.from('barberia_members').select('id, user_id, role, created_at, profiles(full_name)').eq('barberia_id', barberiaId).order('created_at'),
      supabase.from('barberia_invitaciones').select('id, email, role, status, expires_at, created_at').eq('barberia_id', barberiaId).order('created_at', { ascending: false }).limit(20),
      supabase.from('saas_audit_log').select('id, event_name, metadata, created_at').eq('barberia_id', barberiaId).order('created_at', { ascending: false }).limit(20),
    ])
    if (settingsResult.error) setError(cleanError(settingsResult.error))
    if (settingsResult.data) setForm((current) => ({ ...current, ...settingsResult.data }))
    if (!membersResult.error) setMembers(membersResult.data || [])
    if (!invitationsResult.error) setInvitations(invitationsResult.data || [])
    if (!activityResult.error) setActivity(activityResult.data || [])
    setLoading(false)
  }, [barberiaId])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const { error: saveError } = await supabase.rpc('update_tenant_settings', {
      p_barberia_id: barberiaId, p_nombre: form.nombre, p_descripcion: form.descripcion, p_slug: form.slug, p_vertical: form.vertical,
      p_pais: form.pais, p_locale: form.locale, p_zona_horaria: form.zona_horaria, p_moneda: form.moneda, p_direccion: form.direccion,
      p_email: form.email, p_telefono: form.telefono, p_whatsapp: form.whatsapp, p_logo_url: form.logo_url, p_logo_storage_path: form.logo_storage_path,
      p_color_principal: form.color_principal, p_color_secundario: form.color_secundario, p_reservas_publicas: form.reservas_publicas,
      p_politica_cancelacion: form.politica_cancelacion, p_anticipacion_minutos: Number(form.anticipacion_minutos), p_max_dias_reserva: Number(form.max_dias_reserva), p_intervalo_reserva_min: Number(form.intervalo_reserva_min),
    })
    if (saveError) setError(cleanError(saveError)); else setNotice('Configuración guardada.')
    setSaving(false)
  }

  const uploadLogo = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('El logo debe ser PNG, JPG, WebP o SVG y pesar hasta 2 MB.'); return }
    setUploading(true); setError('')
    const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${barberiaId}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })
    if (uploadError) { setError(cleanError(uploadError)); setUploading(false); return }
    const oldPath = form.logo_storage_path
    const { data } = supabase.storage.from('tenant-logos').getPublicUrl(path)
    update('logo_url', data.publicUrl); update('logo_storage_path', path)
    if (oldPath && oldPath !== path) await supabase.storage.from('tenant-logos').remove([oldPath])
    setNotice('Logo cargado. Guardá la configuración para publicarlo.'); setUploading(false)
  }

  const createInvite = async (event) => {
    event.preventDefault(); setError(''); setInviteLink('')
    const { data, error: inviteError } = await supabase.rpc('create_barberia_invitation', { p_barberia_id: barberiaId, p_email: invite.email, p_role: invite.role, p_expires_days: Number(invite.expires) })
    if (inviteError) { setError(cleanError(inviteError)); return }
    const link = `${getAppOrigin()}/invitacion/${data.token}`
    setInviteLink(link); setInvite({ email: '', role: 'empleado', expires: 7 }); await load()
  }

  const copyInvite = async () => { await navigator.clipboard?.writeText(inviteLink); setNotice('Enlace copiado para compartir manualmente.') }
  const cancelInvite = async (id) => { const { error: cancelError } = await supabase.from('barberia_invitaciones').update({ status: 'canceled' }).eq('id', id).eq('barberia_id', barberiaId); if (cancelError) setError(cleanError(cancelError)); else load() }
  const changeRole = async (member, role) => { if (member.role === 'owner') return; const { error: roleError } = await supabase.from('barberia_members').update({ role }).eq('id', member.id).eq('barberia_id', barberiaId); if (roleError) setError(cleanError(roleError)); else load() }
  const removeMember = async (member) => { if (member.role === 'owner' || !window.confirm(`¿Retirar el acceso de ${member.profiles?.full_name || member.user_id}?`)) return; const { error: removeError } = await supabase.from('barberia_members').delete().eq('id', member.id).eq('barberia_id', barberiaId); if (removeError) setError(cleanError(removeError)); else load() }

  const publicUrl = useMemo(() => form.slug ? `${window.location.origin}/reservar/${form.slug}` : '', [form.slug])

  if (loading) return <div className="panel settings-loading"><LoaderCircle className="spin" size={18} /> Cargando configuración…</div>
  if (!isSupabaseConfigured) return <div className="panel empty-state">Configurá Supabase para editar el negocio.</div>

  return <div className="management-screen management-settings settings-page fade-in">
    <div className="page-header"><div><p className="page-kicker">Tenant y marca</p><h1 className="page-title">Configuración del negocio</h1><p className="page-date">Los cambios se validan en Supabase y afectan sólo a este negocio.</p></div><span className="billing-security"><ShieldCheck size={14} /> RLS activo</span></div>
    {error && <div className="error-banner" role="alert">{error}</div>}{notice && <div className="settings-notice" role="status"><Check size={15} /> {notice}</div>}
    <form className="settings-grid" onSubmit={save}>
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
    <section className="panel settings-card"><div className="panel-header-inline"><div><h2 className="panel-title"><UsersRound size={16} /> Colaboradores</h2><p className="panel-subtitle">Las invitaciones no envían emails: copiá el enlace y compartilo manualmente.</p></div></div><form className="invite-form" onSubmit={createInvite}><input className="text-input" type="email" required placeholder="email@negocio.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /><select className="text-input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="btn btn-primary" type="submit"><UserPlus size={14} /> Invitar</button></form>{inviteLink && <div className="invite-link"><input className="text-input" readOnly value={inviteLink} /><button className="btn" type="button" onClick={copyInvite}><Copy size={14} /> Copiar</button></div>}<div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><div><strong>{member.profiles?.full_name || member.user_id}</strong><small>{member.role === 'owner' ? 'Owner protegido' : 'Miembro del negocio'}</small></div><div className="member-actions"><select className="text-input" value={member.role} disabled={member.role === 'owner'} onChange={(e) => changeRole(member, e.target.value)}>{[['owner', 'Owner'], ...Object.entries(ROLE_LABELS)].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{member.role !== 'owner' && <button className="btn-icon-plain" type="button" onClick={() => removeMember(member)} aria-label="Retirar acceso"><Trash2 size={15} /></button>}</div></div>)}</div><div className="member-list invitations-list">{invitations.filter((item) => item.status === 'pending').map((item) => <div className="member-row" key={item.id}><div><strong>{item.email}</strong><small>Invitación · {ROLE_LABELS[item.role] || item.role} · vence {new Date(item.expires_at).toLocaleDateString()}</small></div><button className="btn-icon-plain" type="button" onClick={() => cancelInvite(item.id)} aria-label="Cancelar invitación">×</button></div>)}</div></section>
    <section className="panel settings-card"><div className="panel-header-inline"><div><h2 className="panel-title">Actividad reciente</h2><p className="panel-subtitle">Cambios relevantes del negocio, sin secretos ni tokens.</p></div></div>{activity.length === 0 ? <div className="empty-state">Todavía no hay actividad registrada.</div> : <div className="member-list">{activity.map((item) => <div className="member-row" key={item.id}><div><strong>{item.event_name.replaceAll('_', ' ')}</strong><small>{new Date(item.created_at).toLocaleString()} · {item.metadata?.slug || ''}</small></div></div>)}</div>}</section>
  </div>
}
