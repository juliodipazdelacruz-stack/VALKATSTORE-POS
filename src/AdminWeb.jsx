import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* ---------- Utilidades para la ficha web de cada producto ---------- */
export async function cargarExtrasWeb(sb, productoId) {
  const { data } = await sb
    .from('productos_ficha')
    .select('visible_web, es_camara, precio_anterior, video_url, destacados')
    .eq('producto_id', productoId)
    .maybeSingle()
  return data
}

export async function subirVideo(sb, productoId, archivo) {
  const ext = archivo.type === 'video/webm' ? 'webm' : 'mp4'
  const ruta = `${productoId}-${Date.now()}.${ext}` // nombre único: solo requiere permiso de INSERT
  const { error } = await sb.storage
    .from('videos-productos')
    .upload(ruta, archivo, { upsert: false, contentType: archivo.type, cacheControl: '3600' })
  if (error) return { error }
  const { data } = sb.storage.from('videos-productos').getPublicUrl(ruta)
  return { url: data.publicUrl }
}

export async function subirGaleria(sb, productoId, archivos) {
  const urls = []
  for (const f of archivos) {
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg'
    const ruta = `${productoId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error } = await sb.storage.from('galeria-productos').upload(ruta, f, { contentType: f.type, cacheControl: '3600' })
    if (error) return { error, urls }
    urls.push(sb.storage.from('galeria-productos').getPublicUrl(ruta).data.publicUrl)
  }
  return { urls }
}

export function guardarExtrasWeb(sb, productoId, x) {
  return sb
    .from('productos_ficha')
    .update({
      visible_web: !!x.visible,
      es_camara: !!x.camara,
      precio_anterior: x.precioAnterior === '' || x.precioAnterior == null ? null : Number(x.precioAnterior),
      video_url: (x.video || '').trim() || null,
      destacados: (x.destacados || '').split('\n').map(s => s.trim()).filter(Boolean)
    })
    .eq('producto_id', productoId)
}

const soles = (n) => 'S/ ' + Number(n || 0).toFixed(2)
const inp = 'w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500'
const lbl = 'block text-xs font-bold text-gray-600 mb-1'

function Interruptor({ valor, onChange, texto }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={valor} onClick={() => onChange(!valor)}
        className={'relative w-12 h-7 rounded-full transition ' + (valor ? 'bg-teal-500' : 'bg-gray-300')}>
        <span className={'absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition ' + (valor ? 'translate-x-5' : '')} />
      </button>
      <span className="text-sm font-semibold text-gray-700">{texto}</span>
    </label>
  )
}


/* ---------- Lista de productos: publicar en la web y editar detalles ---------- */
function ListaProductosWeb({ notificar }) {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [tipo, setTipo] = useState('Todos')
  const [ed, setEd] = useState(null)
  const [ocupado, setOcupado] = useState('')

  const cargar = async () => {
    const [p, f] = await Promise.all([
      supabase.from('productos').select('id,nombre,marca,tipo,precio,stock').order('tipo').order('nombre'),
      supabase.from('productos_ficha').select('producto_id,visible_web,es_camara,precio_anterior,video_url,destacados,imagen_url,galeria')
    ])
    if (p.error || f.error) notificar('No se pudo cargar la lista: ' + (p.error || f.error).message, 'error')
    const mapa = {}
    ;(f.data || []).forEach(x => { mapa[x.producto_id] = x })
    setFilas((p.data || []).map(x => ({ ...x, ficha: mapa[x.id] || null })))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const cambiar = async (r, cambios) => {
    setOcupado(r.id)
    if (!r.ficha) {
      const { error } = await supabase.from('productos_ficha')
        .insert([{ producto_id: r.id, apodos: '', especificaciones: {}, updated_at: new Date().toISOString() }])
      if (error) { setOcupado(''); return notificar('Error al crear la ficha: ' + error.message, 'error') }
    }
    const { error } = await supabase.from('productos_ficha').update(cambios).eq('producto_id', r.id)
    setOcupado('')
    if (error) return notificar('Error al guardar: ' + error.message, 'error')
    setFilas(fs => fs.map(x => x.id === r.id ? { ...x, ficha: { ...(x.ficha || { producto_id: r.id }), ...cambios } } : x))
    return true
  }

  const abrir = (r) => setEd(ed?.id === r.id ? null : {
    id: r.id, precioAnterior: r.ficha?.precio_anterior ?? '', video: r.ficha?.video_url ?? '',
    destacados: (r.ficha?.destacados ?? []).join('\n'), archivo: null,
    galeria: r.ficha?.galeria ?? [], nuevas: [] })

  const guardarEd = async (r) => {
    setOcupado(r.id)
    let video = ed.video
    if (ed.archivo) {
      const rv = await subirVideo(supabase, r.id, ed.archivo)
      if (rv.error) notificar('No se pudo subir el video: ' + (rv.error.message || rv.error), 'error')
      else video = rv.url
    }
    let galeria = ed.galeria
    if (ed.nuevas.length) {
      const rg = await subirGaleria(supabase, r.id, ed.nuevas)
      galeria = [...galeria, ...rg.urls]
      if (rg.error) notificar('No se pudieron subir todas las fotos: ' + (rg.error.message || rg.error), 'error')
    }
    setOcupado('')
    const ok = await cambiar(r, {
      precio_anterior: ed.precioAnterior === '' ? null : Number(ed.precioAnterior),
      video_url: (video || '').trim() || null,
      destacados: ed.destacados.split('\n').map(s => s.trim()).filter(Boolean),
      galeria
    })
    if (ok) { notificar('Detalles guardados', 'exito'); setEd(null) }
  }

  const tipos = ['Todos', ...Array.from(new Set(filas.map(f => f.tipo).filter(Boolean)))]
  const q = busca.trim().toLowerCase()
  const visibles = filas.filter(r =>
    (tipo === 'Todos' || r.tipo === tipo) &&
    (filtro === 'todos' || (filtro === 'web' ? r.ficha?.visible_web : !r.ficha?.visible_web)) &&
    (!q || (r.nombre + ' ' + (r.marca || '')).toLowerCase().includes(q)))
  const enWeb = filas.filter(r => r.ficha?.visible_web).length

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-gray-800">🛍️ Productos en la web</h3>
          <p className="text-sm text-gray-500 mt-1">Activa lo que quieres vender en la tienda y ajusta sus detalles. {enWeb} de {filas.length} publicados.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-4">
        <input className={inp + ' md:w-64'} placeholder="🔍 Buscar producto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={inp + ' md:w-48'} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {tipos.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="flex gap-2">
          {[['todos', 'Todos'], ['web', 'En la web'], ['fuera', 'Sin publicar']].map(([v, t]) => (
            <button key={v} onClick={() => setFiltro(v)}
              className={'px-3 py-2 rounded-xl text-sm font-bold ' + (filtro === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>{t}</button>
          ))}
        </div>
      </div>

      {cargando ? <p className="text-gray-500 mt-4">Cargando productos…</p> : (
        <div className="mt-4 border border-gray-200 rounded-xl divide-y divide-gray-200 overflow-y-auto max-h-[28rem]">
          {visibles.length === 0 && <p className="p-4 text-sm text-gray-500">No hay productos con ese filtro.</p>}
          {visibles.map(r => (
            <div key={r.id} className={ocupado === r.id ? 'opacity-60' : ''}>
              <div className="flex items-center gap-3 p-3 flex-wrap">
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                  {r.ficha?.imagen_url ? <img src={r.ficha.imagen_url} alt="" className="w-full h-full object-cover" /> : <span>📦</span>}
                </div>
                <div className="flex-1 min-w-[160px]">
                  <p className="font-bold text-sm text-gray-800 leading-tight">{r.nombre}</p>
                  <p className="text-xs text-gray-500">{r.marca} · {r.tipo} · {soles(r.precio)} · Stock {r.stock ?? 0}{r.ficha?.video_url ? ' · 🎬 con video' : ''}</p>
                </div>
                <Interruptor valor={!!r.ficha?.visible_web} onChange={(v) => cambiar(r, { visible_web: v })} texto="En la web" />
                <Interruptor valor={!!r.ficha?.es_camara} onChange={(v) => cambiar(r, { es_camara: v })} texto="🎁 Memoria de regalo" />
                <button onClick={() => abrir(r)} className="px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 hover:bg-gray-200 text-gray-700">
                  {ed?.id === r.id ? 'Cerrar' : 'Editar detalles'}
                </button>
              </div>
              {ed?.id === r.id && (
                <div className="bg-gray-50 border-t border-gray-200 p-4 grid md:grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Precio anterior / tachado (S/) — opcional</label>
                    <input type="number" step="0.10" min="0" className={inp} value={ed.precioAnterior} onChange={(e) => setEd({ ...ed, precioAnterior: e.target.value })} />
                    <p className="text-xs text-gray-500 mt-1">Precio de venta actual: {soles(r.precio)} (se cambia en Inventario).</p>
                  </div>
                  <div>
                    <label className={lbl}>Video (MP4 o WebM, máx. 50 MB)</label>
                    <label className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl cursor-pointer">
                      🎬 {ed.archivo ? 'Cambiar video' : 'Elegir video'}
                      <input type="file" hidden accept="video/mp4,video/webm" onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f && f.size > 50 * 1024 * 1024) { notificar('El video pesa más de 50 MB.', 'aviso'); e.target.value = ''; return }
                        setEd({ ...ed, archivo: f || null })
                      }} />
                    </label>
                    {ed.archivo && <span className="text-xs text-gray-600 ml-2">{ed.archivo.name}</span>}
                    <input type="url" className={inp + ' mt-2'} placeholder="…o pega un enlace .mp4" value={ed.video} onChange={(e) => setEd({ ...ed, video: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={lbl}>Galería de fotos (se ven después del video, en el carrusel)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {ed.galeria.map((u, i) => (
                        <div key={u} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                          <img src={u} alt="" className="w-full h-full object-cover" />
                          <button type="button" aria-label="Quitar foto" onClick={() => setEd({ ...ed, galeria: ed.galeria.filter((_, j) => j !== i) })}
                            className="absolute top-0 right-0 bg-black/70 text-white text-xs w-5 h-5">✕</button>
                        </div>
                      ))}
                      {ed.nuevas.map((f, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-dashed border-teal-400">
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                          <button type="button" aria-label="Quitar foto" onClick={() => setEd({ ...ed, nuevas: ed.nuevas.filter((_, j) => j !== i) })}
                            className="absolute top-0 right-0 bg-black/70 text-white text-xs w-5 h-5">✕</button>
                        </div>
                      ))}
                    </div>
                    <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl cursor-pointer">
                      📷 Agregar fotos
                      <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                        const ok = Array.from(e.target.files || []).filter(f => f.size <= 5 * 1024 * 1024)
                        if (ok.length < (e.target.files || []).length) notificar('Algunas fotos superan los 5 MB y se omitieron.', 'aviso')
                        setEd({ ...ed, nuevas: [...ed.nuevas, ...ok] }); e.target.value = ''
                      }} />
                    </label>
                    <span className="text-xs text-gray-500 ml-2">JPG, PNG o WebP · máx. 5 MB c/u</span>
                  </div>
                  <div className="md:col-span-2">
                    <label className={lbl}>Puntos destacados (uno por línea)</label>
                    <textarea rows={3} className={inp} value={ed.destacados} onChange={(e) => setEd({ ...ed, destacados: e.target.value })} />
                  </div>
                  <div className="md:col-span-2 flex gap-2 justify-end">
                    <button onClick={() => setEd(null)} className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700">Cancelar</button>
                    <button onClick={() => guardarEd(r)} className="px-5 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white">Guardar detalles</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ---------- Pantalla: Tienda web (productos + promo de memorias + live) ---------- */
const pareceMemoria = (p) => /almacen|memoria|micro ?sd|\bgb\b/i.test(`${p.tipo || ''} ${p.nombre || ''}`)
const adivinaCapacidad = (nombre) => { const m = /(\d+)\s?(gb|tb)/i.exec(nombre || ''); return m ? `${m[1]} ${m[2].toUpperCase()}` : '' }
const etiqueta = (p) => `${p.nombre}${p.marca ? ' · ' + p.marca : ''} — ${soles(p.precio)}${(p.stock ?? 0) <= 0 ? ' (sin stock)' : ''}`

export default function AdminWeb({ onVolver, notificar }) {
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState('')
  const [live, setLive] = useState({ activo: false, url: '', titulo: '' })
  const [promo, setPromo] = useState({ activa: true, titulo: '', texto: '', regalo_nombre: '', regalo_capacidad: '',
    regalo_activo: true, regalo_modo: 'gratis', regalo_producto_id: null, regalo_precio_especial: '' })
  const [opciones, setOpciones] = useState([])
  const [productos, setProductos] = useState([])
  const [verTodos, setVerTodos] = useState(false)

  const cargar = async () => {
    setCargando(true)
    const [l, p, o, pr] = await Promise.all([
      supabase.from('live_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('promo_memorias_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('promo_memorias_opciones').select('*').order('orden'),
      supabase.from('productos').select('id,nombre,marca,tipo,precio,stock').order('nombre')
    ])
    const err = l.error || p.error || o.error || pr.error
    if (err) notificar('No se pudo cargar la tienda web: ' + err.message, 'error')
    if (l.data) setLive(l.data)
    if (p.data) setPromo(x => ({ ...x, ...p.data, regalo_precio_especial: p.data.regalo_precio_especial ?? '' }))
    setProductos(pr.data || [])
    setOpciones((o.data || []).map(x => ({ ...x, precio_normal: x.precio_normal ?? '', precio_especial: String(x.precio_especial) })))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const prod = (id) => productos.find(x => x.id === id)
  const lista = (actual) => {
    const base = verTodos ? productos : productos.filter(pareceMemoria)
    return actual && !base.some(x => x.id === actual) && prod(actual) ? [...base, prod(actual)] : base
  }

  const guardarLive = async (cambios) => {
    const nuevo = { ...live, ...cambios }
    setLive(nuevo)
    setGuardando('live')
    const { error } = await supabase.from('live_config')
      .update({ activo: nuevo.activo, url: nuevo.url.trim(), titulo: nuevo.titulo.trim(), updated_at: new Date().toISOString() })
      .eq('id', 1)
    setGuardando('')
    notificar(error ? 'Error al guardar el live: ' + error.message : (nuevo.activo ? '🔴 Live activado en la web' : 'Live desactivado'), error ? 'error' : 'exito')
  }

  const guardarPromo = async (cambios, validar = false) => {
    const nuevo = { ...promo, ...cambios }
    const pg = prod(nuevo.regalo_producto_id)
    const esp = nuevo.regalo_precio_especial === '' ? null : Number(nuevo.regalo_precio_especial)
    if (validar && nuevo.regalo_modo === 'descuento') {
      if (!pg) return notificar('Para dar la memoria con descuento, elige el producto del catálogo.', 'error')
      if (esp === null || !(esp >= 0) || esp > Number(pg.precio)) return notificar('El precio con descuento debe estar entre 0 y ' + soles(pg.precio) + '.', 'error')
    }
    setPromo(nuevo)
    setGuardando('promo')
    const { error } = await supabase.from('promo_memorias_config')
      .update({ activa: nuevo.activa, titulo: nuevo.titulo.trim(), texto: nuevo.texto.trim(),
                regalo_nombre: nuevo.regalo_nombre.trim(), regalo_capacidad: nuevo.regalo_capacidad.trim(),
                regalo_activo: !!nuevo.regalo_activo, regalo_modo: nuevo.regalo_modo,
                regalo_producto_id: nuevo.regalo_producto_id || null,
                regalo_precio_especial: nuevo.regalo_modo === 'descuento' ? esp : null,
                updated_at: new Date().toISOString() })
      .eq('id', 1)
    setGuardando('')
    notificar(error ? 'Error al guardar la promoción: ' + error.message : 'Promoción guardada', error ? 'error' : 'exito')
  }

  const elegirRegalo = (id) => {
    const p = prod(id)
    setPromo({ ...promo, regalo_producto_id: id || null,
      regalo_nombre: p ? p.nombre : promo.regalo_nombre,
      regalo_capacidad: p ? (adivinaCapacidad(p.nombre) || promo.regalo_capacidad) : promo.regalo_capacidad })
  }

  const editarOpcion = (id, patch) =>
    setOpciones(os => os.map(o => (o.id === id ? { ...o, ...patch, _sucia: true } : o)))

  const elegirOpcion = (id, pid) => {
    const p = prod(pid)
    editarOpcion(id, pid && p
      ? { producto_id: pid, nombre: p.nombre, precio_normal: String(p.precio), capacidad: adivinaCapacidad(p.nombre) || '' }
      : { producto_id: null })
  }

  const guardarOpcion = async (o) => {
    const p = prod(o.producto_id)
    const normal = p ? Number(p.precio) : Number(o.precio_normal), especial = Number(o.precio_especial)
    if (!o.nombre.trim() || !o.capacidad.trim()) return notificar('Escribe el nombre y la capacidad.', 'error')
    if (!(normal >= 0) || !(especial >= 0)) return notificar('Los precios no son válidos.', 'error')
    if (especial > normal) return notificar('El precio especial no puede ser mayor que el normal (' + soles(normal) + ').', 'error')
    setGuardando(o.id)
    const fila = { nombre: o.nombre.trim(), capacidad: o.capacidad.trim(), precio_normal: normal, precio_especial: especial,
                   producto_id: o.producto_id || null, activa: !!o.activa, orden: Number(o.orden) || 0 }
    const { error } = o._nueva
      ? await supabase.from('promo_memorias_opciones').insert([fila])
      : await supabase.from('promo_memorias_opciones').update(fila).eq('id', o.id)
    setGuardando('')
    if (error) return notificar('Error al guardar la memoria: ' + error.message, 'error')
    notificar('Memoria guardada', 'exito')
    cargar()
  }

  const eliminarOpcion = async (o) => {
    if (o._nueva) return setOpciones(os => os.filter(x => x.id !== o.id))
    if (!window.confirm(`¿Eliminar "${o.nombre}" de la promoción?`)) return
    const { error } = await supabase.from('promo_memorias_opciones').delete().eq('id', o.id)
    if (error) return notificar('Error al eliminar: ' + error.message, 'error')
    notificar('Memoria eliminada', 'exito')
    cargar()
  }

  const agregarOpcion = () =>
    setOpciones(os => [...os, { id: 'nueva-' + Date.now(), _nueva: true, _sucia: true, producto_id: null, nombre: '', capacidad: '',
      precio_normal: '', precio_especial: '', activa: true, orden: os.length + 1 }])

  if (cargando) return <p className="text-gray-500">Cargando tienda web…</p>

  const pg = prod(promo.regalo_producto_id)
  const gEsp = promo.regalo_precio_especial === '' ? null : Number(promo.regalo_precio_especial)
  const gAhorro = pg && gEsp !== null && gEsp <= Number(pg.precio) && Number(pg.precio) > 0 ? Math.round((1 - gEsp / Number(pg.precio)) * 100) : null

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onVolver} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver</button>
        <h2 className="text-xl font-bold text-gray-800">🌐 Tienda web</h2>
      </div>

      <ListaProductosWeb notificar={notificar} />

      {/* LIVE DE TIKTOK */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-gray-800">🎵 Live de TikTok</h3>
            <p className="text-sm text-gray-500 mt-1">Cuando está activo, la tienda muestra “EN VIVO” con el botón para entrar.</p>
          </div>
          <Interruptor valor={live.activo} onChange={(v) => guardarLive({ activo: v })} texto={live.activo ? 'En vivo ahora' : 'Sin live'} />
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className={lbl}>Enlace de tu live o perfil de TikTok</label>
            <input className={inp} value={live.url} onChange={(e) => setLive({ ...live, url: e.target.value })} placeholder="https://www.tiktok.com/@tu_usuario/live" />
          </div>
          <div>
            <label className={lbl}>Mensaje que verá el cliente</label>
            <input className={inp} value={live.titulo} onChange={(e) => setLive({ ...live, titulo: e.target.value })} placeholder="Ofertas y sorteos a las 8 pm" />
          </div>
        </div>
        <button onClick={() => guardarLive({})} disabled={guardando === 'live'}
          className="mt-4 bg-teal-600 hover:bg-teal-700 text-white font-bold px-5 py-2 rounded-xl text-sm">
          {guardando === 'live' ? 'Guardando…' : 'Guardar live'}
        </button>
      </section>

      {/* PROMO DE MEMORIAS */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-gray-800">💾 Promoción de memorias</h3>
            <p className="text-sm text-gray-500 mt-1">Se ofrece cuando el cliente lleva una cámara. Las memorias salen de tu catálogo (con su marca y precio).</p>
          </div>
          <Interruptor valor={promo.activa} onChange={(v) => guardarPromo({ activa: v })} texto={promo.activa ? 'Promoción activa' : 'Promoción apagada'} />
        </div>

        <div className="mt-5 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} className="w-4 h-4" />
            Mostrar todos los productos en los selectores (no solo memorias)
          </label>
        </div>

        {/* Memoria incluida con la cámara */}
        <div className="mt-4 border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h4 className="font-bold text-gray-800">🎁 Memoria incluida con cada cámara</h4>
              <p className="text-xs text-gray-500 mt-0.5">Una por cámara. Puede ser gratis o con descuento.</p>
            </div>
            <Interruptor valor={!!promo.regalo_activo} onChange={(v) => guardarPromo({ regalo_activo: v })} texto={promo.regalo_activo ? 'Activa' : 'Desactivada'} />
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <div className="md:col-span-2">
              <label className={lbl}>Producto del catálogo</label>
              <select className={inp} value={promo.regalo_producto_id || ''} onChange={(e) => elegirRegalo(e.target.value)}>
                <option value="">— Sin vincular (escribir a mano) —</option>
                {lista(promo.regalo_producto_id).map(p => <option key={p.id} value={p.id}>{etiqueta(p)}</option>)}
              </select>
              {pg && (pg.stock ?? 0) <= 0 && <p className="text-xs text-orange-600 mt-1">⚠ Sin stock: la memoria de regalo no se ofrecerá en la tienda.</p>}
            </div>
            <div>
              <label className={lbl}>Capacidad</label>
              <input className={inp} value={promo.regalo_capacidad} onChange={(e) => setPromo({ ...promo, regalo_capacidad: e.target.value })} placeholder="64 GB" />
            </div>
            {!pg && (
              <div className="md:col-span-3">
                <label className={lbl}>Nombre de la memoria</label>
                <input className={inp} value={promo.regalo_nombre} onChange={(e) => setPromo({ ...promo, regalo_nombre: e.target.value })} placeholder="Memoria 64 GB" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-4">
            <span className="text-xs font-bold text-gray-600">¿Cómo se entrega?</span>
            {[['gratis', '🎁 Gratis'], ['descuento', '🏷️ Con descuento']].map(([v, t]) => (
              <button key={v} type="button" onClick={() => setPromo({ ...promo, regalo_modo: v })}
                className={'px-4 py-2 rounded-xl text-sm font-bold ' + (promo.regalo_modo === v ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>{t}</button>
            ))}
            {promo.regalo_modo === 'descuento' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600">Precio con descuento (S/)</span>
                <input type="number" step="0.10" min="0" className="w-28 px-3 py-2 border border-gray-300 rounded-xl text-sm" value={promo.regalo_precio_especial}
                  onChange={(e) => setPromo({ ...promo, regalo_precio_especial: e.target.value })} />
                {pg && <span className="text-xs text-gray-500">Precio normal {soles(pg.precio)}</span>}
                {gAhorro !== null && <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded">{gAhorro}% menos</span>}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className={lbl}>Texto de la promoción</label>
          <textarea rows={2} className={inp} value={promo.texto} onChange={(e) => setPromo({ ...promo, texto: e.target.value })} />
        </div>
        <button onClick={() => guardarPromo({}, true)} disabled={guardando === 'promo'}
          className="mt-4 bg-teal-600 hover:bg-teal-700 text-white font-bold px-5 py-2 rounded-xl text-sm">
          {guardando === 'promo' ? 'Guardando…' : 'Guardar promoción'}
        </button>

        <h4 className="text-sm font-bold text-gray-700 mt-8 mb-1">Memorias de mayor capacidad con descuento</h4>
        <p className="text-xs text-gray-500 mb-3">El cliente puede cambiar su memoria incluida por una de estas, o agregarla si la memoria incluida está desactivada. Cada una puede ser de otra marca.</p>
        <div className="grid gap-3">
          {opciones.length === 0 && <p className="text-sm text-gray-500">Aún no hay memorias. Agrega la primera.</p>}
          {opciones.map((o) => {
            const p = prod(o.producto_id)
            const n = p ? Number(p.precio) : Number(o.precio_normal), e = Number(o.precio_especial)
            const ahorro = n > 0 && e >= 0 && e <= n ? Math.round((1 - e / n) * 100) : null
            return (
              <div key={o.id} className={'border rounded-xl p-4 ' + (o.activa ? 'border-gray-200' : 'border-gray-200 bg-gray-50 opacity-75')}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className={lbl}>Producto del catálogo</label>
                    <select className={inp} value={o.producto_id || ''} onChange={(ev) => elegirOpcion(o.id, ev.target.value)}>
                      <option value="">— Escribir a mano —</option>
                      {lista(o.producto_id).map(x => <option key={x.id} value={x.id}>{etiqueta(x)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Capacidad</label>
                    <input className={inp} value={o.capacidad} onChange={(ev) => editarOpcion(o.id, { capacidad: ev.target.value })} placeholder="128 GB" />
                  </div>
                  <div>
                    <label className={lbl}>Precio normal{p ? ' (catálogo)' : ' (S/)'}</label>
                    {p ? <p className="px-3 py-2 text-sm font-bold text-gray-700">{soles(n)}</p>
                       : <input type="number" step="0.10" min="0" className={inp} value={o.precio_normal} onChange={(ev) => editarOpcion(o.id, { precio_normal: ev.target.value })} />}
                  </div>
                  {!p && (
                    <div className="col-span-2">
                      <label className={lbl}>Nombre</label>
                      <input className={inp} value={o.nombre} onChange={(ev) => editarOpcion(o.id, { nombre: ev.target.value })} placeholder="Memoria 128 GB" />
                    </div>
                  )}
                  <div>
                    <label className={lbl}>Precio especial (S/)</label>
                    <input type="number" step="0.10" min="0" className={inp} value={o.precio_especial} onChange={(ev) => editarOpcion(o.id, { precio_especial: ev.target.value })} />
                  </div>
                </div>
                {p && (p.stock ?? 0) <= 0 && <p className="text-xs text-orange-600 mt-2">⚠ Sin stock: no se mostrará en la tienda hasta que haya stock.</p>}
                <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
                  <div className="flex items-center gap-5 flex-wrap">
                    <Interruptor valor={o.activa} onChange={(v) => editarOpcion(o.id, { activa: v })} texto={o.activa ? 'Visible' : 'Oculta'} />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-600">Orden</span>
                      <input type="number" className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm" value={o.orden} onChange={(ev) => editarOpcion(o.id, { orden: ev.target.value })} />
                    </div>
                    {ahorro !== null && (
                      <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded">
                        Cliente ahorra {soles(n - e)} ({ahorro}%)
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => eliminarOpcion(o)} className="text-red-600 hover:bg-red-50 font-semibold px-3 py-2 rounded-lg text-sm">Eliminar</button>
                    <button onClick={() => guardarOpcion(o)} disabled={guardando === o.id}
                      className={'font-bold px-4 py-2 rounded-xl text-sm ' + (o._sucia ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-100 text-gray-500')}>
                      {guardando === o.id ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button onClick={agregarOpcion} className="mt-4 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-4 py-2 rounded-xl text-sm">+ Agregar memoria</button>
      </section>
    </div>
  )
}
