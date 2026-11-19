// src/StockLocales.jsx  (POS de Valkat — solo administrador)
// Stock por local, guías de traslado (varios productos), confirmación de
// recepción, impresión de la guía y ajustes por conteo físico.
// Toda escritura pasa por funciones de la base (crear_traslado, recibir_traslado,
// anular_traslado, ajustar_stock): el navegador no modifica las tablas de stock.
import { useEffect, useMemo, useState } from 'react'

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const numeroGuia = (g) => `T-${String(g.numero ?? 0).padStart(4, '0')}`
const MAX_FILAS = 100
const ESTADOS = {
  en_transito: ['En tránsito', 'bg-amber-100 text-amber-800'],
  recibido: ['Recibido', 'bg-green-100 text-green-800'],
  anulado: ['Anulado', 'bg-gray-100 text-gray-500'],
}
const SELECT_GUIA = '*, traslado_items(producto_id, cantidad)'

function GuiaCard({ g, nombreProducto, nombreLocal, ocupado, onRecibir, onAnular, onImprimir }) {
  const [abierta, setAbierta] = useState(false)
  const items = g.traslado_items ?? []
  const unidades = items.reduce((a, i) => a + i.cantidad, 0)
  const [etiqueta, color] = ESTADOS[g.estado] ?? [g.estado, 'bg-gray-100 text-gray-600']

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setAbierta(!abierta)} className="flex-1 text-left">
          <b className="text-gray-900">{numeroGuia(g)}</b>
          <span className="ml-2 text-gray-700">{nombreLocal[g.origen_id] ?? '—'} → {nombreLocal[g.destino_id] ?? '—'}</span>
          <span className="ml-2 text-xs text-gray-500">
            {items.length} producto{items.length === 1 ? '' : 's'} · {unidades} u. · {new Date(g.created_at).toLocaleDateString()}
          </span>
        </button>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>{etiqueta}</span>
        <button type="button" onClick={() => onImprimir(g)} className="text-xs font-bold text-blue-600 hover:underline">Imprimir</button>
        {g.estado === 'en_transito' && (
          <>
            <button type="button" disabled={ocupado} onClick={() => onRecibir(g)}
              className="rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-60">
              Confirmar recepción
            </button>
            <button type="button" disabled={ocupado} onClick={() => onAnular(g)} className="text-xs font-bold text-red-600 hover:underline">Anular</button>
          </>
        )}
      </div>
      {abierta && (
        <ul className="mt-2 divide-y divide-gray-100 border-t pt-1 text-sm">
          {items.map((i) => (
            <li key={i.producto_id} className="flex justify-between py-1">
              <span className="text-gray-800">{nombreProducto[i.producto_id] ?? 'Producto'}</span>
              <b>{i.cantidad}</b>
            </li>
          ))}
          {g.nota && <li className="py-1 text-xs text-gray-500">Nota: {g.nota}</li>}
        </ul>
      )}
    </li>
  )
}

export default function StockLocales({ supabase, onCerrar, onCambio }) {
  const [locales, setLocales] = useState([])
  const [productos, setProductos] = useState([])
  const [stock, setStock] = useState([])
  const [transito, setTransito] = useState([])
  const [historial, setHistorial] = useState([])
  const [vista, setVista] = useState('transito')
  const [busqueda, setBusqueda] = useState('')
  const [borrador, setBorrador] = useState(null) // { origen, destino, nota, lineas: [{ producto_id, cantidad }] }
  const [buscaLinea, setBuscaLinea] = useState('')
  const [ajuste, setAjuste] = useState(null)     // { producto, local, nuevo, motivo }
  const [mensaje, setMensaje] = useState(null)   // { tipo: 'error' | 'ok', texto }
  const [ocupado, setOcupado] = useState(false)

  const cargar = async () => {
    const [l, p, s, t, h] = await Promise.all([
      supabase.from('locales').select('id, nombre, es_principal')
        .eq('guarda_stock', true).eq('activo', true)
        .order('es_principal', { ascending: false }).order('nombre'),
      supabase.from('productos').select('id, nombre, marca').order('nombre'),
      supabase.from('stock_local').select('producto_id, local_id, cantidad'),
      supabase.from('traslados').select(SELECT_GUIA).eq('estado', 'en_transito').order('created_at', { ascending: false }),
      supabase.from('traslados').select(SELECT_GUIA).order('created_at', { ascending: false }).limit(30),
    ])
    setLocales(l.data ?? [])
    setProductos(p.data ?? [])
    setStock(s.data ?? [])
    setTransito(t.data ?? [])
    setHistorial(h.data ?? [])
    if (t.error) setMensaje({ tipo: 'error', texto: 'No se pudieron cargar los traslados. ¿Ya ejecutaste 08_traslados_guia.sql? ' + t.error.message })
  }
  useEffect(() => { cargar() }, []) // eslint-disable-line

  const cantidad = useMemo(() => {
    const m = {}
    stock.forEach((s) => { m[`${s.producto_id}|${s.local_id}`] = s.cantidad })
    return m
  }, [stock])

  const enTransito = useMemo(() => {
    const m = {}
    transito.forEach((g) => (g.traslado_items ?? []).forEach((i) => { m[i.producto_id] = (m[i.producto_id] ?? 0) + i.cantidad }))
    return m
  }, [transito])

  const nombreProducto = useMemo(() => Object.fromEntries(productos.map((p) => [p.id, p.nombre])), [productos])
  const nombreLocal = useMemo(() => Object.fromEntries(locales.map((l) => [l.id, l.nombre])), [locales])
  const disponible = (productoId, localId) => cantidad[`${productoId}|${localId}`] ?? 0

  const filtrados = useMemo(() => {
    const q = sinTildes(busqueda).split(/\s+/).filter(Boolean)
    return productos.filter((p) => {
      const hay = sinTildes(`${p.nombre} ${p.marca ?? ''}`)
      return q.every((w) => hay.includes(w))
    })
  }, [productos, busqueda])

  /* ---------- Nueva guía de traslado ---------- */
  const nuevaGuia = (producto) => {
    setMensaje(null); setAjuste(null); setBuscaLinea('')
    setBorrador({
      origen: locales[0]?.id ?? '', destino: locales[1]?.id ?? '', nota: '',
      lineas: producto ? [{ producto_id: producto.id, cantidad: 1 }] : [],
    })
  }

  const sugerencias = useMemo(() => {
    if (!borrador || !buscaLinea.trim()) return []
    const q = sinTildes(buscaLinea).split(/\s+/).filter(Boolean)
    const usados = new Set(borrador.lineas.map((l) => l.producto_id))
    return productos
      .filter((p) => !usados.has(p.id) && disponible(p.id, borrador.origen) > 0
        && q.every((w) => sinTildes(`${p.nombre} ${p.marca ?? ''}`).includes(w)))
      .slice(0, 8)
  }, [borrador, buscaLinea, productos, cantidad]) // eslint-disable-line

  const cambiarLinea = (productoId, valor) =>
    setBorrador({ ...borrador, lineas: borrador.lineas.map((l) => (l.producto_id === productoId ? { ...l, cantidad: valor } : l)) })
  const quitarLinea = (productoId) =>
    setBorrador({ ...borrador, lineas: borrador.lineas.filter((l) => l.producto_id !== productoId) })

  const crearGuia = async (e) => {
    e.preventDefault()
    if (!borrador.lineas.length) return setMensaje({ tipo: 'error', texto: 'Agrega al menos un producto a la guía.' })
    setOcupado(true); setMensaje(null)
    const { error } = await supabase.rpc('crear_traslado', {
      p_origen: borrador.origen,
      p_destino: borrador.destino,
      p_nota: borrador.nota.trim() || null,
      p_items: borrador.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: parseInt(l.cantidad, 10) })),
    })
    setOcupado(false)
    if (error) return setMensaje({ tipo: 'error', texto: error.message })
    setBorrador(null); setBuscaLinea(''); setVista('transito')
    setMensaje({ tipo: 'ok', texto: 'Guía creada. Las unidades ya salieron del origen y quedan en tránsito hasta confirmar la recepción.' })
    await cargar(); onCambio?.()
  }

  /* ---------- Recibir / anular / imprimir ---------- */
  const gestionar = async (g, rpc) => {
    if (rpc === 'anular_traslado' && !window.confirm(`¿Anular la guía ${numeroGuia(g)}? Las unidades vuelven al local de origen.`)) return
    setOcupado(true); setMensaje(null)
    const { error } = await supabase.rpc(rpc, { p_traslado: g.id })
    setOcupado(false)
    if (error) return setMensaje({ tipo: 'error', texto: error.message })
    await cargar(); onCambio?.()
  }

  const imprimirGuia = (g) => {
    const items = g.traslado_items ?? []
    const filas = items.map((i, n) =>
      `<tr><td>${n + 1}</td><td>${esc(nombreProducto[i.producto_id] ?? 'Producto')}</td><td class="r">${i.cantidad}</td></tr>`).join('')
    const unidades = items.reduce((a, i) => a + i.cantidad, 0)
    const w = window.open('', '_blank')
    if (!w) return setMensaje({ tipo: 'error', texto: 'Permite las ventanas emergentes del navegador para imprimir la guía.' })
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía ${numeroGuia(g)}</title>
<style>
  body{font:14px Arial,sans-serif;color:#111;margin:32px}
  h1{font-size:20px;margin:0 0 4px} .m{color:#555;margin:2px 0}
  table{width:100%;border-collapse:collapse;margin:18px 0}
  th,td{border-bottom:1px solid #ccc;padding:7px 6px;text-align:left} th{background:#f3f4f6}
  .r{text-align:right} .f{display:flex;gap:48px;margin-top:64px} .f div{flex:1;border-top:1px solid #111;padding-top:6px;text-align:center}
</style></head><body>
<h1>Valkat Store — Guía de traslado ${numeroGuia(g)}</h1>
<p class="m"><b>Fecha:</b> ${new Date(g.created_at).toLocaleString()}</p>
<p class="m"><b>Origen:</b> ${esc(nombreLocal[g.origen_id] ?? '—')} &nbsp;&nbsp; <b>Destino:</b> ${esc(nombreLocal[g.destino_id] ?? '—')}</p>
<p class="m"><b>Estado:</b> ${esc((ESTADOS[g.estado] ?? [g.estado])[0])}</p>
${g.nota ? `<p class="m"><b>Nota:</b> ${esc(g.nota)}</p>` : ''}
<table><thead><tr><th>N.º</th><th>Producto</th><th class="r">Cantidad</th></tr></thead><tbody>${filas}</tbody>
<tfoot><tr><td></td><td class="r"><b>Total de unidades</b></td><td class="r"><b>${unidades}</b></td></tr></tfoot></table>
<div class="f"><div>Entrega</div><div>Recibe</div></div>
</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  /* ---------- Ajuste por conteo ---------- */
  const abrirAjuste = (producto) => {
    setMensaje(null); setBorrador(null)
    setAjuste({ producto, local: locales[0]?.id ?? '', nuevo: '', motivo: '' })
  }

  const guardarAjuste = async (e) => {
    e.preventDefault()
    setOcupado(true); setMensaje(null)
    const { error } = await supabase.rpc('ajustar_stock', {
      p_producto: ajuste.producto.id, p_local: ajuste.local,
      p_nuevo: parseInt(ajuste.nuevo, 10), p_motivo: ajuste.motivo.trim(),
    })
    setOcupado(false)
    if (error) return setMensaje({ tipo: 'error', texto: error.message })
    setAjuste(null)
    await cargar(); onCambio?.()
  }

  const input = 'w-full rounded-xl border px-3 py-2 text-sm'
  const guiasVisibles = vista === 'transito' ? transito : historial

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-green-200 bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">📦 Stock por local y traslados</h3>
          <button type="button" onClick={onCerrar} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {mensaje && (
          <p className={`mb-3 rounded-lg p-2 text-sm ${mensaje.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            {mensaje.texto}
          </p>
        )}

        {/* Guías */}
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setVista('transito')}
              className={`rounded-xl px-3 py-1.5 text-sm font-bold ${vista === 'transito' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
              En tránsito ({transito.length})
            </button>
            <button type="button" onClick={() => setVista('historial')}
              className={`rounded-xl px-3 py-1.5 text-sm font-bold ${vista === 'historial' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
              Historial
            </button>
            <button type="button" onClick={() => nuevaGuia(null)}
              className="ml-auto rounded-xl bg-green-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-green-700">
              ➕ Nueva guía de traslado
            </button>
          </div>
          {guiasVisibles.length ? (
            <ul className="space-y-2">
              {guiasVisibles.map((g) => (
                <GuiaCard key={g.id} g={g} nombreProducto={nombreProducto} nombreLocal={nombreLocal} ocupado={ocupado}
                  onRecibir={(x) => gestionar(x, 'recibir_traslado')} onAnular={(x) => gestionar(x, 'anular_traslado')}
                  onImprimir={imprimirGuia} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-3 text-center text-sm text-gray-400">
              {vista === 'transito' ? 'No hay traslados en tránsito.' : 'Aún no hay guías.'}
            </p>
          )}
        </div>

        {/* Nueva guía */}
        {borrador && (
          <form onSubmit={crearGuia} className="mb-4 space-y-3 rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-bold text-gray-800">Nueva guía de traslado</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-bold text-gray-600">Desde
                <select className={`${input} mt-1 bg-white`} value={borrador.origen}
                  onChange={(e) => setBorrador({ ...borrador, origen: e.target.value })}>
                  {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">Hacia
                <select className={`${input} mt-1 bg-white`} value={borrador.destino}
                  onChange={(e) => setBorrador({ ...borrador, destino: e.target.value })}>
                  {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">Nota (opcional)
                <input className={`${input} mt-1`} value={borrador.nota}
                  onChange={(e) => setBorrador({ ...borrador, nota: e.target.value })} />
              </label>
            </div>

            <div className="relative">
              <input className={input} placeholder="Buscar producto para agregar…" value={buscaLinea}
                onChange={(e) => setBuscaLinea(e.target.value)} />
              {sugerencias.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border bg-white shadow-lg">
                  {sugerencias.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-green-50"
                        onClick={() => {
                          setBorrador({ ...borrador, lineas: [...borrador.lineas, { producto_id: p.id, cantidad: 1 }] })
                          setBuscaLinea('')
                        }}>
                        <span>{p.nombre} <span className="text-xs text-gray-400">{p.marca}</span></span>
                        <span className="text-xs text-gray-500">disp. {disponible(p.id, borrador.origen)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11px] text-gray-500">Solo aparecen productos con stock en el local de origen.</p>
            </div>

            {borrador.lineas.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr><th className="py-1">Producto</th><th className="py-1 text-right">Disponible</th><th className="py-1 text-right">Cantidad</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-green-100">
                  {borrador.lineas.map((l) => {
                    const disp = disponible(l.producto_id, borrador.origen)
                    return (
                      <tr key={l.producto_id}>
                        <td className="py-1 text-gray-800">{nombreProducto[l.producto_id]}</td>
                        <td className="py-1 text-right text-gray-500">{disp}</td>
                        <td className="py-1 text-right">
                          <input type="number" min="1" max={disp} required value={l.cantidad}
                            onChange={(e) => cambiarLinea(l.producto_id, e.target.value)}
                            className="w-20 rounded-lg border px-2 py-1 text-right" />
                        </td>
                        <td className="py-1 pl-2 text-right">
                          <button type="button" onClick={() => quitarLinea(l.producto_id)} className="text-gray-400 hover:text-red-600">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setBorrador(null)} className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-700">Cancelar</button>
              <button disabled={ocupado} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60">
                Crear guía de traslado
              </button>
            </div>
          </form>
        )}

        {/* Ajuste */}
        {ajuste && (
          <form onSubmit={guardarAjuste} className="mb-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-bold text-gray-800">Ajustar stock de: {ajuste.producto.nombre}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-bold text-gray-600">Local
                <select className={`${input} mt-1 bg-white`} value={ajuste.local} onChange={(e) => setAjuste({ ...ajuste, local: e.target.value })}>
                  {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre} ({disponible(ajuste.producto.id, l.id)})</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-gray-600">Stock real contado
                <input type="number" min="0" required className={`${input} mt-1`} value={ajuste.nuevo}
                  onChange={(e) => setAjuste({ ...ajuste, nuevo: e.target.value })} />
              </label>
              <label className="text-xs font-bold text-gray-600">Motivo (obligatorio)
                <input required className={`${input} mt-1`} placeholder="Ej. conteo físico" value={ajuste.motivo}
                  onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAjuste(null)} className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-700">Cancelar</button>
              <button disabled={ocupado} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">Guardar ajuste</button>
            </div>
          </form>
        )}

        {/* Tabla de stock */}
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto…" className={`${input} mb-3`} />

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                {locales.map((l) => <th key={l.id} className="px-3 py-2 text-right">{l.nombre}</th>)}
                <th className="px-3 py-2 text-right">En tránsito</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.slice(0, MAX_FILAS).map((p) => {
                const porLocal = locales.map((l) => disponible(p.id, l.id))
                const transitoP = enTransito[p.id] ?? 0
                const total = porLocal.reduce((a, b) => a + b, 0) + transitoP
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-gray-800">{p.nombre}<span className="ml-1 text-xs text-gray-400">{p.marca}</span></td>
                    {porLocal.map((c, i) => (
                      <td key={locales[i].id} className={`px-3 py-2 text-right ${c <= 0 ? 'text-gray-300' : 'font-medium'}`}>{c}</td>
                    ))}
                    <td className="px-3 py-2 text-right text-amber-700">{transitoP || ''}</td>
                    <td className="px-3 py-2 text-right font-bold">{total}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => nuevaGuia(p)} className="mr-3 text-xs font-bold text-green-700 hover:underline">Trasladar</button>
                      <button type="button" onClick={() => abrirAjuste(p)} className="text-xs font-bold text-blue-600 hover:underline">Ajustar</button>
                    </td>
                  </tr>
                )
              })}
              {!filtrados.length && (
                <tr><td colSpan={locales.length + 4} className="px-3 py-6 text-center text-gray-400">Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtrados.length > MAX_FILAS && (
          <p className="mt-2 text-xs text-gray-400">Mostrando {MAX_FILAS} de {filtrados.length}. Usa el buscador para acotar.</p>
        )}
        <p className="mt-3 text-[11px] text-gray-400">
          El stock que ve el cajero al vender es el de la Tienda. Una guía descuenta del origen al crearla y suma al destino cuando se confirma la recepción.
        </p>
      </div>
    </div>
  )
}
