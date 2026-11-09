// src/SpecsEditor.jsx  (POS de Valkat)
// Editor dinámico Clave/Valor para la ficha técnica + helpers de Supabase.
import { useState } from 'react'

/* ---------- Plantillas: claves típicas por categoría (tipo) ---------- */
// "Marca" no aparece porque ya es una columna de productos.
const PLANTILLAS = {
  'Cámaras': ['App móvil', 'Resolución', 'Lente', 'Conectividad', 'Visión nocturna', 'Audio',
              'Alimentación', 'Memoria 32GB', 'Memoria 64GB', 'Memoria 128GB', 'Memoria 256GB'],
  'Cámara Foco': ['App móvil', 'Resolución', 'Rosca', 'Conectividad', 'Visión nocturna',
                  'Memoria 32GB', 'Memoria 64GB', 'Memoria 128GB'],
  'NVR / Grabadores': ['App móvil', 'Canales', 'Resolución máxima', 'Disco duro máximo', 'Salida de video'],
  'Almacenamiento': ['Capacidad', 'Clase / velocidad', 'Uso recomendado'],
  'Networking': ['Puertos', 'Velocidad', 'Alcance'],
  'Accesorios': ['Compatible con', 'Material'],
  'Soportes y Paneles': ['Compatible con', 'Material'],
}

let contador = 0
const fila = (clave = '', valor = '') => ({ id: ++contador, clave, valor })

const objetoAFilas = (obj) => {
  const filas = Object.entries(obj ?? {}).map(([k, v]) =>
    fila(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  )
  return filas.length ? filas : [fila()]
}

// Solo guarda filas con clave Y valor (las filas de plantilla sin llenar se ignoran)
const filasAObjeto = (filas) =>
  filas.reduce((obj, { clave, valor }) => {
    const k = clave.trim(), v = valor.trim()
    if (k && v) obj[k] = v
    return obj
  }, {})

/* ---------- Componente ----------
   inicial  : objeto JSONB actual (se lee al montar)
   tipo     : categoría seleccionada, para ofrecer la plantilla
   onChange : recibe el objeto listo para guardar en `especificaciones`   */
export default function SpecsEditor({ inicial, tipo, onChange }) {
  const [filas, setFilas] = useState(() => objetoAFilas(inicial))

  const actualizar = (nuevas) => { setFilas(nuevas); onChange(filasAObjeto(nuevas)) }
  const editar = (id, campo, texto) =>
    actualizar(filas.map((f) => (f.id === id ? { ...f, [campo]: texto } : f)))
  const quitar = (id) => {
    const resto = filas.filter((f) => f.id !== id)
    actualizar(resto.length ? resto : [fila()])
  }

  const cargarPlantilla = () => {
    const existentes = new Set(filas.map((f) => f.clave.trim().toLowerCase()))
    const nuevas = (PLANTILLAS[tipo] ?? [])
      .filter((k) => !existentes.has(k.toLowerCase()))
      .map((k) => fila(k, ''))
    const base = filas.filter((f) => f.clave.trim() || f.valor.trim())
    actualizar([...base, ...nuevas])
  }

  const input = 'w-full px-3 py-2 border rounded-xl text-sm'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-600">Ficha técnica</span>
        {PLANTILLAS[tipo] && (
          <button type="button" onClick={cargarPlantilla}
            className="text-xs font-bold text-green-700 hover:underline">
            Cargar plantilla de {tipo}
          </button>
        )}
      </div>

      {filas.map((f) => (
        <div key={f.id} className="flex gap-2">
          <input className={`${input} w-2/5`} placeholder="Ej. Memoria 64GB"
            value={f.clave} onChange={(e) => editar(f.id, 'clave', e.target.value)} />
          <input className={input} placeholder="Ej. 12 días de grabación"
            value={f.valor} onChange={(e) => editar(f.id, 'valor', e.target.value)} />
          <button type="button" onClick={() => quitar(f.id)} aria-label="Quitar detalle"
            className="px-2 text-gray-400 hover:text-red-600">✕</button>
        </div>
      ))}

      <button type="button" onClick={() => actualizar([...filas, fila()])}
        className="text-sm font-bold text-green-700 hover:underline">
        + Añadir detalle
      </button>
    </div>
  )
}

/* ---------- Helpers de Supabase ---------- */
export async function cargarFicha(supabase, productoId) {
  const { data } = await supabase
    .from('productos_ficha')
    .select('apodos, codigo_barras, especificaciones')
    .eq('producto_id', productoId)
    .maybeSingle()
  return data // null si el producto aún no tiene ficha
}

export async function guardarFicha(supabase, productoId, { apodos, codigo, specs }) {
  const apodosLimpios = apodos.split(',').map((a) => a.trim()).filter(Boolean).join(', ')
  return supabase.from('productos_ficha').upsert({
    producto_id: productoId,
    apodos: apodosLimpios,
    codigo_barras: codigo.trim() || null, // null evita choque con el índice único
    especificaciones: specs,
    updated_at: new Date().toISOString(),
  })
}
