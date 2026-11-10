// src/SelectorImagen.jsx  (POS de Valkat)
// Elegir/tomar una foto del producto, con vista previa, y subirla comprimida a Supabase Storage.
import { useEffect, useState } from 'react'

const BUCKET = 'productos'

// Reduce a máx. 900 px y JPEG 82 %: ~60-150 KB, carga rápido en el celular durante el live.
async function comprimirImagen(file, max = 900) {
  const bmp = await createImageBitmap(file)
  const escala = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * escala)
  const h = Math.round(bmp.height * escala)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // fondo blanco para PNG con transparencia
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  return new Promise((ok, fallo) =>
    canvas.toBlob((b) => (b ? ok(b) : fallo(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.82)
  )
}

// Devuelve { url } o { error }
export async function subirImagen(supabase, productoId, archivo) {
  try {
    const blob = await comprimirImagen(archivo)
    const ruta = `${productoId}.jpg`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' })
    if (error) return { error }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
    return { url: `${data.publicUrl}?v=${Date.now()}` } // ?v= evita ver la foto vieja en caché
  } catch (e) {
    return { error: e }
  }
}

export default function SelectorImagen({ urlActual, onArchivo }) {
  const [preview, setPreview] = useState(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const elegir = (e) => {
    const f = e.target.files?.[0]
    if (!f || !f.type.startsWith('image/')) return
    setPreview(URL.createObjectURL(f))
    onArchivo(f)
  }

  const mostrada = preview || urlActual

  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1">Foto del producto</label>
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-gray-50 flex items-center justify-center text-xs text-gray-400">
          {mostrada
            ? <img src={mostrada} alt="Vista previa" className="h-full w-full object-cover" />
            : 'Sin foto'}
        </div>
        <label className="cursor-pointer rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900">
          {mostrada ? 'Cambiar foto' : 'Elegir o tomar foto'}
          <input type="file" accept="image/*" onChange={elegir} className="hidden" />
        </label>
      </div>
    </div>
  )
}
