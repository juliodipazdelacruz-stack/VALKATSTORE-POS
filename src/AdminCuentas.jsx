import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const MEDIOS = ['Transferencia', 'Yape', 'Plin', 'Depósito bancario', 'Otro']
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const sumarDias = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const fechaCorta = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const venceEn = (m, dia) => { const [y, mo] = m.split('-').map(Number); const ult = new Date(y, mo, 0).getDate(); return `${m}-${String(Math.min(Number(dia) || 1, ult)).padStart(2, '0')}` }
const mesLargo = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })
const suma = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0)

const CHIP = {
  pendiente: 'bg-gray-100 text-gray-700 border-gray-200',
  parcial: 'bg-blue-50 text-blue-700 border-blue-200',
  vencida: 'bg-red-50 text-red-700 border-red-200',
  pagada: 'bg-green-50 text-green-700 border-green-200',
  anulada: 'bg-gray-50 text-gray-400 border-gray-200 line-through'
}
const ETIQ = { pendiente: 'Pendiente', parcial: 'Pago parcial', vencida: 'Vencida', pagada: 'Pagada', anulada: 'Anulada' }

const inp = 'w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500'
const lbl = 'block text-xs font-bold text-gray-600 mb-1'
const btnP = 'bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition text-sm shadow-sm disabled:opacity-50'
const btnS = 'bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg transition text-sm'

function Campo({ label, children, className = '' }) {
  return <div className={className}><label className={lbl}>{label}</label>{children}</div>
}

function Modal({ titulo, onCerrar, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onCerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">{titulo}</h3>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function Tarjeta({ titulo, valor, detalle, color = 'text-gray-800' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{titulo}</p>
      <p className={`text-2xl font-extrabold mt-1 ${color}`}>{valor}</p>
      {detalle && <p className="text-xs text-gray-400 mt-1">{detalle}</p>}
    </div>
  )
}

export default function AdminCuentas({ onVolver, notificar }) {
  const [tab, setTab] = useState('resumen')
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [obls, setObls] = useState([])
  const [pagos, setPagos] = useState([])
  const [cats, setCats] = useState([])
  const [provs, setProvs] = useState([])
  const [recs, setRecs] = useState([])
  const [emps, setEmps] = useState([])
  const [modal, setModal] = useState(null)
  const [fSit, setFSit] = useState('abiertas')
  const [fGrupo, setFGrupo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [edSueldo, setEdSueldo] = useState({})

  const cargar = async () => {
    const [o, p, c, v, r, e] = await Promise.all([
      supabase.from('v_cuentas_obligaciones').select('*').order('fecha_vencimiento', { ascending: false }).limit(1500),
      supabase.from('cuentas_pagos').select('*').order('fecha_pago', { ascending: false }).order('created_at', { ascending: false }).limit(1500),
      supabase.from('cuentas_categorias').select('*').order('nombre'),
      supabase.from('cuentas_proveedores').select('*').order('nombre'),
      supabase.from('cuentas_recurrentes').select('*').order('concepto'),
      supabase.from('usuarios').select('id, nombre_completo, rol').order('nombre_completo')
    ])
    const err = [o, p, c, v, r, e].find(x => x.error)
    if (err) notificar('No se pudo cargar Cuentas: ' + err.error.message + ' (¿ejecutaste 07_cuentas_admin.sql?)', 'error')
    setObls(o.data || []); setPagos(p.data || []); setCats(c.data || [])
    setProvs(v.data || []); setRecs(r.data || []); setEmps(e.data || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const hoy = hoyISO()
  const en7 = sumarDias(hoy, 7)
  const oblMap = useMemo(() => Object.fromEntries(obls.map(o => [o.id, o])), [obls])
  const catMap = useMemo(() => Object.fromEntries(cats.map(c => [c.id, c])), [cats])

  const abiertas = obls.filter(o => ['pendiente', 'parcial', 'vencida'].includes(o.situacion))
  const vencidas = abiertas.filter(o => o.situacion === 'vencida')
  const proximas = abiertas.filter(o => o.situacion !== 'vencida' && o.fecha_vencimiento <= en7)
  const delMes = obls.filter(o => o.situacion !== 'anulada' && (o.fecha_vencimiento || '').slice(0, 7) === mes)
  const pagosMes = pagos.filter(p => (p.fecha_pago || '').slice(0, 7) === mes && oblMap[p.obligacion_id]?.situacion !== 'anulada')
  const porCategoria = Object.entries(pagosMes.reduce((acc, p) => {
    const n = oblMap[p.obligacion_id]?.categoria || 'Otros'
    acc[n] = (acc[n] || 0) + Number(p.monto); return acc
  }, {})).sort((a, b) => b[1] - a[1])
  const totalPagadoMes = suma(pagosMes, p => p.monto)

  /* ---------- Acciones ---------- */
  const abrirObl = (preset = {}) => setModal({ t: 'obl', d: {
    id: null, concepto: '', categoria_id: '', proveedor_id: '', empleado_id: '', monto_total: '', fecha_vencimiento: hoy,
    notas: '', yaPagada: false, fecha_pago: hoy, medio: 'Transferencia', cuenta_detalle: '', referencia: '', ...preset } })

  const editarObl = (o) => abrirObl({ id: o.id, concepto: o.concepto, categoria_id: o.categoria_id, proveedor_id: o.proveedor_id || '',
    empleado_id: o.empleado_id || '', monto_total: String(o.monto_total), fecha_vencimiento: o.fecha_vencimiento, notas: o.notas || '', _pagado: Number(o.pagado), _desc: Number(o.descuento) })

  const guardarObl = async () => {
    const d = modal.d, monto = Number(d.monto_total), g = catMap[d.categoria_id]?.grupo
    if (!d.concepto.trim()) return notificar('Escribe el concepto.', 'error')
    if (!d.categoria_id) return notificar('Elige la categoría.', 'error')
    if (!(monto > 0)) return notificar('El monto debe ser mayor a cero.', 'error')
    if (!d.fecha_vencimiento) return notificar('Indica la fecha de vencimiento.', 'error')
    if (g === 'personal' && !d.empleado_id) return notificar('Elige el empleado.', 'error')
    if (d.id && monto - (d._desc || 0) < (d._pagado || 0)) return notificar('El monto no puede ser menor a lo ya pagado (' + soles(d._pagado) + ').', 'error')
    setGuardando(true)
    const fila = { concepto: d.concepto.trim(), categoria_id: d.categoria_id, proveedor_id: d.proveedor_id || null, empleado_id: d.empleado_id || null,
      monto_total: monto, fecha_vencimiento: d.fecha_vencimiento, periodo: d.fecha_vencimiento.slice(0, 7) + '-01', notas: d.notas.trim() || null,
      ...(d.recurrente_id && !d.id ? { recurrente_id: d.recurrente_id } : {}) }
    let res
    if (d.id) res = await supabase.from('cuentas_obligaciones').update(fila).eq('id', d.id)
    else res = await supabase.from('cuentas_obligaciones').insert([fila]).select().single()
    if (res.error) { setGuardando(false); return notificar('Error al guardar: ' + res.error.message, 'error') }
    if (!d.id && d.yaPagada) {
      const { error } = await supabase.from('cuentas_pagos').insert([{ obligacion_id: res.data.id, fecha_pago: d.fecha_pago, monto,
        medio: d.medio, cuenta_detalle: d.cuenta_detalle.trim() || null, referencia: d.referencia.trim() || null }])
      if (error) notificar('Se guardó la cuenta, pero falló el pago: ' + error.message, 'error')
    }
    setGuardando(false); setModal(null); notificar('Guardado', 'exito'); cargar()
  }

  const anular = async (o, hacer = true) => {
    if (hacer && !window.confirm(`¿Anular "${o.concepto}"? Dejará de contar en los totales.`)) return
    const { error } = await supabase.from('cuentas_obligaciones').update({ estado: hacer ? 'anulada' : 'activa' }).eq('id', o.id)
    if (error) return notificar('Error: ' + error.message, 'error')
    notificar(hacer ? 'Cuenta anulada' : 'Cuenta reactivada', 'exito'); cargar()
  }

  const abrirPago = (o) => setModal({ t: 'pago', d: { o, monto: String(Number(o.saldo).toFixed(2)), fecha_pago: hoy, medio: 'Transferencia',
    cuenta_detalle: '', referencia: '', notas: '', archivo: null } })

  const adelantosDe = (o) => o.empleado_id ? suma(obls.filter(x => x.id !== o.id && x.empleado_id === o.empleado_id && x.categoria === 'Adelantos' &&
    x.situacion !== 'anulada' && x.fecha_vencimiento.slice(0, 7) === o.fecha_vencimiento.slice(0, 7)), x => x.pagado) : 0

  const descontarAdelantos = async (o, monto) => {
    const { error } = await supabase.from('cuentas_obligaciones').update({ descuento: monto }).eq('id', o.id)
    if (error) return notificar('Error: ' + error.message, 'error')
    notificar('Adelantos descontados del sueldo', 'exito')
    await cargar()
    setModal(m => m && ({ ...m, d: { ...m.d, o: { ...m.d.o, descuento: monto, saldo: Number(o.monto_total) - monto - Number(o.pagado) },
      monto: String((Number(o.monto_total) - monto - Number(o.pagado)).toFixed(2)) } }))
  }

  const guardarPago = async () => {
    const d = modal.d, monto = Number(d.monto)
    if (!(monto > 0)) return notificar('El monto debe ser mayor a cero.', 'error')
    if (monto > Number(d.o.saldo) + 0.001) return notificar('El monto supera el saldo pendiente (' + soles(d.o.saldo) + ').', 'error')
    setGuardando(true)
    let ruta = null
    if (d.archivo) {
      ruta = `${d.o.id}/${Date.now()}-${d.archivo.name.replace(/[^\w.-]/g, '_')}`
      const up = await supabase.storage.from('comprobantes').upload(ruta, d.archivo, { contentType: d.archivo.type })
      if (up.error) { setGuardando(false); return notificar('No se pudo subir el comprobante: ' + up.error.message, 'error') }
    }
    const { error } = await supabase.from('cuentas_pagos').insert([{ obligacion_id: d.o.id, fecha_pago: d.fecha_pago, monto, medio: d.medio,
      cuenta_detalle: d.cuenta_detalle.trim() || null, referencia: d.referencia.trim() || null, comprobante_path: ruta, notas: d.notas.trim() || null }])
    setGuardando(false)
    if (error) return notificar('Error al registrar el pago: ' + error.message, 'error')
    setModal(null); notificar('Pago registrado', 'exito'); cargar()
  }

  const verComprobante = async (ruta) => {
    const { data, error } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 300)
    if (error) return notificar('No se pudo abrir el comprobante: ' + error.message, 'error')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const eliminarPago = async (p) => {
    if (!window.confirm(`¿Eliminar el pago de ${soles(p.monto)}? La cuenta volverá a tener saldo pendiente.`)) return
    const { error } = await supabase.from('cuentas_pagos').delete().eq('id', p.id)
    if (error) return notificar('Error: ' + error.message, 'error')
    if (p.comprobante_path) await supabase.storage.from('comprobantes').remove([p.comprobante_path])
    notificar('Pago eliminado', 'exito'); cargar()
  }

  const generarMes = async () => {
    const { data, error } = await supabase.rpc('generar_obligaciones_mes', { p_mes: mes + '-01' })
    if (error) return notificar('Error al generar: ' + error.message, 'error')
    notificar(data > 0 ? `Se generaron ${data} cuentas para ${mesLargo(mes)}` : `No había nada nuevo que generar para ${mesLargo(mes)}`, data > 0 ? 'exito' : 'aviso')
    cargar()
  }

  const guardarRec = async () => {
    const d = modal.d, monto = Number(d.monto), dia = Number(d.dia_vencimiento), g = catMap[d.categoria_id]?.grupo
    if (!d.concepto.trim() || !d.categoria_id) return notificar('Completa el concepto y la categoría.', 'error')
    if (!(monto > 0)) return notificar('El monto debe ser mayor a cero.', 'error')
    if (!(dia >= 1 && dia <= 31)) return notificar('El día de vencimiento debe estar entre 1 y 31.', 'error')
    if (g === 'personal' && !d.empleado_id) return notificar('Elige el empleado.', 'error')
    const fila = { concepto: d.concepto.trim(), categoria_id: d.categoria_id, proveedor_id: d.proveedor_id || null, empleado_id: d.empleado_id || null,
      monto, dia_vencimiento: dia, activo: !!d.activo }
    setGuardando(true)
    const { error } = d.id ? await supabase.from('cuentas_recurrentes').update(fila).eq('id', d.id) : await supabase.from('cuentas_recurrentes').insert([fila])
    setGuardando(false)
    if (error) return notificar('Error al guardar: ' + error.message, 'error')
    setModal(null); notificar('Guardado', 'exito'); cargar()
  }

  const guardarSimple = async (tabla, fila, id) => {
    const { error } = id ? await supabase.from(tabla).update(fila).eq('id', id) : await supabase.from(tabla).insert([fila])
    if (error) return notificar('Error: ' + (error.code === '23505' ? 'ya existe uno con ese nombre.' : error.message), 'error')
    setModal(null); notificar('Guardado', 'exito'); cargar()
  }

  /* ---------- Empleados (planilla) y servicios del mes ---------- */
  const catSueldos = cats.find(c => c.nombre === 'Sueldos')
  const recDe = (uid) => recs.find(r => r.empleado_id === uid && r.categoria_id === catSueldos?.id)
  const oblDe = (r) => r ? obls.find(o => o.recurrente_id === r.id && (o.periodo || '').slice(0, 7) === mes) : undefined

  const asegurarObl = async (r, nombre) => {
    const ex = oblDe(r)
    const datos = { monto_total: Number(r.monto), fecha_vencimiento: venceEn(mes, r.dia_vencimiento) }
    if (!ex) return supabase.from('cuentas_obligaciones').insert([{ concepto: r.empleado_id ? `Sueldo · ${nombre}` : r.concepto,
      categoria_id: r.categoria_id, proveedor_id: r.proveedor_id || null, empleado_id: r.empleado_id || null, recurrente_id: r.id, periodo: mes + '-01', ...datos }])
    if (ex.estado === 'anulada') return supabase.from('cuentas_obligaciones').update({ estado: 'activa', ...datos }).eq('id', ex.id)
    if (Number(ex.pagado) === 0) return supabase.from('cuentas_obligaciones').update(datos).eq('id', ex.id)
    return { error: null }
  }

  const guardarSueldo = async (u) => {
    if (!catSueldos) return notificar('Falta la categoría "Sueldos". Ejecuta el SQL 07_cuentas_admin.sql.', 'error')
    const r0 = recDe(u.id), v = edSueldo[u.id] || {}
    const monto = Number(v.monto ?? r0?.monto), dia = Number(v.dia ?? r0?.dia_vencimiento ?? 30)
    if (!(monto > 0)) return notificar('Escribe el sueldo mensual de ' + u.nombre_completo + '.', 'error')
    if (!(dia >= 1 && dia <= 31)) return notificar('El día de pago debe estar entre 1 y 31.', 'error')
    setGuardando(u.id)
    let rec = r0
    if (r0) {
      const { error } = await supabase.from('cuentas_recurrentes').update({ monto, dia_vencimiento: dia, activo: true }).eq('id', r0.id)
      if (error) { setGuardando(false); return notificar('Error: ' + error.message, 'error') }
      rec = { ...r0, monto, dia_vencimiento: dia }
    } else {
      const { data, error } = await supabase.from('cuentas_recurrentes').insert([{ concepto: `Sueldo · ${u.nombre_completo}`, categoria_id: catSueldos.id,
        empleado_id: u.id, monto, dia_vencimiento: dia }]).select().single()
      if (error) { setGuardando(false); return notificar('Error: ' + error.message, 'error') }
      rec = data
    }
    const { error: e2 } = await asegurarObl(rec, u.nombre_completo)
    setGuardando(false)
    if (e2) return notificar('Se guardó el sueldo, pero no se pudo crear el pago pendiente: ' + e2.message, 'error')
    setEdSueldo(s => { const n = { ...s }; delete n[u.id]; return n })
    notificar(`Sueldo guardado. Pago pendiente de ${mesLargo(mes)} listo.`, 'exito'); cargar()
  }

  const generarSueldos = async () => {
    const lista = emps.map(u => [u, recDe(u.id)]).filter(([, r]) => r && r.activo && !oblDe(r))
    if (!emps.some(u => recDe(u.id))) return notificar('Asigna primero un sueldo a tus empleados.', 'aviso')
    if (!lista.length) return notificar('Los sueldos de ' + mesLargo(mes) + ' ya estaban generados.', 'aviso')
    setGuardando(true)
    for (const [u, r] of lista) {
      const { error } = await asegurarObl(r, u.nombre_completo)
      if (error) { setGuardando(false); return notificar('Error: ' + error.message, 'error') }
    }
    setGuardando(false); notificar(`Se generaron ${lista.length} sueldos pendientes de ${mesLargo(mes)}`, 'exito'); cargar()
  }

  /* ---------- Piezas de interfaz ---------- */
  const SelCat = ({ d, set }) => (
    <Campo label="Categoría">
      <select className={inp} value={d.categoria_id} onChange={(e) => set({ categoria_id: e.target.value })}>
        <option value="">— Elegir —</option>
        {cats.filter(c => c.activa || c.id === d.categoria_id).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
    </Campo>
  )
  const Relacion = ({ d, set }) => {
    const g = catMap[d.categoria_id]?.grupo
    if (g === 'personal') return (
      <Campo label="Empleado">
        <select className={inp} value={d.empleado_id} onChange={(e) => set({ empleado_id: e.target.value })}>
          <option value="">— Elegir —</option>{emps.map(u => <option key={u.id} value={u.id}>{u.nombre_completo}</option>)}
        </select>
      </Campo>)
    if (g === 'proveedor') return (
      <Campo label="Proveedor">
        <select className={inp} value={d.proveedor_id} onChange={(e) => set({ proveedor_id: e.target.value })}>
          <option value="">— Sin proveedor —</option>{provs.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </Campo>)
    return null
  }
  const CamposPago = ({ d, set }) => (
    <div className="grid grid-cols-2 gap-3">
      <Campo label="Fecha de pago"><input type="date" className={inp} value={d.fecha_pago} onChange={(e) => set({ fecha_pago: e.target.value })} /></Campo>
      <Campo label="Medio de pago">
        <select className={inp} value={d.medio} onChange={(e) => set({ medio: e.target.value })}>{MEDIOS.map(m => <option key={m}>{m}</option>)}</select>
      </Campo>
      <Campo label="Cuenta o número (opcional)"><input className={inp} value={d.cuenta_detalle} onChange={(e) => set({ cuenta_detalle: e.target.value })} placeholder="BCP cta. corriente, Yape 999…" /></Campo>
      <Campo label="N.º de operación (opcional)"><input className={inp} value={d.referencia} onChange={(e) => set({ referencia: e.target.value })} /></Campo>
    </div>
  )

  const filas = obls.filter(o => {
    const sit = fSit === 'abiertas' ? ['pendiente', 'parcial', 'vencida'].includes(o.situacion) : fSit === 'todas' ? true : o.situacion === fSit
    const q = busca.trim().toLowerCase()
    return sit && (fGrupo === 'todos' || o.grupo === fGrupo) &&
      (!q || `${o.concepto} ${o.categoria} ${o.proveedor || ''} ${o.empleado || ''}`.toLowerCase().includes(q))
  }).sort((a, b) => fSit === 'pagada' || fSit === 'todas' ? b.fecha_vencimiento.localeCompare(a.fecha_vencimiento) : a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))

  const FilaAtencion = ({ o }) => (
    <div key={o.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{o.concepto}{o.empleado ? ` · ${o.empleado}` : o.proveedor ? ` · ${o.proveedor}` : ''}</p>
        <p className={`text-xs ${o.situacion === 'vencida' ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
          {o.situacion === 'vencida' ? 'Venció el ' : 'Vence el '}{fechaCorta(o.fecha_vencimiento)}</p>
      </div>
      <span className="font-bold text-gray-800 text-sm">{soles(o.saldo)}</span>
      <button onClick={() => abrirPago(o)} className="bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-3 py-1.5 rounded-lg text-xs">Pagar</button>
    </div>
  )

  if (cargando) return <p className="text-gray-500">Cargando cuentas…</p>

  const TABS = [['resumen', '📊 Resumen'], ['porpagar', '🧾 Por pagar'], ['empleados', '👥 Empleados'], ['servicios', '🏠 Servicios y alquiler'], ['pagos', '✅ Pagos realizados'], ['catalogos', '🏷️ Proveedores y categorías']]

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver</button>
          <h2 className="text-xl font-bold text-gray-800">💼 Cuentas y pagos</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => abrirObl()} className={btnP}>+ Nueva cuenta por pagar</button>
          <button onClick={() => abrirObl({ yaPagada: true })} className={btnS}>+ Gasto ya pagado</button>
          <button onClick={() => abrirObl({ yaPagada: true, categoria_id: cats.find(c => c.nombre === 'Adelantos')?.id || '' })} className={btnS}>Adelanto a empleado</button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 mb-5">
        {TABS.map(([id, t]) => (
          <button key={id} onClick={() => setTab(id)}
            className={'px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ' + (tab === id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>{t}</button>
        ))}
      </div>

      {cats.length === 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          No hay categorías de gasto cargadas. Ejecuta <b>07_cuentas_admin.sql</b> en Supabase y recarga la página.
        </div>
      )}

      {/* ---------- RESUMEN ---------- */}
      {tab === 'resumen' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-gray-600">Mes</label>
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-xl text-sm" />
            <span className="text-sm text-gray-500 capitalize">{mesLargo(mes)}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tarjeta titulo="Por pagar este mes" valor={soles(suma(delMes.filter(o => o.saldo > 0), o => o.saldo))} detalle={`${delMes.filter(o => o.saldo > 0).length} cuentas con saldo`} color="text-amber-600" />
            <Tarjeta titulo="Pagado este mes" valor={soles(totalPagadoMes)} detalle={`${pagosMes.length} pagos`} color="text-green-700" />
            <Tarjeta titulo="Vencido (todas)" valor={soles(suma(vencidas, o => o.saldo))} detalle={`${vencidas.length} cuentas vencidas`} color={vencidas.length ? 'text-red-600' : 'text-gray-800'} />
            <Tarjeta titulo="Vence en 7 días" valor={soles(suma(proximas, o => o.saldo))} detalle={`${proximas.length} cuentas`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-bold text-gray-800 mb-2">Requiere atención</h3>
              {[...vencidas, ...proximas].length === 0
                ? <p className="text-sm text-gray-400 py-4">Todo al día. No hay cuentas vencidas ni por vencer esta semana. 🎉</p>
                : [...vencidas, ...proximas].slice(0, 8).map(o => FilaAtencion({ o }))}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-bold text-gray-800 mb-3">Dónde se fue el dinero en {mesLargo(mes)}</h3>
              {porCategoria.length === 0 ? <p className="text-sm text-gray-400 py-4">Aún no hay pagos registrados este mes.</p> : porCategoria.map(([n, m]) => (
                <div key={n} className="mb-3">
                  <div className="flex justify-between text-sm"><span className="font-medium text-gray-700">{n}</span><span className="font-bold text-gray-800">{soles(m)}</span></div>
                  <div className="h-2 bg-gray-100 rounded-full mt-1"><div className="h-2 bg-green-500 rounded-full" style={{ width: `${Math.max(4, (m / totalPagadoMes) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------- POR PAGAR ---------- */}
      {tab === 'porpagar' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col lg:flex-row gap-3">
            <input className={inp + ' flex-1'} placeholder="🔍 Buscar por concepto, proveedor o empleado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className={inp + ' lg:w-48'} value={fSit} onChange={(e) => setFSit(e.target.value)}>
              <option value="abiertas">Por pagar (abiertas)</option><option value="vencida">Solo vencidas</option>
              <option value="pagada">Pagadas</option><option value="anulada">Anuladas</option><option value="todas">Todas</option>
            </select>
            <select className={inp + ' lg:w-48'} value={fGrupo} onChange={(e) => setFGrupo(e.target.value)}>
              <option value="todos">Todos los tipos</option><option value="fijo">Gastos fijos</option><option value="personal">Personal</option>
              <option value="proveedor">Proveedores</option><option value="otro">Otros</option>
            </select>
          </div>
          <div className="overflow-x-auto max-h-[560px]">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-sm"><tr>
                <th className="p-3 font-semibold">Vence</th><th className="p-3 font-semibold">Concepto</th><th className="p-3 font-semibold">Categoría</th>
                <th className="p-3 font-semibold text-right">Total</th><th className="p-3 font-semibold text-right">Saldo</th><th className="p-3 font-semibold">Estado</th><th className="p-3 font-semibold text-center">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {filas.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="p-3 whitespace-nowrap text-gray-600">{fechaCorta(o.fecha_vencimiento)}</td>
                    <td className="p-3"><p className="font-medium text-gray-800">{o.concepto}</p>
                      {(o.empleado || o.proveedor) && <p className="text-xs text-gray-400">{o.empleado || o.proveedor}</p>}</td>
                    <td className="p-3 text-gray-500">{o.categoria}</td>
                    <td className="p-3 text-right">{soles(Number(o.monto_total) - Number(o.descuento))}{Number(o.descuento) > 0 && <p className="text-[11px] text-amber-600">desc. {soles(o.descuento)}</p>}</td>
                    <td className="p-3 text-right font-bold">{soles(o.situacion === 'anulada' ? 0 : o.saldo)}</td>
                    <td className="p-3"><span className={`text-xs font-bold px-2 py-1 rounded-full border ${CHIP[o.situacion]}`}>{ETIQ[o.situacion]}</span></td>
                    <td className="p-3 text-center whitespace-nowrap">
                      {['pendiente', 'parcial', 'vencida'].includes(o.situacion) && <button onClick={() => abrirPago(o)} className="bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Pagar</button>}
                      {o.situacion !== 'anulada' && <button onClick={() => editarObl(o)} className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Editar</button>}
                      {o.situacion === 'anulada'
                        ? <button onClick={() => anular(o, false)} className="text-xs font-semibold text-gray-500 underline">Reactivar</button>
                        : o.situacion !== 'pagada' && <button onClick={() => anular(o)} className="text-xs font-semibold text-red-500 hover:underline">Anular</button>}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-gray-400">No hay cuentas con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- PAGOS REALIZADOS ---------- */}
      {tab === 'pagos' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <label className="text-sm font-bold text-gray-600">Mes</label>
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-xl text-sm" />
            <span className="ml-auto text-sm text-gray-600">{pagosMes.length} pagos · <b className="text-green-700">{soles(totalPagadoMes)}</b></span>
          </div>
          <div className="overflow-x-auto max-h-[560px]">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-sm"><tr>
                <th className="p-3 font-semibold">Fecha</th><th className="p-3 font-semibold">Concepto</th><th className="p-3 font-semibold">Medio</th>
                <th className="p-3 font-semibold">Operación</th><th className="p-3 font-semibold text-right">Monto</th><th className="p-3 font-semibold text-center">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {pagosMes.map(p => { const o = oblMap[p.obligacion_id]; return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="p-3 whitespace-nowrap text-gray-600">{fechaCorta(p.fecha_pago)}</td>
                    <td className="p-3"><p className="font-medium text-gray-800">{o?.concepto || '—'}</p><p className="text-xs text-gray-400">{o?.categoria}{o?.empleado ? ` · ${o.empleado}` : o?.proveedor ? ` · ${o.proveedor}` : ''}</p></td>
                    <td className="p-3 text-gray-600">{p.medio}{p.cuenta_detalle && <p className="text-xs text-gray-400">{p.cuenta_detalle}</p>}</td>
                    <td className="p-3 text-gray-500">{p.referencia || '—'}</td>
                    <td className="p-3 text-right font-bold text-green-700">{soles(p.monto)}</td>
                    <td className="p-3 text-center whitespace-nowrap">
                      {p.comprobante_path && <button onClick={() => verComprobante(p.comprobante_path)} className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">📎 Comprobante</button>}
                      <button onClick={() => eliminarPago(p)} className="text-xs font-semibold text-red-500 hover:underline">Eliminar</button>
                    </td>
                  </tr>) })}
                {pagosMes.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-400">No hay pagos registrados en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- EMPLEADOS ---------- */}
      {tab === 'empleados' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600 flex-1 min-w-[240px]">Asigna el sueldo mensual a cada empleado y guárdalo: queda como <b>pago pendiente</b> del mes. Los meses siguientes se generan con un clic.</p>
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-xl text-sm" />
            <button onClick={generarSueldos} disabled={!!guardando} className={btnP}>Generar sueldos de {mesLargo(mes)}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                <th className="p-3 font-semibold">Empleado</th><th className="p-3 font-semibold">Sueldo mensual (S/)</th><th className="p-3 font-semibold">Día de pago</th>
                <th className="p-3 font-semibold">Estado de {mesLargo(mes)}</th><th className="p-3 font-semibold text-right">Adelantos</th><th className="p-3 font-semibold text-center">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {emps.map(u => {
                  const r = recDe(u.id), o = oblDe(r)
                  const vm = edSueldo[u.id]?.monto ?? (r ? String(r.monto) : ''), vd = edSueldo[u.id]?.dia ?? (r ? String(r.dia_vencimiento) : '30')
                  const cambio = !r || Number(vm) !== Number(r.monto) || Number(vd) !== Number(r.dia_vencimiento)
                  const adel = suma(obls.filter(x => x.empleado_id === u.id && x.categoria === 'Adelantos' && x.situacion !== 'anulada' && x.fecha_vencimiento.slice(0, 7) === mes), x => x.pagado)
                  const set = (p) => setEdSueldo(s => ({ ...s, [u.id]: { monto: vm, dia: vd, ...(s[u.id] || {}), ...p } }))
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="p-3"><p className="font-medium text-gray-800">{u.nombre_completo}</p><p className="text-xs text-gray-400 capitalize">{u.rol}</p></td>
                      <td className="p-3"><input type="number" step="0.01" min="0" placeholder="0.00" value={vm} onChange={(e) => set({ monto: e.target.value })} className="w-32 px-3 py-2 border border-gray-300 rounded-xl text-sm" /></td>
                      <td className="p-3"><input type="number" min="1" max="31" value={vd} onChange={(e) => set({ dia: e.target.value })} className="w-20 px-3 py-2 border border-gray-300 rounded-xl text-sm" /></td>
                      <td className="p-3">
                        {o ? <span className={`text-xs font-bold px-2 py-1 rounded-full border ${CHIP[o.situacion]}`}>{ETIQ[o.situacion]}{o.situacion !== 'pagada' && o.situacion !== 'anulada' ? ` · ${soles(o.saldo)}` : ''}</span>
                           : <span className="text-xs text-gray-400">{r ? 'Sin generar' : 'Sin sueldo asignado'}</span>}
                      </td>
                      <td className="p-3 text-right text-gray-600">{adel > 0 ? soles(adel) : '—'}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button onClick={() => guardarSueldo(u)} disabled={guardando === u.id}
                          className={'font-semibold px-3 py-1.5 rounded-lg text-xs mr-1 ' + (cambio ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-100 text-gray-400')}>{guardando === u.id ? '…' : 'Guardar'}</button>
                        {o && ['pendiente', 'parcial', 'vencida'].includes(o.situacion) && <button onClick={() => abrirPago(o)} className="bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Pagar</button>}
                        <button onClick={() => abrirObl({ yaPagada: true, categoria_id: cats.find(c => c.nombre === 'Adelantos')?.id || '', empleado_id: u.id, concepto: `Adelanto · ${u.nombre_completo}` })} className="bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-3 py-1.5 rounded-lg text-xs">Adelanto</button>
                      </td>
                    </tr>)
                })}
                {emps.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-gray-400">No hay usuarios registrados. Crea a tus empleados en “Gestión de Usuarios”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- SERVICIOS Y ALQUILER ---------- */}
      {tab === 'servicios' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600 flex-1 min-w-[240px]">Alquiler, luz, agua, internet… Cuando llegue el recibo, toca <b>Registrar recibo</b> y pon el monto real: queda como pago pendiente.</p>
            <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-xl text-sm" />
            <button onClick={generarMes} className={btnS}>Generar todos con monto habitual</button>
            <button onClick={() => setModal({ t: 'rec', d: { id: null, concepto: '', categoria_id: '', proveedor_id: '', empleado_id: '', monto: '', dia_vencimiento: '1', activo: true } })} className={btnP}>+ Nuevo servicio o gasto fijo</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                <th className="p-3 font-semibold">Concepto</th><th className="p-3 font-semibold">Categoría</th><th className="p-3 font-semibold text-right">Monto habitual</th>
                <th className="p-3 font-semibold">Vence</th><th className="p-3 font-semibold">Estado de {mesLargo(mes)}</th><th className="p-3 font-semibold text-center">Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recs.filter(r => catMap[r.categoria_id]?.grupo !== 'personal').map(r => {
                  const o = oblDe(r)
                  return (
                    <tr key={r.id} className={r.activo ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}>
                      <td className="p-3"><p className="font-medium text-gray-800">{r.concepto}</p><p className="text-xs text-gray-400">{provs.find(p => p.id === r.proveedor_id)?.nombre || ''}{!r.activo && 'Pausado'}</p></td>
                      <td className="p-3 text-gray-500">{catMap[r.categoria_id]?.nombre}</td>
                      <td className="p-3 text-right font-bold">{soles(r.monto)}</td>
                      <td className="p-3 text-gray-600">Día {r.dia_vencimiento}</td>
                      <td className="p-3">{o ? <span className={`text-xs font-bold px-2 py-1 rounded-full border ${CHIP[o.situacion]}`}>{ETIQ[o.situacion]}{['pendiente', 'parcial', 'vencida'].includes(o.situacion) ? ` · ${soles(o.saldo)}` : ''}</span>
                        : <span className="text-xs text-gray-400">Sin registrar</span>}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {!o && <button onClick={() => abrirObl({ concepto: r.concepto, categoria_id: r.categoria_id, proveedor_id: r.proveedor_id || '', monto_total: String(r.monto),
                          fecha_vencimiento: venceEn(mes, r.dia_vencimiento), recurrente_id: r.id })} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Registrar recibo</button>}
                        {o && ['pendiente', 'parcial', 'vencida'].includes(o.situacion) && <>
                          <button onClick={() => abrirPago(o)} className="bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Pagar</button>
                          <button onClick={() => editarObl(o)} className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Cambiar monto</button></>}
                        {o?.situacion === 'anulada' && <button onClick={() => anular(o, false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-lg text-xs mr-1">Reactivar</button>}
                        <button onClick={() => setModal({ t: 'rec', d: { ...r, monto: String(r.monto), dia_vencimiento: String(r.dia_vencimiento), proveedor_id: r.proveedor_id || '', empleado_id: r.empleado_id || '' } })} className="text-xs font-semibold text-gray-500 hover:underline">Editar</button>
                      </td>
                    </tr>)
                })}
                {recs.filter(r => catMap[r.categoria_id]?.grupo !== 'personal').length === 0 &&
                  <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aún no hay servicios. Toca “+ Nuevo servicio o gasto fijo” y agrega el alquiler, la luz, el agua, el internet…<br />Si prefieres, también puedes usar “+ Nueva cuenta por pagar” arriba para un recibo suelto.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- PROVEEDORES Y CATEGORÍAS ---------- */}
      {tab === 'catalogos' && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-gray-800">Proveedores</h3>
              <button onClick={() => setModal({ t: 'prov', d: { id: null, nombre: '', documento: '', telefono: '', activo: true } })} className={btnS}>+ Agregar</button></div>
            {provs.length === 0 && <p className="text-sm text-gray-400">Sin proveedores todavía.</p>}
            {provs.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                <div className="flex-1"><p className={`text-sm font-semibold ${p.activo ? 'text-gray-800' : 'text-gray-400'}`}>{p.nombre}</p><p className="text-xs text-gray-400">{[p.documento, p.telefono].filter(Boolean).join(' · ')}</p></div>
                <button onClick={() => setModal({ t: 'prov', d: { ...p, documento: p.documento || '', telefono: p.telefono || '' } })} className="text-xs font-semibold text-blue-600 hover:underline">Editar</button>
              </div>))}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-gray-800">Categorías de gasto</h3>
              <button onClick={() => setModal({ t: 'cat', d: { id: null, nombre: '', grupo: 'otro', activa: true } })} className={btnS}>+ Agregar</button></div>
            {cats.map(c => (
              <div key={c.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                <div className="flex-1"><p className={`text-sm font-semibold ${c.activa ? 'text-gray-800' : 'text-gray-400'}`}>{c.nombre}</p>
                  <p className="text-xs text-gray-400">{{ fijo: 'Gasto fijo', personal: 'Personal', proveedor: 'Proveedores', otro: 'Otros' }[c.grupo]}</p></div>
                <button onClick={() => setModal({ t: 'cat', d: { ...c } })} className="text-xs font-semibold text-blue-600 hover:underline">Editar</button>
              </div>))}
          </div>
        </div>
      )}

      {/* ---------- MODALES ---------- */}
      {modal?.t === 'obl' && (() => {
        const d = modal.d, set = (p) => setModal({ ...modal, d: { ...d, ...p } })
        return (
          <Modal titulo={d.id ? 'Editar cuenta' : d.yaPagada ? 'Registrar gasto ya pagado' : 'Nueva cuenta por pagar'} onCerrar={() => setModal(null)}>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Concepto" className="col-span-2"><input className={inp} value={d.concepto} onChange={(e) => set({ concepto: e.target.value })} placeholder="Ej. Alquiler de noviembre, Factura F001-123" autoFocus /></Campo>
              {SelCat({ d, set })}
              {Relacion({ d, set })}
              <Campo label="Monto (S/)"><input type="number" step="0.01" min="0" className={inp} value={d.monto_total} onChange={(e) => set({ monto_total: e.target.value })} /></Campo>
              <Campo label="Fecha de vencimiento"><input type="date" className={inp} value={d.fecha_vencimiento} onChange={(e) => set({ fecha_vencimiento: e.target.value })} /></Campo>
              <Campo label="Notas (opcional)" className="col-span-2"><input className={inp} value={d.notas} onChange={(e) => set({ notas: e.target.value })} /></Campo>
            </div>
            {!d.id && (
              <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-gray-50">
                <label className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                  <input type="checkbox" className="w-4 h-4" checked={d.yaPagada} onChange={(e) => set({ yaPagada: e.target.checked })} /> Ya lo pagué (registrar el pago ahora)
                </label>
                {d.yaPagada && CamposPago({ d, set })}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className={btnS}>Cancelar</button>
              <button onClick={guardarObl} disabled={guardando} className={btnP}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </Modal>)
      })()}

      {modal?.t === 'pago' && (() => {
        const d = modal.d, set = (p) => setModal({ ...modal, d: { ...d, ...p } }), o = d.o, adel = adelantosDe(o)
        return (
          <Modal titulo="Registrar pago" onCerrar={() => setModal(null)}>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 text-sm">
              <p className="font-bold text-gray-800">{o.concepto}{o.empleado ? ` · ${o.empleado}` : o.proveedor ? ` · ${o.proveedor}` : ''}</p>
              <p className="text-gray-500">Vence {fechaCorta(o.fecha_vencimiento)} · Saldo pendiente <b className="text-gray-800">{soles(o.saldo)}</b></p>
            </div>
            {o.categoria === 'Sueldos' && adel > 0 && Number(o.descuento) === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm">
                <p className="text-amber-800">Este empleado recibió <b>{soles(adel)}</b> en adelantos este mes.</p>
                <button onClick={() => descontarAdelantos(o, adel)} className="mt-2 text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1.5 rounded-lg">Descontar adelantos del sueldo</button>
              </div>)}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Campo label="Monto a pagar (S/)" className="col-span-2"><input type="number" step="0.01" min="0" className={inp} value={d.monto} onChange={(e) => set({ monto: e.target.value })} /></Campo>
            </div>
            {CamposPago({ d, set })}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Campo label="Comprobante (foto o PDF, máx. 5 MB)" className="col-span-2">
                <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl cursor-pointer">
                  📎 {d.archivo ? 'Cambiar archivo' : 'Adjuntar comprobante'}
                  <input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f && f.size > 5 * 1024 * 1024) { notificar('El archivo pesa más de 5 MB.', 'aviso'); e.target.value = ''; return }
                    set({ archivo: f || null })
                  }} />
                </label>
                {d.archivo && <span className="text-xs text-gray-600 ml-2">{d.archivo.name}</span>}
              </Campo>
              <Campo label="Notas (opcional)" className="col-span-2"><input className={inp} value={d.notas} onChange={(e) => set({ notas: e.target.value })} /></Campo>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className={btnS}>Cancelar</button>
              <button onClick={guardarPago} disabled={guardando} className={btnP}>{guardando ? 'Guardando…' : 'Registrar pago'}</button>
            </div>
          </Modal>)
      })()}

      {modal?.t === 'rec' && (() => {
        const d = modal.d, set = (p) => setModal({ ...modal, d: { ...d, ...p } })
        return (
          <Modal titulo={d.id ? 'Editar pago fijo' : 'Nuevo pago fijo mensual'} onCerrar={() => setModal(null)}>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Concepto" className="col-span-2"><input className={inp} value={d.concepto} onChange={(e) => set({ concepto: e.target.value })} placeholder="Ej. Alquiler del local, Sueldo mensual" autoFocus /></Campo>
              {SelCat({ d, set })}
              {Relacion({ d, set })}
              <Campo label="Monto mensual (S/)"><input type="number" step="0.01" min="0" className={inp} value={d.monto} onChange={(e) => set({ monto: e.target.value })} /></Campo>
              <Campo label="Día de vencimiento (1–31)"><input type="number" min="1" max="31" className={inp} value={d.dia_vencimiento} onChange={(e) => set({ dia_vencimiento: e.target.value })} /></Campo>
              <label className="col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" className="w-4 h-4" checked={!!d.activo} onChange={(e) => set({ activo: e.target.checked })} /> Activo (se incluye al generar el mes)</label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className={btnS}>Cancelar</button>
              <button onClick={guardarRec} disabled={guardando} className={btnP}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </Modal>)
      })()}

      {modal?.t === 'prov' && (() => {
        const d = modal.d, set = (p) => setModal({ ...modal, d: { ...d, ...p } })
        return (
          <Modal titulo={d.id ? 'Editar proveedor' : 'Nuevo proveedor'} onCerrar={() => setModal(null)}>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nombre o razón social" className="col-span-2"><input className={inp} value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} autoFocus /></Campo>
              <Campo label="RUC o DNI (opcional)"><input className={inp} value={d.documento} onChange={(e) => set({ documento: e.target.value })} /></Campo>
              <Campo label="Teléfono (opcional)"><input className={inp} value={d.telefono} onChange={(e) => set({ telefono: e.target.value })} /></Campo>
              <label className="col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" className="w-4 h-4" checked={!!d.activo} onChange={(e) => set({ activo: e.target.checked })} /> Activo</label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className={btnS}>Cancelar</button>
              <button onClick={() => d.nombre.trim() ? guardarSimple('cuentas_proveedores', { nombre: d.nombre.trim(), documento: d.documento.trim() || null, telefono: d.telefono.trim() || null, activo: !!d.activo }, d.id) : notificar('Escribe el nombre.', 'error')} className={btnP}>Guardar</button>
            </div>
          </Modal>)
      })()}

      {modal?.t === 'cat' && (() => {
        const d = modal.d, set = (p) => setModal({ ...modal, d: { ...d, ...p } })
        return (
          <Modal titulo={d.id ? 'Editar categoría' : 'Nueva categoría'} onCerrar={() => setModal(null)}>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nombre" className="col-span-2"><input className={inp} value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} autoFocus /></Campo>
              <Campo label="Tipo" className="col-span-2">
                <select className={inp} value={d.grupo} onChange={(e) => set({ grupo: e.target.value })}>
                  <option value="fijo">Gasto fijo (alquiler, servicios)</option><option value="personal">Personal (pide elegir empleado)</option>
                  <option value="proveedor">Proveedores (pide elegir proveedor)</option><option value="otro">Otros</option>
                </select>
              </Campo>
              <label className="col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" className="w-4 h-4" checked={!!d.activa} onChange={(e) => set({ activa: e.target.checked })} /> Activa</label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className={btnS}>Cancelar</button>
              <button onClick={() => d.nombre.trim() ? guardarSimple('cuentas_categorias', { nombre: d.nombre.trim(), grupo: d.grupo, activa: !!d.activa }, d.id) : notificar('Escribe el nombre.', 'error')} className={btnP}>Guardar</button>
            </div>
          </Modal>)
      })()}
    </div>
  )
}
