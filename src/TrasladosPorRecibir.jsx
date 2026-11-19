// src/TrasladosPorRecibir.jsx  (POS de Valkat — vista del cajero)
// Muestra las guías de traslado en tránsito hacia el local del usuario y
// permite confirmar su recepción. La base de datos valida el permiso:
// solo un administrador o personal del local de destino puede confirmar.
import { useEffect, useState } from 'react'

const numeroGuia = (g) => `T-${String(g.numero ?? 0).padStart(4, '0')}`

export default function TrasladosPorRecibir({ supabase, userId, onCambio }) {
  const [guias, setGuias] = useState([])
  const [productos, setProductos] = useState({})
  const [locales, setLocales] = useState({})
  const [abierto, setAbierto] = useState(false)
  const [marcados, setMarcados] = useState({}) // `${guia}|${producto}` -> true
  const [mensaje, setMensaje] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = async () => {
    if (!userId) return
    const { data: yo } = await supabase.from('usuarios').select('local_id').eq('id', userId).maybeSingle()
    if (!yo?.local_id) return setGuias([])

    const { data: gs } = await supabase
      .from('traslados')
      .select('*, traslado_items(producto_id, cantidad)')
      .eq('estado', 'en_transito')
      .eq('destino_id', yo.local_id)
      .order('created_at', { ascending: false })
    const lista = gs ?? []
    setGuias(lista)
    if (!lista.length) return

    const ids = [...new Set(lista.flatMap((g) => (g.traslado_items ?? []).map((i) => i.producto_id)))]
    const [{ data: ps }, { data: ls }] = await Promise.all([
      supabase.from('productos').select('id, nombre').in('id', ids),
      supabase.from('locales').select('id, nombre'),
    ])
    setProductos(Object.fromEntries((ps ?? []).map((p) => [p.id, p.nombre])))
    setLocales(Object.fromEntries((ls ?? []).map((l) => [l.id, l.nombre])))
  }

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60000) // avisa de guías nuevas sin recargar la página
    return () => clearInterval(t)
  }, [userId]) // eslint-disable-line

  const todoMarcado = (g) => (g.traslado_items ?? []).every((i) => marcados[`${g.id}|${i.producto_id}`])

  const confirmar = async (g) => {
    setOcupado(true); setMensaje(null)
    const { error } = await supabase.rpc('recibir_traslado', { p_traslado: g.id })
    setOcupado(false)
    if (error) return setMensaje(error.message)
    await cargar(); onCambio?.()
  }

  return (
    <>
      <button type="button" onClick={() => { setMensaje(null); setAbierto(true); cargar() }}
        className={`relative rounded-lg px-4 py-2 text-sm font-medium transition ${
          guias.length ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
        📥 Por recibir
        {guias.length > 0 && (
          <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{guias.length}</span>
        )}
      </button>

      {abierto && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-green-200 bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">Traslados por recibir</h3>
              <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>

            {mensaje && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{mensaje}</p>}

            {guias.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-gray-400">
                No hay mercadería en camino hacia este local.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  Cuenta la mercadería y marca cada producto. Si algo no coincide, no confirmes y avisa al administrador.
                </p>
                <ul className="space-y-3">
                  {guias.map((g) => (
                    <li key={g.id} className="rounded-xl border border-gray-200 p-3">
                      <p className="text-sm font-bold text-gray-900">
                        {numeroGuia(g)} <span className="font-normal text-gray-600">desde {locales[g.origen_id] ?? '—'}</span>
                        <span className="ml-2 text-xs font-normal text-gray-400">{new Date(g.created_at).toLocaleDateString()}</span>
                      </p>
                      {g.nota && <p className="text-xs text-gray-500">Nota: {g.nota}</p>}
                      <ul className="my-2 divide-y divide-gray-100">
                        {(g.traslado_items ?? []).map((i) => {
                          const clave = `${g.id}|${i.producto_id}`
                          return (
                            <li key={i.producto_id}>
                              <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                                <input type="checkbox" checked={!!marcados[clave]}
                                  onChange={(e) => setMarcados({ ...marcados, [clave]: e.target.checked })}
                                  className="h-4 w-4 accent-green-600" />
                                <span className="flex-1 text-gray-800">{productos[i.producto_id] ?? 'Producto'}</span>
                                <b>{i.cantidad}</b>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                      <button type="button" disabled={ocupado || !todoMarcado(g)} onClick={() => confirmar(g)}
                        className="w-full rounded-xl bg-green-600 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40">
                        Confirmar recepción
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
