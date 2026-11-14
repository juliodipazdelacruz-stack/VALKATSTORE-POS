// src/GestorListas.jsx  (POS de Valkat)
// Ventana para agregar, renombrar y eliminar categorías y marcas.
// Renombrar también actualiza los productos que usaban ese nombre.
import { useEffect, useState } from 'react'

const CONFIG = {
  categorias: { tabla: 'categorias', columna: 'tipo',  titulo: 'Categorías', singular: 'categoría' },
  marcas:     { tabla: 'marcas',     columna: 'marca', titulo: 'Marcas',     singular: 'marca' },
}

export default function GestorListas({ supabase, onCerrar, onCambio }) {
  const [pestana, setPestana] = useState('categorias')
  const [items, setItems] = useState([])
  const [nuevo, setNuevo] = useState('')
  const [editando, setEditando] = useState(null) // { id, original, texto }
  const [mensaje, setMensaje] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const cfg = CONFIG[pestana]

  const cargar = async () => {
    const { data } = await supabase.from(cfg.tabla).select('id, nombre').order('nombre')
    setItems(data ?? [])
  }

  useEffect(() => { setEditando(null); setNuevo(''); setMensaje(null); cargar() }, [pestana]) // eslint-disable-line

  const fallo = (error, accion) =>
    setMensaje(error.code === '23505'
      ? `Ya existe una ${cfg.singular} con ese nombre.`
      : `No se pudo ${accion}: ${error.message}`)

  const agregar = async (e) => {
    e.preventDefault()
    const nombre = nuevo.trim()
    if (!nombre) return
    setOcupado(true); setMensaje(null)
    const { error } = await supabase.from(cfg.tabla).insert({ nombre })
    setOcupado(false)
    if (error) return fallo(error, 'agregar')
    setNuevo('')
    await cargar(); onCambio()
  }

  const guardarNombre = async () => {
    const texto = editando.texto.trim()
    if (!texto || texto === editando.original) return setEditando(null)
    setOcupado(true); setMensaje(null)

    const { error } = await supabase.from(cfg.tabla).update({ nombre: texto }).eq('id', editando.id)
    if (error) { setOcupado(false); return fallo(error, 'renombrar') }

    // Los productos guardan el nombre como texto: se actualizan al mismo valor
    const { error: errProd } = await supabase.from('productos')
      .update({ [cfg.columna]: texto }).eq(cfg.columna, editando.original)
    if (errProd) {
      // revertir el cambio de la lista para no dejar datos inconsistentes
      await supabase.from(cfg.tabla).update({ nombre: editando.original }).eq('id', editando.id)
      setOcupado(false)
      return setMensaje('No se pudieron actualizar los productos: ' + errProd.message)
    }
    setOcupado(false); setEditando(null)
    await cargar(); onCambio()
  }

  const eliminar = async (item) => {
    setOcupado(true); setMensaje(null)
    const { count } = await supabase.from('productos')
      .select('id', { count: 'exact', head: true }).eq(cfg.columna, item.nombre)
    if (count > 0) {
      setOcupado(false)
      return setMensaje(`No se puede eliminar "${item.nombre}": la usan ${count} producto${count === 1 ? '' : 's'}. Cámbialos antes de eliminarla.`)
    }
    if (!window.confirm(`¿Eliminar la ${cfg.singular} "${item.nombre}"?`)) return setOcupado(false)
    const { error } = await supabase.from(cfg.tabla).delete().eq('id', item.id)
    setOcupado(false)
    if (error) return fallo(error, 'eliminar')
    await cargar(); onCambio()
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-green-200 bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">Gestionar listas</h3>
          <button type="button" onClick={onCerrar} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="mb-4 flex gap-2">
          {Object.entries(CONFIG).map(([clave, c]) => (
            <button key={clave} type="button" onClick={() => setPestana(clave)}
              className={`flex-1 rounded-xl py-2 text-sm font-bold ${pestana === clave ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {c.titulo}
            </button>
          ))}
        </div>

        <form onSubmit={agregar} className="mb-3 flex gap-2">
          <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder={`Nueva ${cfg.singular}…`}
            className="w-full rounded-xl border px-3 py-2 text-sm" />
          <button disabled={ocupado} className="shrink-0 rounded-xl bg-green-600 px-4 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60">
            Agregar
          </button>
        </form>

        {mensaje && <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{mensaje}</p>}

        <ul className="divide-y divide-gray-100 rounded-xl border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editando?.id === it.id ? (
                <>
                  <input autoFocus value={editando.texto}
                    onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') guardarNombre(); if (e.key === 'Escape') setEditando(null) }}
                    className="w-full rounded-lg border px-2 py-1" />
                  <button type="button" onClick={guardarNombre} disabled={ocupado} className="font-bold text-green-700">Guardar</button>
                  <button type="button" onClick={() => setEditando(null)} className="text-gray-400">✕</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-gray-800">{it.nombre}</span>
                  <button type="button" onClick={() => setEditando({ id: it.id, original: it.nombre, texto: it.nombre })}
                    className="text-xs font-bold text-blue-600 hover:underline">Renombrar</button>
                  <button type="button" onClick={() => eliminar(it)} disabled={ocupado}
                    className="text-xs font-bold text-red-600 hover:underline">Eliminar</button>
                </>
              )}
            </li>
          ))}
          {!items.length && <li className="px-3 py-4 text-center text-sm text-gray-400">Aún no hay elementos.</li>}
        </ul>

        <p className="mt-3 text-[11px] text-gray-400">
          Al renombrar, los productos que usaban el nombre anterior se actualizan solos.
          Solo se puede eliminar lo que ningún producto esté usando.
        </p>
      </div>
    </div>
  )
}
