// Edge Function: consulta de DNI / RUC con APIsPERU.
// El token vive como secreto del servidor (APISPERU_TOKEN) y nunca llega al navegador.
// Solo responde a usuarios autenticados (verify_jwt activo por defecto en Supabase).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, mensaje: 'Método no permitido.' }, 405)

  let tipo = ''
  let numero = ''
  try {
    const cuerpo = await req.json()
    tipo = String(cuerpo?.tipo ?? '')
    numero = String(cuerpo?.numero ?? '').trim()
  } catch {
    return json({ ok: false, mensaje: 'Solicitud inválida.' }, 400)
  }

  const valido =
    (tipo === 'dni' && /^\d{8}$/.test(numero)) ||
    (tipo === 'ruc' && /^\d{11}$/.test(numero))
  if (!valido) {
    return json({ ok: false, mensaje: 'Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos.' }, 400)
  }

  const token = Deno.env.get('APISPERU_TOKEN')
  if (!token) {
    console.error('Falta el secreto APISPERU_TOKEN')
    return json({ ok: false, mensaje: 'El servicio de consulta no está configurado.' }, 500)
  }

  let respuesta: Response
  try {
    respuesta = await fetch(
      `https://dniruc.apisperu.com/api/v1/${tipo}/${numero}?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10000) },
    )
  } catch {
    return json({ ok: false, mensaje: 'No se pudo conectar con el servicio de consulta.' }, 502)
  }

  const data = await respuesta.json().catch(() => null)

  if (respuesta.status >= 500 || respuesta.status === 401 || respuesta.status === 403 || respuesta.status === 429) {
    // No se registra la URL para no filtrar el token en los logs
    console.error('APIsPERU respondió con estado', respuesta.status)
    return json({ ok: false, mensaje: 'El servicio de consulta no está disponible por ahora.' })
  }

  if (!respuesta.ok || !data || data.success === false) {
    return json({ ok: false, mensaje: 'No se encontraron datos para ese documento.' })
  }

  // Normalización: si APIsPERU cambia o difiere un nombre de campo, se ajusta SOLO aquí.
  const nombre = (
    tipo === 'dni'
      ? [
          data.nombres,
          data.apellidoPaterno ?? data.apellido_paterno,
          data.apellidoMaterno ?? data.apellido_materno,
        ].filter(Boolean).join(' ')
      : (data.razonSocial ?? data.razon_social ?? data.nombre ?? '')
  ).toString().trim()

  if (!nombre) return json({ ok: false, mensaje: 'No se encontraron datos para ese documento.' })

  return json({
    ok: true,
    tipo,
    documento: numero,
    nombre,
    direccion: data.direccion ?? null,
  })
})
