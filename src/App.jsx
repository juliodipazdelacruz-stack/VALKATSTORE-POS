import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Cliente aparte y sin persistencia: sirve para validar contraseñas (admin / cajero)
// sin tocar la sesión activa del cajero.
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'valkat-auth-verificacion'
  }
})

const soles = (n) => 'S/ ' + Number(n || 0).toFixed(2)

// Las columnas "timestamp without time zone" guardan hora UTC sin zona; se interpretan como UTC
const fechaLocal = (f) => {
  if (!f) return null
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(f) ? f : f + 'Z')
}

const etiquetaPago = (v) => {
  if (v.medio_pago === 'Mixto' && v.monto_efectivo != null) {
    return `Mixto (Efec. ${soles(v.monto_efectivo)} + Yape ${soles(Number(v.total) - Number(v.monto_efectivo))})`
  }
  return v.medio_pago
}

// Totales por medio de pago, descuentos y ranking de productos de un turno
const resumirVentasTurno = (ventas) => {
  const r = { cantidad: ventas.length, total: 0, efectivo: 0, yape: 0, tarjeta: 0, mixtoSinDesglose: 0, descuento: 0, productos: [] }
  const porProducto = {}

  ventas.forEach(v => {
    const total = Number(v.total)
    const tieneEfectivo = v.monto_efectivo !== null && v.monto_efectivo !== undefined
    r.total += total

    if (v.medio_pago === 'Efectivo') {
      r.efectivo += tieneEfectivo ? Number(v.monto_efectivo) : total
    } else if (v.medio_pago === 'Yape / Plin') {
      r.yape += total
    } else if (v.medio_pago === 'Tarjeta POS') {
      r.tarjeta += total
    } else if (v.medio_pago === 'Mixto') {
      if (tieneEfectivo) {
        r.efectivo += Number(v.monto_efectivo)
        r.yape += total - Number(v.monto_efectivo)
      } else {
        r.mixtoSinDesglose += total
      }
    }

    const detalle = v.detalle_ventas || []
    const bruto = detalle.reduce((a, d) => a + Number(d.subtotal), 0)
    r.descuento += Math.max(0, bruto - total)

    detalle.forEach(d => {
      const nombre = d.productos?.nombre || 'Producto eliminado'
      const marca = d.productos?.marca || ''
      const clave = nombre + '|' + marca
      if (!porProducto[clave]) porProducto[clave] = { nombre, marca, cantidad: 0, importe: 0 }
      porProducto[clave].cantidad += Number(d.cantidad)
      porProducto[clave].importe += Number(d.subtotal)
    })
  })

  r.productos = Object.values(porProducto).sort((a, b) => b.cantidad - a.cantidad)
  return r
}

const RANGOS_REPORTE = [
  { id: 'hoy', etiqueta: 'Hoy', dias: 0 },
  { id: '7', etiqueta: 'Últimos 7 días', dias: 6 },
  { id: '30', etiqueta: 'Últimos 30 días', dias: 29 },
  { id: 'todo', etiqueta: 'Todo el historial', dias: null }
]

// Fecha de inicio del rango en el mismo formato de la BD (UTC sin zona)
const inicioRango = (dias) => {
  if (dias === null) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 19)
}

// Ranking de productos y categorías a partir de filas de detalle_ventas
const resumirTopProductos = (filas) => {
  const porProducto = {}
  const porCategoria = {}
  const idsVendidos = new Set()
  let totalUnidades = 0
  let totalImporte = 0

  filas.forEach(d => {
    if (d.productos?.id) idsVendidos.add(d.productos.id)
    const nombre = d.productos?.nombre || 'Producto eliminado'
    const marca = d.productos?.marca || ''
    const tipo = d.productos?.tipo || 'Sin categoría'
    const cantidad = Number(d.cantidad)
    const importe = Number(d.subtotal)
    const clave = nombre + '|' + marca

    if (!porProducto[clave]) porProducto[clave] = { nombre, marca, tipo, cantidad: 0, importe: 0 }
    porProducto[clave].cantidad += cantidad
    porProducto[clave].importe += importe

    if (!porCategoria[tipo]) porCategoria[tipo] = { tipo, cantidad: 0, importe: 0 }
    porCategoria[tipo].cantidad += cantidad
    porCategoria[tipo].importe += importe

    totalUnidades += cantidad
    totalImporte += importe
  })

  return {
    productos: Object.values(porProducto).sort((a, b) => b.cantidad - a.cantidad || b.importe - a.importe),
    categorias: Object.values(porCategoria).sort((a, b) => b.cantidad - a.cantidad),
    totalUnidades,
    totalImporte,
    idsVendidos
  }
}

const claseInputModal = 'w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'

// Efectivo que realmente entró a la caja física con estas ventas
const efectivoDeVentas = (filas) => (filas || []).reduce((acc, v) => acc + (
  v.monto_efectivo != null
    ? Number(v.monto_efectivo)
    : (v.medio_pago === 'Efectivo' ? Number(v.total) : 0)
), 0)

// Efectivo disponible en un turno: sencillo + ventas en efectivo - retiros.
// "cliente" permite consultar con la sesión del admin (supabaseAuth) o la actual (supabase).
const calcularCajaTurno = async (cliente, turno) => {
  const [ventasRes, retirosRes] = await Promise.all([
    cliente.from('ventas').select('total, medio_pago, monto_efectivo').eq('caja_turno_id', turno.id),
    cliente.from('retiros_caja').select('monto').eq('caja_turno_id', turno.id)
  ])
  if (ventasRes.error) throw ventasRes.error
  if (retirosRes.error) throw retirosRes.error
  const ventasEfectivo = efectivoDeVentas(ventasRes.data)
  const retiros = (retirosRes.data || []).reduce((acc, r) => acc + Number(r.monto), 0)
  return { ventasEfectivo, retiros, disponible: Number(turno.monto_apertura) + ventasEfectivo - retiros }
}

function App() {
  const [session, setSession] = useState(null)
  const [rol, setRol] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [cargandoSesion, setCargandoSesion] = useState(true)

  const [vistaAdmin, setVistaAdmin] = useState('dashboard')
  const [listaUsuarios, setListaUsuarios] = useState([])
  const [listaProductosAdmin, setListaProductosAdmin] = useState([])
  const [listaTurnosAdmin, setListaTurnosAdmin] = useState([])
  const [rangoReporte, setRangoReporte] = useState('7')
  const [filasReporte, setFilasReporte] = useState([])
  const [cargandoReporte, setCargandoReporte] = useState(false)
  const tokenReporte = useRef(0)
  const [turnoDetalle, setTurnoDetalle] = useState(null)
  const [ventasTurnoDetalle, setVentasTurnoDetalle] = useState([])
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [retirosTurnoDetalle, setRetirosTurnoDetalle] = useState([])

  // Retiros de caja
  const [mostrarModalRetiro, setMostrarModalRetiro] = useState(false) // retiro desde la caja del cajero
  const [retiroEmailAdmin, setRetiroEmailAdmin] = useState('')
  const [retiroPasswordAdmin, setRetiroPasswordAdmin] = useState('')
  const [retiroMonto, setRetiroMonto] = useState('')
  const [retiroMotivo, setRetiroMotivo] = useState('')
  const [turnoRetiro, setTurnoRetiro] = useState(null) // retiro desde el panel del admin
  const [retiroDisponible, setRetiroDisponible] = useState(null)

  const [debeCambiarPassword, setDebeCambiarPassword] = useState(false)
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')

  const [mostrarFormNuevo, setMostrarFormNuevo] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoPasswordCrear, setNuevoPasswordCrear] = useState('')
  const [nuevoRol, setNuevoRol] = useState('cajero')

  // Estados de Caja y Ventas (Cajero)
  const [turnoAbierto, setTurnoAbierto] = useState(null)
  const [montoApertura, setMontoApertura] = useState('')
  const [verificandoTurno, setVerificandoTurno] = useState(true)
  const [productos, setProductos] = useState([])
  const [carrito, setCarrito] = useState([])
  const [descuentoMonto, setDescuentoMonto] = useState('')

  // Estados para Modal de Cobro y Medios de Pago
  const [mostrarModalCobro, setMostrarModalCobro] = useState(false)
  const [metodoPago, setMetodoPago] = useState('Efectivo')
  const [montoEfectivoMixto, setMontoEfectivoMixto] = useState('')
  const [montoYapeMixto, setMontoYapeMixto] = useState('')

  // Búsqueda y Filtros
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAdmin, setBusquedaAdmin] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('Todos')

  // Estados para Modal de Crear / Editar Producto (Admin)
  const [mostrarModalProductoAdmin, setMostrarModalProductoAdmin] = useState(false)
  const [modoEdicion, setModoEdicion] = useState(false)
  const [prodIdEditando, setProdIdEditando] = useState(null)
  const [prodNombre, setProdNombre] = useState('')
  const [prodMarca, setProdMarca] = useState('Valkat')
  const [prodTipo, setProdTipo] = useState('Cámaras')
  const [prodPrecio, setProdPrecio] = useState('')
  const [prodStock, setProdStock] = useState('')

  // Estados para Cierre y Cuadre de Caja
  const [mostrarModalCierre, setMostrarModalCierre] = useState(false)
  const [efectivoRealCaja, setEfectivoRealCaja] = useState('')
  const [passwordCierre, setPasswordCierre] = useState('')

  // Modales de Descuento
  const [mostrarModalDescuento, setMostrarModalDescuento] = useState(false)
  const [emailAdminDesc, setEmailAdminDesc] = useState('')
  const [passwordAdminDesc, setPasswordAdminDesc] = useState('')

  // Clientes en la venta
  const [clientes, setClientes] = useState([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [mostrarListaClientes, setMostrarListaClientes] = useState(false)
  const [mostrarModalCliente, setMostrarModalCliente] = useState(false)
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteDocumento, setClienteDocumento] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [consultandoDocumento, setConsultandoDocumento] = useState(false)
  const [datosConsultados, setDatosConsultados] = useState(false)

  // Notificaciones y resumen de cierre
  const [toast, setToast] = useState(null)
  const [resumenCierre, setResumenCierre] = useState(null)

  // Cierra el toast solo a los 4.5 segundos
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  // Reemplazo de alert(): el tipo se deduce del texto si no se indica
  const notificar = (mensaje, tipo) => {
    const t = tipo || (/éxito|autorizado/i.test(mensaje) ? 'exito' : /error|incorrect/i.test(mensaje) ? 'error' : 'aviso')
    setToast({ mensaje, tipo: t, id: Date.now() })
  }

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return
      setSession(session)
      if (session) {
        obtenerRolUsuario(session.user.id)
        verificarTurnoActivo(session.user.id)
      } else {
        setCargandoSesion(false)
        setVerificandoTurno(false)
      }
    }).catch(() => {
      if (isMounted) {
        setCargandoSesion(false)
        setVerificandoTurno(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return
      setSession(session)
      if (session) {
        obtenerRolUsuario(session.user.id)
        verificarTurnoActivo(session.user.id)
      } else {
        setCargandoSesion(false)
        setVerificandoTurno(false)
        setTurnoAbierto(null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const obtenerRolUsuario = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('rol, debe_cambiar_password')
        .eq('id', userId)
        .maybeSingle()
      
      if (error || !data) {
        setRol('cajero')
        setDebeCambiarPassword(false)
      } else {
        setRol(data.rol || 'cajero')
        setDebeCambiarPassword(data.debe_cambiar_password || false)
      }
    } catch (e) {
      setRol('cajero')
    } finally {
      setCargandoSesion(false)
    }
  }

  const verificarTurnoActivo = async (userId) => {
    try {
      const { data } = await supabase
        .from('caja_turnos')
        .select('*')
        .eq('usuario_id', userId)
        .eq('estado', 'Abierta')
        .maybeSingle()

      if (data) {
        setTurnoAbierto(data)
        cargarProductos()
        cargarClientes()
      }
    } catch (e) {
      console.log('Error verificando turno activo')
    } finally {
      setVerificandoTurno(false)
    }
  }

  const cargarProductos = async () => {
    const { data } = await supabase.from('productos').select('*').order('nombre')
    if (data) {
      setProductos(data)
      setListaProductosAdmin(data)
    }
  }

  const cargarClientes = async () => {
    const { data } = await supabase.from('clientes').select('*').order('nombre')
    if (data) setClientes(data)
  }

  const cargarTurnosAdmin = async () => {
    // Consulta usando la columna correcta de tu base de datos: fecha_apertura
    const { data, error } = await supabase
      .from('caja_turnos')
      .select(`
        *,
        usuarios (nombre_completo, email)
      `)
      .order('fecha_apertura', { ascending: false })

    if (error || !data || data.length === 0) {
      // Plan B por si la relación de tablas falla temporalmente
      const { data: turnosSimples, error: errSimple } = await supabase
        .from('caja_turnos')
        .select('*')
        .order('fecha_apertura', { ascending: false })
      
      if (!errSimple && turnosSimples) {
        setListaTurnosAdmin(turnosSimples)
      } else {
        setListaTurnosAdmin([])
      }
    } else {
      setListaTurnosAdmin(data)
    }
  }

  const cargarReporteVentas = async (rangoId) => {
    const rango = RANGOS_REPORTE.find(r => r.id === rangoId) || RANGOS_REPORTE[1]
    const desde = inicioRango(rango.dias)
    const token = ++tokenReporte.current
    setCargandoReporte(true)

    const filas = []
    const tamPagina = 1000
    for (let pagina = 0; pagina < 50; pagina++) {
      let consulta = supabase
        .from('detalle_ventas')
        .select('cantidad, subtotal, productos (id, nombre, marca, tipo), ventas!inner (fecha_venta)')
        .order('id')
        .range(pagina * tamPagina, (pagina + 1) * tamPagina - 1)
      if (desde) consulta = consulta.gte('ventas.fecha_venta', desde)

      const { data, error } = await consulta
      if (token !== tokenReporte.current) return // llegó una consulta más nueva
      if (error) {
        notificar('Error al cargar el reporte de ventas: ' + error.message, 'error')
        break
      }
      filas.push(...(data || []))
      if (!data || data.length < tamPagina) break
    }

    if (token !== tokenReporte.current) return
    setFilasReporte(filas)
    setCargandoReporte(false)
  }

  const cambiarRangoReporte = (id) => {
    setRangoReporte(id)
    cargarReporteVentas(id)
  }

  const cerrarModalesRetiro = () => {
    setMostrarModalRetiro(false)
    setTurnoRetiro(null)
    setRetiroDisponible(null)
    setRetiroEmailAdmin('')
    setRetiroPasswordAdmin('')
    setRetiroMonto('')
    setRetiroMotivo('')
  }

  // Desde la caja del cajero: el admin se autentica y el retiro se registra con SU sesión
  const registrarRetiroCajero = async (e) => {
    e.preventDefault()
    const monto = parseFloat(retiroMonto)
    const motivo = retiroMotivo.trim()
    if (!(monto > 0)) return notificar('Ingresa un monto válido mayor a 0.', 'aviso')
    if (!motivo) return notificar('Indica el motivo del retiro.', 'aviso')

    setCargando(true)
    try {
      const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
        email: retiroEmailAdmin,
        password: retiroPasswordAdmin
      })
      if (authError) {
        notificar('Credenciales de administrador incorrectas.', 'error')
        return
      }

      const { data: userData } = await supabaseAuth
        .from('usuarios')
        .select('rol')
        .eq('id', authData.user.id)
        .maybeSingle()
      if (!userData || userData.rol !== 'admin') {
        notificar('Este usuario no tiene rango de Administrador.', 'aviso')
        return
      }

      const caja = await calcularCajaTurno(supabaseAuth, turnoAbierto)
      if (monto > caja.disponible + 0.001) {
        notificar(`El retiro supera el efectivo disponible en caja (${soles(caja.disponible)}).`, 'aviso')
        return
      }

      const { error } = await supabaseAuth.from('retiros_caja').insert([{
        caja_turno_id: turnoAbierto.id,
        monto,
        motivo,
        autorizado_por: authData.user.id
      }])
      if (error) throw error

      cerrarModalesRetiro()
      notificar(`Retiro de ${soles(monto)} registrado. Quedan ${soles(caja.disponible - monto)} en caja.`, 'exito')
    } catch (err) {
      notificar('Error al registrar el retiro: ' + err.message, 'error')
    } finally {
      await supabaseAuth.auth.signOut()
      setCargando(false)
    }
  }

  // Desde el panel del admin, sobre un turno abierto
  const abrirRetiroAdmin = async (turno) => {
    setTurnoRetiro(turno)
    setRetiroDisponible(null)
    setRetiroMonto('')
    setRetiroMotivo('')
    try {
      const caja = await calcularCajaTurno(supabase, turno)
      setRetiroDisponible(caja.disponible)
    } catch (err) {
      notificar('No se pudo calcular el efectivo de la caja: ' + err.message, 'error')
      setTurnoRetiro(null)
    }
  }

  const registrarRetiroAdmin = async (e) => {
    e.preventDefault()
    const monto = parseFloat(retiroMonto)
    const motivo = retiroMotivo.trim()
    if (!(monto > 0)) return notificar('Ingresa un monto válido mayor a 0.', 'aviso')
    if (!motivo) return notificar('Indica el motivo del retiro.', 'aviso')

    setCargando(true)
    try {
      // El turno pudo cerrarse mientras tenías el modal abierto
      const { data: turnoActual } = await supabase
        .from('caja_turnos').select('estado').eq('id', turnoRetiro.id).maybeSingle()
      if (!turnoActual || turnoActual.estado !== 'Abierta') {
        notificar('Este turno ya fue cerrado; no se pueden registrar más retiros.', 'aviso')
        cerrarModalesRetiro()
        cargarTurnosAdmin()
        return
      }

      const caja = await calcularCajaTurno(supabase, turnoRetiro)
      if (monto > caja.disponible + 0.001) {
        setRetiroDisponible(caja.disponible)
        notificar(`El retiro supera el efectivo disponible en caja (${soles(caja.disponible)}).`, 'aviso')
        return
      }

      const { error } = await supabase.from('retiros_caja').insert([{
        caja_turno_id: turnoRetiro.id,
        monto,
        motivo,
        autorizado_por: session.user.id
      }])
      if (error) throw error

      const turnoId = turnoRetiro.id
      cerrarModalesRetiro()
      notificar(`Retiro de ${soles(monto)} registrado. Quedan ${soles(caja.disponible - monto)} en caja.`, 'exito')
      cargarTurnosAdmin()
      if (turnoDetalle && turnoDetalle.id === turnoId) verDetalleTurno(turnoDetalle)
    } catch (err) {
      notificar('Error al registrar el retiro: ' + err.message, 'error')
    } finally {
      setCargando(false)
    }
  }

  const verDetalleTurno = async (turno) => {
    setTurnoDetalle(turno)
    setVentasTurnoDetalle([])
    setRetirosTurnoDetalle([])
    setCargandoDetalle(true)

    const { data, error } = await supabase
      .from('ventas')
      .select(`
        id, total, medio_pago, monto_efectivo, fecha_venta,
        clientes (nombre, documento),
        detalle_ventas (cantidad, precio_unitario, subtotal, productos (nombre, marca))
      `)
      .eq('caja_turno_id', turno.id)
      .order('fecha_venta', { ascending: true })

    if (error) {
      notificar('Error al cargar el detalle del turno: ' + error.message, 'error')
    } else {
      setVentasTurnoDetalle(data || [])
    }

    const { data: retiros, error: retirosError } = await supabase
      .from('retiros_caja')
      .select('id, monto, motivo, created_at, usuarios (nombre_completo)')
      .eq('caja_turno_id', turno.id)
      .order('created_at', { ascending: true })
    if (retirosError) {
      notificar('Error al cargar los retiros del turno: ' + retirosError.message, 'error')
    } else {
      setRetirosTurnoDetalle(retiros || [])
    }
    setCargandoDetalle(false)
  }

  const manejarLogin = async (e) => {
    e.preventDefault()
    setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) notificar('Credenciales incorrectas: ' + error.message)
    setCargando(false)
  }

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    setRol(null)
    setDebeCambiarPassword(false)
    setTurnoAbierto(null)
    setVistaAdmin('dashboard')
  }

  const manejarCambioPassword = async (e) => {
    e.preventDefault()
    if (nuevaPassword !== confirmarPassword) return notificar('Las contraseñas no coinciden.')
    if (nuevaPassword.length < 6) return notificar('La contraseña debe tener al menos 6 caracteres.')

    setCargando(true)
    const { error: errorAuth } = await supabase.auth.updateUser({ password: nuevaPassword })
    
    if (errorAuth) {
      notificar('Error al actualizar: ' + errorAuth.message)
      setCargando(false)
      return
    }

    const { error: errorDb } = await supabase.from('usuarios').update({ debe_cambiar_password: false }).eq('id', session.user.id)
    if (!errorDb) {
      setDebeCambiarPassword(false)
      notificar('¡Contraseña actualizada con éxito!')
    }
    setCargando(false)
  }

  const cargarUsuarios = async () => {
    const { data } = await supabase.from('usuarios').select('*').order('created_at', { ascending: false })
    if (data) setListaUsuarios(data)
  }

  const cambiarRolUsuario = async (id, rolActual) => {
    const nuevoRol = rolActual === 'admin' ? 'cajero' : 'admin'
    const { error } = await supabase.from('usuarios').update({ rol: nuevoRol }).eq('id', id)
    if (!error) cargarUsuarios()
  }

  const crearNuevoUsuario = async (e) => {
    e.preventDefault()
    if (nuevoPasswordCrear.length < 6) return notificar('La contraseña temporal debe tener al menos 6 caracteres.')
    setCargando(true)

    const supabaseSecundario = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: authData, error: authError } = await supabaseSecundario.auth.signUp({
      email: nuevoEmail,
      password: nuevoPasswordCrear,
    })

    if (authError) {
      notificar('Error creando cuenta: ' + authError.message)
      setCargando(false)
      return
    }

    if (authData.user) {
      const { error: dbError } = await supabase.from('usuarios').insert([{
        id: authData.user.id,
        nombre_completo: nuevoNombre,
        email: nuevoEmail,
        rol: nuevoRol,
        debe_cambiar_password: true
      }])

      if (dbError) {
        notificar('Error guardando los datos del empleado: ' + dbError.message)
      } else {
        notificar('Empleado creado con éxito. Ya puede iniciar sesión.')
        setMostrarFormNuevo(false)
        setNuevoNombre(''); setNuevoEmail(''); setNuevoPasswordCrear('')
        cargarUsuarios()
      }
    }
    setCargando(false)
  }

  const guardarProductoAdmin = async (e) => {
    e.preventDefault()
    setCargando(true)

    if (modoEdicion) {
      const { error } = await supabase
        .from('productos')
        .update({
          nombre: prodNombre,
          marca: prodMarca,
          tipo: prodTipo,
          precio: parseFloat(prodPrecio),
          stock: parseInt(prodStock)
        })
        .eq('id', prodIdEditando)

      if (error) {
        notificar('Error al actualizar producto: ' + error.message)
      } else {
        notificar('¡Producto actualizado con éxito!')
        setMostrarModalProductoAdmin(false)
        cargarProductos()
      }
    } else {
      const { error } = await supabase.from('productos').insert([{
        nombre: prodNombre,
        marca: prodMarca,
        tipo: prodTipo,
        precio: parseFloat(prodPrecio),
        stock: parseInt(prodStock)
      }])

      if (error) {
        notificar('Error al registrar producto: ' + error.message)
      } else {
        notificar('¡Producto agregado al inventario global con éxito!')
        setMostrarModalProductoAdmin(false)
        cargarProductos()
      }
    }

    setCargando(false)
  }

  const abrirModalCrear = () => {
    setModoEdicion(false)
    setProdIdEditando(null)
    setProdNombre('')
    setProdMarca('Valkat')
    setProdTipo('Cámaras')
    setProdPrecio('')
    setProdStock('')
    setMostrarModalProductoAdmin(true)
  }

  const abrirModalEditar = (prod) => {
    setModoEdicion(true)
    setProdIdEditando(prod.id)
    setProdNombre(prod.nombre)
    setProdMarca(prod.marca)
    setProdTipo(prod.tipo)
    setProdPrecio(prod.precio)
    setProdStock(prod.stock)
    setMostrarModalProductoAdmin(true)
  }

  const abrirCajaTurno = async (e) => {
    e.preventDefault()
    setCargando(true)

    const { data, error } = await supabase
      .from('caja_turnos')
      .insert([{
        monto_apertura: parseFloat(montoApertura),
        usuario_id: session.user.id,
        estado: 'Abierta'
      }])
      .select()
      .single()

    if (error) {
      notificar('Error al abrir la caja: ' + error.message)
    } else {
      setTurnoAbierto(data)
      cargarProductos()
        cargarClientes()
    }
    setCargando(false)
  }

  const agregarAlCarrito = (producto) => {
    const itemExistente = carrito.find(item => item.id === producto.id)
    if (itemExistente) {
      if (itemExistente.cantidad + 1 > producto.stock) {
        return notificar(`Stock insuficiente. Solo quedan ${producto.stock} unidades.`)
      }
      setCarrito(carrito.map(item => 
        item.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item
      ))
    } else {
      if (producto.stock < 1) {
        return notificar('Este producto no tiene stock disponible.')
      }
      setCarrito([...carrito, { ...producto, cantidad: 1 }])
    }
  }

  const cambiarCantidad = (id, delta) => {
    const productoActual = productos.find(p => p.id === id)
    setCarrito(carrito.map(item => {
      if (item.id === id) {
        const nuevaCantidad = item.cantidad + delta
        if (delta > 0 && productoActual && nuevaCantidad > productoActual.stock) {
          notificar(`Stock máximo alcanzado (${productoActual.stock} unids.)`)
          return item
        }
        return nuevaCantidad > 0 ? { ...item, cantidad: nuevaCantidad } : null
      }
      return item
    }).filter(Boolean))
  }

  const calcularSubtotal = () => {
    return carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0)
  }

  const calcularTotalFinal = () => {
    const sub = calcularSubtotal()
    const desc = parseFloat(descuentoMonto) || 0
    const total = sub - desc
    return total > 0 ? total.toFixed(2) : '0.00'
  }

  const productosFiltrados = productos.filter(p => {
    const coincideBusqueda = p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
                             p.marca.toLowerCase().includes(busqueda.toLowerCase())
    const coincideTipo = filtroTipo === 'Todos' || p.tipo === filtroTipo
    return coincideBusqueda && coincideTipo
  })

  const clientesFiltrados = clientes.filter(c => {
    const q = busquedaCliente.toLowerCase().trim()
    if (!q) return true
    return c.nombre.toLowerCase().includes(q) || (c.documento || '').includes(q)
  }).slice(0, 6)

  const resumenReporte = resumirTopProductos(filasReporte)
  const productosSinRotacion = listaProductosAdmin
    .filter(p => Number(p.stock) > 0 && !resumenReporte.idsVendidos.has(p.id))
    .map(p => ({ ...p, valorStock: Number(p.stock) * Number(p.precio) }))
    .sort((a, b) => b.valorStock - a.valorStock)
  const valorSinRotacion = productosSinRotacion.reduce((acc, p) => acc + p.valorStock, 0)
  const etiquetaRangoReporte = (RANGOS_REPORTE.find(r => r.id === rangoReporte) || RANGOS_REPORTE[1]).etiqueta

  const cerrarModalCliente = () => {
    setMostrarModalCliente(false)
    setClienteNombre('')
    setClienteDocumento('')
    setClienteTelefono('')
    setDatosConsultados(false)
  }

  // Trae el nombre / razón social desde RENIEC o SUNAT (vía Edge Function con el token en el servidor)
  const consultarDocumento = async (docParam) => {
    const numero = String(docParam ?? clienteDocumento).trim()
    const tipo = /^\d{8}$/.test(numero) ? 'dni' : /^\d{11}$/.test(numero) ? 'ruc' : null
    if (!tipo) return notificar('Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos para consultar.', 'aviso')

    // Si ya está registrado no se gasta una consulta de la API
    const existente = clientes.find(c => c.documento === numero)
    if (existente) {
      setClienteSeleccionado(existente)
      setBusquedaCliente('')
      cerrarModalCliente()
      notificar(`${existente.nombre} ya estaba registrado y quedó seleccionado.`, 'exito')
      return
    }

    setConsultandoDocumento(true)
    try {
      const { data, error } = await supabase.functions.invoke('consulta-documento', { body: { tipo, numero } })
      if (error) throw error
      if (!data?.ok) {
        setDatosConsultados(false)
        notificar((data?.mensaje || 'No se encontraron datos.') + ' Puedes escribir el nombre manualmente.', 'aviso')
        return
      }
      setClienteNombre(data.nombre)
      setDatosConsultados(true)
    } catch (err) {
      setDatosConsultados(false)
      notificar('No se pudo consultar el documento. Puedes escribir el nombre manualmente.', 'error')
    } finally {
      setConsultandoDocumento(false)
    }
  }

  // Desde el buscador del carrito: abre el modal con el documento ya escrito y lo consulta
  const registrarDesdeBusqueda = (documento) => {
    setClienteDocumento(documento)
    setClienteNombre('')
    setDatosConsultados(false)
    setMostrarModalCliente(true)
    setMostrarListaClientes(false)
    consultarDocumento(documento)
  }

  const guardarCliente = async (e) => {
    e.preventDefault()
    const nombre = clienteNombre.trim()
    const documento = clienteDocumento.trim()
    if (!nombre) return notificar('Ingresa el nombre del cliente.', 'aviso')
    if (documento && clientes.some(c => c.documento === documento)) {
      return notificar('Ya existe un cliente con ese documento. Búscalo en la lista.', 'aviso')
    }

    setCargando(true)
    const { data, error } = await supabase
      .from('clientes')
      .insert([{
        nombre,
        documento: documento || null,
        telefono: clienteTelefono.trim() || null
      }])
      .select()
      .single()
    setCargando(false)

    if (error) return notificar('Error al registrar el cliente: ' + error.message, 'error')

    setClientes(prev => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setClienteSeleccionado(data)
    setBusquedaCliente('')
    cerrarModalCliente()
    notificar('Cliente registrado y asignado a la venta.', 'exito')
  }

  const productosAdminFiltrados = listaProductosAdmin.filter(p => {
    return p.nombre.toLowerCase().includes(busquedaAdmin.toLowerCase()) || 
           p.marca.toLowerCase().includes(busquedaAdmin.toLowerCase())
  })

  const procesarCobro = () => {
    const desc = parseFloat(descuentoMonto) || 0
    if (desc > 20.00) {
      setMostrarModalDescuento(true)
    } else {
      setMostrarModalCobro(true)
    }
  }

  // --- REGISTRO DE VENTA REAL (GUARDA EN BD Y RESTA STOCK) ---
  const finalizarVentaConPago = async () => {
    const totalPagar = parseFloat(calcularTotalFinal())

    if (metodoPago === 'Mixto') {
      const efec = parseFloat(montoEfectivoMixto) || 0
      const yape = parseFloat(montoYapeMixto) || 0
      if (Math.abs((efec + yape) - totalPagar) > 0.05) {
        return notificar(`La suma del efectivo (S/ ${efec.toFixed(2)}) y Yape/Plin (S/ ${yape.toFixed(2)}) debe ser igual al total a pagar (S/ ${totalPagar.toFixed(2)}).`)
      }
    }

    // Parte de la venta que entra físicamente a la caja
    const efectivoVenta = metodoPago === 'Efectivo'
      ? totalPagar
      : metodoPago === 'Mixto'
        ? Math.max(0, totalPagar - (parseFloat(montoYapeMixto) || 0))
        : 0

    setCargando(true)

    try {
      // 1. Insertar la venta principal
      const { data: ventaData, error: ventaError } = await supabase
        .from('ventas')
        .insert([{
          caja_turno_id: turnoAbierto.id,
          usuario_id: session.user.id,
          cliente_id: clienteSeleccionado?.id || null,
          total: totalPagar,
          monto_efectivo: efectivoVenta,
          medio_pago: metodoPago
        }])
        .select()
        .single()

      if (ventaError) throw ventaError

      // 2. Insertar cada detalle de venta y restar stock en la tabla productos
      for (const item of carrito) {
        const subtotalItem = item.precio * item.cantidad

        const { error: detalleError } = await supabase
          .from('detalle_ventas')
          .insert([{
            venta_id: ventaData.id,
            producto_id: item.id,
            cantidad: item.cantidad,
            precio_unitario: item.precio,
            subtotal: subtotalItem
          }])

        if (detalleError) throw detalleError

        // Actualizar el stock restando la cantidad vendida
        const nuevoStock = item.stock - item.cantidad
        const { error: stockError } = await supabase
          .from('productos')
          .update({ stock: nuevoStock })
          .eq('id', item.id)

        if (stockError) throw stockError
      }

      notificar(
        `Venta de S/ ${totalPagar.toFixed(2)} cobrada (${metodoPago}) · ${clienteSeleccionado ? clienteSeleccionado.nombre : 'Consumidor final'}`,
        'exito'
      )
      setClienteSeleccionado(null)
      setBusquedaCliente('')
      setCarrito([])
      setDescuentoMonto('')
      setMostrarModalCobro(false)
      setMetodoPago('Efectivo')
      setMontoEfectivoMixto('')
      setMontoYapeMixto('')
      cargarProductos() // Recargar productos para ver el stock actualizado en pantalla
    } catch (error) {
      notificar('Error al registrar la venta: ' + error.message)
    } finally {
      setCargando(false)
    }
  }

  const autorizarDescuentoAlto = async (e) => {
    e.preventDefault()
    setCargando(true)

    try {
      // Se valida con el cliente auxiliar: la sesión del cajero no se reemplaza
      const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
        email: emailAdminDesc,
        password: passwordAdminDesc
      })

      if (authError) {
        notificar('Credenciales de administrador incorrectas.', 'error')
        return
      }

      const { data: userData } = await supabaseAuth
        .from('usuarios')
        .select('rol')
        .eq('id', authData.user.id)
        .maybeSingle()

      await supabaseAuth.auth.signOut()

      if (!userData || userData.rol !== 'admin') {
        notificar('Este usuario no tiene rango de Administrador.', 'aviso')
        return
      }

      notificar('¡Descuento autorizado por administrador!', 'exito')
      setMostrarModalDescuento(false)
      setEmailAdminDesc('')
      setPasswordAdminDesc('')
      setMostrarModalCobro(true)
    } catch (err) {
      notificar('No se pudo validar al administrador. Intenta de nuevo.', 'error')
    } finally {
      setCargando(false)
    }
  }

  // --- CIERRE DE CAJA CALCULANDO EL MONTO ESPERADO ---
  const confirmarCierreCaja = async (e) => {
    e.preventDefault()
    setCargando(true)

    const { error: authError } = await supabaseAuth.auth.signInWithPassword({
      email: session.user.email,
      password: passwordCierre
    })
    await supabaseAuth.auth.signOut()

    if (authError) {
      notificar('Contraseña incorrecta. No se puede cerrar la caja.')
      setCargando(false)
      return
    }

    try {
      // 1. Obtener todas las ventas hechas en este turno abierto
      const { data: ventasTurno, error: ventasError } = await supabase
        .from('ventas')
        .select('total, medio_pago, monto_efectivo')
        .eq('caja_turno_id', turnoAbierto.id)

      if (ventasError) throw ventasError

      // Retiros autorizados durante el turno (salieron de la caja física)
      const { data: retirosTurno, error: retirosError } = await supabase
        .from('retiros_caja')
        .select('monto')
        .eq('caja_turno_id', turnoAbierto.id)
      if (retirosError) throw retirosError
      const totalRetiros = (retirosTurno || []).reduce((acc, r) => acc + Number(r.monto), 0)

      // 2. Esperado en caja = sencillo inicial + ventas en efectivo - retiros
      const filasVentas = ventasTurno || []
      const totalVentas = filasVentas.reduce((acc, v) => acc + Number(v.total), 0)
      // Solo el efectivo entra al cuadre; Yape/Plin y POS no están en la caja física.
      // Ventas antiguas sin monto_efectivo: se cuentan solo si fueron 100% en efectivo.
      const ventasEfectivo = filasVentas.reduce((acc, v) => acc + (
        v.monto_efectivo != null
          ? Number(v.monto_efectivo)
          : (v.medio_pago === 'Efectivo' ? Number(v.total) : 0)
      ), 0)
      const ventasDigitales = totalVentas - ventasEfectivo
      const montoEsperado = Number(turnoAbierto.monto_apertura) + ventasEfectivo - totalRetiros
      const efectivoReal = parseFloat(efectivoRealCaja)
      const diferenciaCalculada = efectivoReal - montoEsperado

      // 3. Actualizar el turno de caja con los montos calculados
      const { error: dbError } = await supabase
        .from('caja_turnos')
        .update({ 
          estado: 'Cerrada', 
          monto_cierre_esperado: montoEsperado,
          monto_cierre_real: efectivoReal,
          diferencia: diferenciaCalculada,
          fecha_cierre: new Date() 
        })
        .eq('id', turnoAbierto.id)

      if (dbError) throw dbError

      // Resumen para el modal; el turno se limpia recién al pulsar "Finalizar"
      setResumenCierre({
        apertura: Number(turnoAbierto.monto_apertura),
        cantidadVentas: filasVentas.length,
        totalVentas,
        ventasEfectivo,
        ventasDigitales,
        retiros: totalRetiros,
        esperado: montoEsperado,
        real: efectivoReal,
        diferencia: diferenciaCalculada
      })

      setCarrito([])
      setClienteSeleccionado(null)
      setDescuentoMonto('')
      setEfectivoRealCaja('')
      setMostrarModalCierre(false)
      setPasswordCierre('')
    } catch (error) {
      notificar('Error al cerrar el turno: ' + error.message)
    } finally {
      setCargando(false)
    }
  }

  // --- CAPA GLOBAL: TOAST Y RESUMEN DE CIERRE ---
  const estilosToast = {
    exito: { barra: 'bg-green-500', icono: '✅', titulo: 'Listo' },
    error: { barra: 'bg-red-500', icono: '⛔', titulo: 'Ups, algo salió mal' },
    aviso: { barra: 'bg-yellow-400', icono: '⚠️', titulo: 'Atención' }
  }

  const capaGlobal = (
    <>
      {toast && (
        <div key={toast.id} className="fixed top-5 right-5 z-[60] w-[calc(100%-2.5rem)] max-w-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex">
            <div className={`w-1.5 ${estilosToast[toast.tipo].barra}`} />
            <div className="flex-1 p-4 flex items-start gap-3">
              <span className="text-xl leading-none">{estilosToast[toast.tipo].icono}</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800">{estilosToast[toast.tipo].titulo}</p>
                <p className="text-xs text-gray-600 mt-0.5 break-words">{toast.mensaje}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
          </div>
        </div>
      )}

      {resumenCierre && (() => {
        const dif = resumenCierre.diferencia
        const cuadra = Math.abs(dif) < 0.005
        const tono = cuadra
          ? { fondo: 'bg-green-50', borde: 'border-green-200', texto: 'text-green-700', icono: '🎉', titulo: '¡Caja cuadrada!', sub: 'Todo coincide al céntimo. Buen trabajo.' }
          : dif > 0
            ? { fondo: 'bg-blue-50', borde: 'border-blue-200', texto: 'text-blue-700', icono: '💰', titulo: 'Caja con sobrante', sub: 'Hay más efectivo del esperado. Revisa si faltó registrar algo.' }
            : { fondo: 'bg-red-50', borde: 'border-red-200', texto: 'text-red-700', icono: '🔎', titulo: 'Caja con faltante', sub: 'Hay menos efectivo del esperado. Revisa las ventas del turno.' }
        const fila = (label, valor, destacado) => (
          <div className={`flex justify-between items-center py-2 ${destacado ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
            <span className="text-sm">{label}</span>
            <span className="text-sm font-semibold">S/ {valor.toFixed(2)}</span>
          </div>
        )
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70]">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className={`${tono.fondo} ${tono.borde} border-b p-6 text-center`}>
                <div className="text-5xl mb-2">{tono.icono}</div>
                <h3 className={`text-xl font-extrabold ${tono.texto}`}>{tono.titulo}</h3>
                <p className="text-xs text-gray-600 mt-1">{tono.sub}</p>
              </div>
              <div className="p-6">
                <div className="divide-y divide-gray-100">
                  {fila('Sencillo inicial', resumenCierre.apertura)}
                  {fila('Ventas en efectivo', resumenCierre.ventasEfectivo)}
                  {resumenCierre.retiros > 0 && fila('Retiros de caja (-)', resumenCierre.retiros)}
                  {fila('Monto esperado', resumenCierre.esperado, true)}
                  {fila('Efectivo contado', resumenCierre.real, true)}
                </div>
                <p className="text-[11px] text-gray-400 mt-3 text-center">
                  {resumenCierre.cantidadVentas} ventas por S/ {resumenCierre.totalVentas.toFixed(2)} en total · S/ {resumenCierre.ventasDigitales.toFixed(2)} fueron Yape/Plin/POS y no entran al cuadre
                </p>
                <div className={`mt-4 rounded-xl ${tono.fondo} ${tono.borde} border p-4 flex justify-between items-center`}>
                  <span className="text-sm font-bold text-gray-700">Diferencia</span>
                  <span className={`text-lg font-extrabold ${tono.texto}`}>
                    {dif > 0 ? '+' : dif < 0 ? '-' : ''}S/ {Math.abs(dif).toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={() => { setResumenCierre(null); setTurnoAbierto(null) }}
                  className="w-full mt-5 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl text-sm shadow-md transition"
                >
                  Finalizar turno
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )

  if (cargandoSesion || verificandoTurno) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-100 font-medium">Cargando sistema Valkat Store...</div>
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        {capaGlobal}
        <img src="/logo.png" alt="Logo Valkat Store" className="w-40 mb-4 rounded-xl shadow-sm" />
        <h1 className="text-3xl font-bold text-blue-900 mb-8">Valkat Store - POS</h1>
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">Acceso al Sistema</h2>
          <form onSubmit={manejarLogin} className="flex flex-col gap-5">
            <input type="email" required placeholder="Correo electrónico" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            <input type="password" required placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            <button type="submit" disabled={cargando} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition text-sm">
              {cargando ? 'Ingresando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (debeCambiarPassword) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        {capaGlobal}
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md border border-yellow-300">
          <div className="flex justify-center mb-4"><span className="text-4xl">🔒</span></div>
          <h2 className="text-xl font-bold text-gray-800 mb-2 text-center">Seguridad Requerida</h2>
          <p className="text-sm text-gray-600 text-center mb-6">Por políticas de Valkat Store, debes crear una contraseña personal antes de entrar a la caja.</p>
          <form onSubmit={manejarCambioPassword} className="flex flex-col gap-4">
            <input type="password" required placeholder="Nueva contraseña" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm" />
            <input type="password" required placeholder="Confirma tu nueva contraseña" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm" />
            <button type="submit" disabled={cargando} className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-xl transition mt-2 text-sm">
              {cargando ? 'Actualizando...' : 'Guardar y Entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // --- VISTA DE ADMINISTRADOR ---
  if (rol === 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        {capaGlobal}
        <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="Logo" className="w-10 h-10 object-contain rounded" />
            <h1 className="text-2xl font-bold text-blue-900">Panel Administrativo - Valkat Store</h1>
          </div>
          <button onClick={cerrarSesion} className="bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-lg font-medium transition text-sm">Cerrar Sesión</button>
        </div>

        {/* DASHBOARD PRINCIPAL DE ADMIN */}
        {vistaAdmin === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div>
                <span className="text-2xl">💰</span>
                <h2 className="text-lg font-bold text-gray-700 mt-2">Cuadre y Resumen de Caja</h2>
                <p className="text-gray-500 mt-1 text-sm">Revisa los turnos, montos esperados y efectivo reportado.</p>
              </div>
              <button onClick={() => { setVistaAdmin('cuadre'); cargarTurnosAdmin(); }} className="mt-6 w-full bg-yellow-100 text-yellow-800 hover:bg-yellow-200 font-semibold py-2 rounded-lg transition text-sm">
                Ver Cuadres de Caja
              </button>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div>
                <span className="text-2xl">📊</span>
                <h2 className="text-lg font-bold text-gray-700 mt-2">Reportes y Analítica</h2>
                <p className="text-gray-500 mt-1 text-sm">Métricas de productos más vendidos y alertas de stock.</p>
              </div>
              <button onClick={() => { setVistaAdmin('reportes'); cargarProductos(); cargarReporteVentas(rangoReporte); }} className="mt-6 w-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-semibold py-2 rounded-lg transition text-sm">
                Ver Reportes
              </button>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div>
                <span className="text-2xl">📦</span>
                <h2 className="text-lg font-bold text-gray-700 mt-2">Inventario de Productos</h2>
                <p className="text-gray-500 mt-1 text-sm">Busca, edita precios o agrega cámaras y accesorios.</p>
              </div>
              <button onClick={() => { setVistaAdmin('productos'); cargarProductos(); }} className="mt-6 w-full bg-green-100 text-green-700 hover:bg-green-200 font-semibold py-2 rounded-lg transition text-sm">
                Gestionar Productos
              </button>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div>
                <span className="text-2xl">👥</span>
                <h2 className="text-lg font-bold text-gray-700 mt-2">Gestión de Usuarios</h2>
                <p className="text-gray-500 mt-1 text-sm">Administra cajeros, correos y permisos de acceso.</p>
              </div>
              <button onClick={() => { setVistaAdmin('usuarios'); cargarUsuarios(); }} className="mt-6 w-full bg-blue-100 text-blue-700 hover:bg-blue-200 font-semibold py-2 rounded-lg transition text-sm">
                Abrir Gestión de Usuarios
              </button>
            </div>
          </div>
        )}

        {/* VISTA DE CUADRE Y RESUMEN DE CAJAS */}
        {vistaAdmin === 'cuadre' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <div>
                <h2 className="text-xl font-bold text-gray-800">💼 Cuadre de Caja y Turnos de Empleados</h2>
                <p className="text-xs text-gray-500 mt-1">Historial completo con montos esperados, reales y diferencias.</p>
              </div>
              <button onClick={() => setVistaAdmin('dashboard')} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver</button>
            </div>

            <div className="overflow-x-auto max-h-[550px]">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-600 text-sm sticky top-0">
                  <tr>
                    <th className="p-4 font-semibold">Cajero</th>
                    <th className="p-4 font-semibold">Estado</th>
                    <th className="p-4 font-semibold">Apertura (S/)</th>
                    <th className="p-4 font-semibold">Esperado (S/)</th>
                    <th className="p-4 font-semibold">Real (S/)</th>
                    <th className="p-4 font-semibold">Diferencia</th>
                    <th className="p-4 font-semibold">Apertura / Cierre</th>
                    <th className="p-4 font-semibold">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {listaTurnosAdmin.map((turno) => (
                    <tr key={turno.id} className="hover:bg-gray-50 transition">
                      <td className="p-4 font-medium text-gray-800">
                        {turno.usuarios?.nombre_completo || 'Usuario'} 
                        <span className="block text-xs text-gray-400">{turno.usuarios?.email}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${turno.estado === 'Abierta' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {turno.estado.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-blue-700">S/ {turno.monto_apertura.toFixed(2)}</td>
                      <td className="p-4 font-semibold text-gray-700">
                        {turno.monto_cierre_esperado !== null ? `S/ ${Number(turno.monto_cierre_esperado).toFixed(2)}` : 'Calculando...'}
                      </td>
                      <td className="p-4 font-bold text-green-700">
                        {turno.monto_cierre_real !== null ? `S/ ${Number(turno.monto_cierre_real).toFixed(2)}` : 'En caja'}
                      </td>
                      <td className="p-4">
                        {turno.diferencia !== null ? (
                          <span className={`font-bold px-2 py-1 rounded text-xs ${Number(turno.diferencia) < 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            S/ {Number(turno.diferencia).toFixed(2)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-4 text-xs text-gray-500">
                        {fechaLocal(turno.fecha_apertura)?.toLocaleString('es-PE')}
                        <span className="block text-[10px] text-gray-400">
                          {turno.fecha_cierre ? `Cierre: ${fechaLocal(turno.fecha_cierre).toLocaleString('es-PE')}` : 'Turno en curso'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1.5 items-start">
                          <button onClick={() => verDetalleTurno(turno)} className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap">
                          🔍 Ver detalle
                        </button>
                          {turno.estado === 'Abierta' && (
                            <button onClick={() => abrirRetiroAdmin(turno)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap">
                              💸 Retirar efectivo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {listaTurnosAdmin.length === 0 && (
                    <tr><td colSpan="8" className="p-6 text-center text-gray-400">No hay turnos de caja registrados todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODAL RETIRO DE CAJA (ADMIN) */}
        {turnoRetiro && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[55]">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-indigo-200">
              <div className="flex justify-center mb-2"><span className="text-3xl">💸</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Retiro de Caja</h3>
              <p className="text-xs text-gray-500 text-center mb-4">Turno de {turnoRetiro.usuarios?.nombre_completo || 'cajero'}</p>

              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-center mb-4">
                <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">Efectivo disponible en caja</span>
                <p className="text-2xl font-extrabold text-indigo-900 mt-1">{retiroDisponible === null ? 'Calculando...' : soles(retiroDisponible)}</p>
                <span className="text-[10px] text-indigo-500">Sencillo inicial + ventas en efectivo - retiros anteriores</span>
              </div>

              <form onSubmit={registrarRetiroAdmin} autoComplete="off" className="flex flex-col gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-gray-600">Monto a retirar (S/)</label>
                    <button type="button" disabled={retiroDisponible === null} onClick={() => setRetiroMonto(Math.max(0, retiroDisponible).toFixed(2))} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Retirar todo</button>
                  </div>
                  <input type="number" step="0.01" min="0.01" required autoComplete="off" placeholder="0.00" value={retiroMonto} onChange={(e) => setRetiroMonto(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Motivo</label>
                  <input type="text" required autoComplete="off" placeholder="Ej: Depósito al banco, pago a proveedor" value={retiroMotivo} onChange={(e) => setRetiroMotivo(e.target.value)} className={claseInputModal} />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalesRetiro} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando || retiroDisponible === null} className="w-1/2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-sm shadow-md">
                    {cargando ? 'Guardando...' : 'Registrar retiro'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL DETALLE DE TURNO */}
        {turnoDetalle && (() => {
          const r = resumirVentasTurno(ventasTurnoDetalle)
          const cerrado = turnoDetalle.estado !== 'Abierta'
          const totalRetirosDetalle = retirosTurnoDetalle.reduce((acc, x) => acc + Number(x.monto), 0)
          const kpi = (titulo, valor, clase) => (
            <div className={`p-3 rounded-xl border ${clase}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{titulo}</span>
              <p className="text-lg font-extrabold mt-0.5">{valor}</p>
            </div>
          )
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b p-5 flex justify-between items-start z-10">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Detalle del turno · {turnoDetalle.usuarios?.nombre_completo || 'Cajero'}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {fechaLocal(turnoDetalle.fecha_apertura)?.toLocaleString('es-PE')}
                      {turnoDetalle.fecha_cierre ? ` → ${fechaLocal(turnoDetalle.fecha_cierre).toLocaleString('es-PE')}` : ' · Turno en curso'}
                    </p>
                  </div>
                  <button onClick={() => setTurnoDetalle(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
                </div>

                {cargandoDetalle ? (
                  <p className="p-10 text-center text-sm text-gray-400">Cargando ventas del turno...</p>
                ) : (
                  <div className="p-5 flex flex-col gap-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {kpi('Total vendido', soles(r.total), 'bg-green-50 border-green-100 text-green-800')}
                      {kpi('N° de ventas', r.cantidad, 'bg-gray-50 border-gray-200 text-gray-800')}
                      {kpi('Descuentos', soles(r.descuento), 'bg-red-50 border-red-100 text-red-700')}
                      {kpi('Efectivo', soles(r.efectivo), 'bg-yellow-50 border-yellow-100 text-yellow-800')}
                      {kpi('Yape / Plin', soles(r.yape), 'bg-purple-50 border-purple-100 text-purple-800')}
                      {kpi('Tarjeta POS', soles(r.tarjeta), 'bg-blue-50 border-blue-100 text-blue-800')}
                    </div>
                    {r.mixtoSinDesglose > 0 && (
                      <p className="text-xs text-gray-500 -mt-3">
                        Hay {soles(r.mixtoSinDesglose)} en pagos mixtos antiguos sin desglose de efectivo/Yape.
                      </p>
                    )}

                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div><span className="block text-[11px] text-gray-500">Sencillo inicial</span><b>{soles(turnoDetalle.monto_apertura)}</b></div>
                      <div><span className="block text-[11px] text-gray-500">Retiros</span><b className={totalRetirosDetalle > 0 ? 'text-indigo-700' : ''}>{totalRetirosDetalle > 0 ? '-' : ''}{soles(totalRetirosDetalle)}</b></div>
                      <div><span className="block text-[11px] text-gray-500">Esperado en caja</span><b>{cerrado ? soles(turnoDetalle.monto_cierre_esperado) : soles(Number(turnoDetalle.monto_apertura) + r.efectivo - totalRetirosDetalle) + ' (parcial)'}</b></div>
                      <div><span className="block text-[11px] text-gray-500">Efectivo contado</span><b>{cerrado ? soles(turnoDetalle.monto_cierre_real) : 'En caja'}</b></div>
                      <div>
                        <span className="block text-[11px] text-gray-500">Diferencia</span>
                        {cerrado && turnoDetalle.diferencia !== null ? (
                          <b className={Number(turnoDetalle.diferencia) < 0 ? 'text-red-600' : Number(turnoDetalle.diferencia) > 0 ? 'text-blue-600' : 'text-green-600'}>
                            {soles(turnoDetalle.diferencia)}
                          </b>
                        ) : <b>-</b>}
                      </div>
                    </div>

                    {(retirosTurnoDetalle.length > 0 || !cerrado) && (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="text-sm font-bold text-gray-700">💸 Retiros de caja</h4>
                          {!cerrado && (
                            <button onClick={() => abrirRetiroAdmin(turnoDetalle)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">
                              + Retirar efectivo
                            </button>
                          )}
                        </div>
                        <div className="border border-gray-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 text-gray-600 text-xs">
                              <tr><th className="p-3">Hora</th><th className="p-3">Motivo</th><th className="p-3">Autorizó</th><th className="p-3 text-right">Monto</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {retirosTurnoDetalle.map(x => (
                                <tr key={x.id}>
                                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{fechaLocal(x.created_at)?.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                  <td className="p-3 text-xs text-gray-800">{x.motivo}</td>
                                  <td className="p-3 text-xs text-gray-600">{x.usuarios?.nombre_completo || '-'}</td>
                                  <td className="p-3 text-right font-bold text-indigo-700 whitespace-nowrap">-{soles(x.monto)}</td>
                                </tr>
                              ))}
                              {retirosTurnoDetalle.length === 0 && (
                                <tr><td colSpan="4" className="p-4 text-center text-gray-400 text-xs">Este turno aún no tiene retiros.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-sm font-bold text-gray-700 mb-2">📦 Productos vendidos</h4>
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 text-gray-600 text-xs">
                            <tr><th className="p-3">Producto</th><th className="p-3 text-center">Cant.</th><th className="p-3 text-right">Importe</th></tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {r.productos.map(pr => (
                              <tr key={pr.nombre + pr.marca}>
                                <td className="p-3 text-gray-800">{pr.nombre}{pr.marca && <span className="text-xs text-gray-400"> · {pr.marca}</span>}</td>
                                <td className="p-3 text-center font-bold">{pr.cantidad}</td>
                                <td className="p-3 text-right font-semibold text-green-700">{soles(pr.importe)}</td>
                              </tr>
                            ))}
                            {r.productos.length === 0 && (
                              <tr><td colSpan="3" className="p-5 text-center text-gray-400 text-xs">Este turno no tiene ventas registradas.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-gray-700 mb-2">🧾 Ventas del turno</h4>
                      <div className="border border-gray-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 text-gray-600 text-xs">
                            <tr>
                              <th className="p-3">Hora</th><th className="p-3">Cliente</th><th className="p-3">Productos</th>
                              <th className="p-3">Medio de pago</th><th className="p-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {ventasTurnoDetalle.map(v => {
                              const bruto = (v.detalle_ventas || []).reduce((a, d) => a + Number(d.subtotal), 0)
                              const desc = Math.max(0, bruto - Number(v.total))
                              return (
                                <tr key={v.id} className="align-top">
                                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{fechaLocal(v.fecha_venta)?.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                                  <td className="p-3 text-xs">
                                    {v.clientes ? (<>{v.clientes.nombre}<span className="block text-gray-400">{v.clientes.documento || ''}</span></>) : <span className="text-gray-400">Consumidor final</span>}
                                  </td>
                                  <td className="p-3 text-xs text-gray-700">{(v.detalle_ventas || []).map(d => `${d.cantidad}× ${d.productos?.nombre || 'Producto'}`).join(', ')}</td>
                                  <td className="p-3 text-xs">{etiquetaPago(v)}</td>
                                  <td className="p-3 text-right font-bold text-green-700 whitespace-nowrap">
                                    {soles(v.total)}
                                    {desc > 0 && <span className="block text-[10px] font-semibold text-red-500">Desc. -{soles(desc)}</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* VISTA DE REPORTES Y ANALÍTICA */}
        {vistaAdmin === 'reportes' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center border-b pb-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-800">📈 Dashboard Gerencial - Valkat Store</h2>
                <p className="text-xs text-gray-500 mt-1">Análisis de rotación de productos y alertas operativas.</p>
              </div>
              <button onClick={() => setVistaAdmin('dashboard')} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver al Dashboard</button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="text-xs font-bold text-gray-500 mr-1">Período de ventas:</span>
              {RANGOS_REPORTE.map(r => (
                <button
                  key={r.id}
                  onClick={() => cambiarRangoReporte(r.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${rangoReporte === r.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {r.etiqueta}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Catálogo</span>
                <h3 className="text-2xl font-extrabold text-blue-900 mt-1">{listaProductosAdmin.length} productos</h3>
                <span className="text-xs text-blue-500 mt-1 block">Registrados en tienda (Ate)</span>
              </div>

              <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-yellow-600 uppercase tracking-wider">Stock Crítico (&lt; 5)</span>
                <h3 className="text-2xl font-extrabold text-yellow-900 mt-1">
                  {listaProductosAdmin.filter(p => p.stock < 5).length} productos
                </h3>
                <span className="text-xs text-yellow-600 mt-1 block">Requieren pedido de reposición</span>
              </div>

              <div className="bg-green-50 border border-green-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-green-600 uppercase tracking-wider">Categoría Destacada</span>
                <h3 className="text-xl font-extrabold text-green-900 mt-1">
                  {cargandoReporte ? 'Calculando...' : (resumenReporte.categorias[0]?.tipo || 'Sin ventas')}
                </h3>
                <span className="text-xs text-green-600 mt-1 block">
                  {resumenReporte.categorias[0]
                    ? `${resumenReporte.categorias[0].cantidad} unidades · ${soles(resumenReporte.categorias[0].importe)} (${etiquetaRangoReporte.toLowerCase()})`
                    : `Sin ventas en: ${etiquetaRangoReporte.toLowerCase()}`}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-gray-200 p-5 rounded-2xl bg-gray-50">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <span>🔥</span> Productos con Mayor Salida
                  <span className="text-[10px] font-normal text-gray-400">({etiquetaRangoReporte})</span>
                </h3>
                {cargandoReporte ? (
                  <p className="text-xs text-gray-400 text-center py-6">Calculando ventas...</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-3">
                      {resumenReporte.productos.slice(0, 5).map((prod, idx) => (
                        <div key={prod.nombre + prod.marca} className="bg-white p-3 rounded-xl border border-gray-100 shadow-xs">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">#{idx + 1}</span>
                              <div>
                                <h4 className="font-bold text-gray-800 text-xs">{prod.nombre}</h4>
                                <span className="text-[10px] text-gray-400">Marca: {prod.marca || '-'} | Tipo: {prod.tipo}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-extrabold text-blue-700 text-xs">{prod.cantidad} und.</span>
                              <span className="block text-[10px] text-gray-400">{soles(prod.importe)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full mt-2">
                            <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${(prod.cantidad / resumenReporte.productos[0].cantidad) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                      {resumenReporte.productos.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-6">Aún no hay ventas en este período.</p>
                      )}
                    </div>
                    {resumenReporte.productos.length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-4 pt-3 border-t border-gray-200">
                        Total del período: <b>{resumenReporte.totalUnidades}</b> unidades · <b>{soles(resumenReporte.totalImporte)}</b> en {resumenReporte.productos.length} productos distintos
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="border border-gray-200 p-5 rounded-2xl bg-gray-50">
                <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <span>⚠️</span> Alertas de Stock Bajo (Menos de 5 unidades)
                </h3>
                <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {listaProductosAdmin.filter(p => p.stock < 5).map(prod => (
                    <div key={prod.id} className="bg-white p-3 rounded-xl border border-red-100 flex justify-between items-center shadow-xs">
                      <div>
                        <h4 className="font-bold text-gray-800 text-xs">{prod.nombre}</h4>
                        <span className="text-[10px] text-gray-400">Categoría: {prod.tipo}</span>
                      </div>
                      <span className="px-2.5 py-1 bg-red-100 text-red-700 font-bold text-xs rounded-full">
                        {prod.stock} unids.
                      </span>
                    </div>
                  ))}
                  {listaProductosAdmin.filter(p => p.stock < 5).length === 0 && (
                    <div className="text-center py-10 text-gray-400 text-xs">
                      🎉 ¡Excelente! No hay productos con stock crítico en este momento.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border border-gray-200 p-5 rounded-2xl bg-gray-50 mt-6">
              <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                    <span>🧊</span> Productos sin Rotación
                    <span className="text-[10px] font-normal text-gray-400">({etiquetaRangoReporte})</span>
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-1">Tienen stock pero no se vendió ninguna unidad en el período.</p>
                </div>
                {!cargandoReporte && productosSinRotacion.length > 0 && (
                  <div className="text-right">
                    <span className="text-xs font-extrabold text-indigo-700">{productosSinRotacion.length} productos</span>
                    <span className="block text-[10px] text-gray-500">{soles(valorSinRotacion)} en stock (a precio de venta)</span>
                  </div>
                )}
              </div>

              {cargandoReporte ? (
                <p className="text-xs text-gray-400 text-center py-6">Calculando...</p>
              ) : productosSinRotacion.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  🎉 Todo el inventario con stock tuvo salida en este período.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-1">
                  {productosSinRotacion.map(prod => (
                    <div key={prod.id} className="bg-white p-3 rounded-xl border border-gray-100 flex justify-between items-center shadow-xs">
                      <div>
                        <h4 className="font-bold text-gray-800 text-xs">{prod.nombre}</h4>
                        <span className="text-[10px] text-gray-400">{prod.marca} | {prod.tipo}</span>
                      </div>
                      <div className="text-right">
                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-full">{prod.stock} unids.</span>
                        <span className="block text-[10px] text-gray-400 mt-1">{soles(prod.valorStock)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rangoReporte === 'hoy' && (
                <p className="text-[11px] text-gray-400 mt-3">Con "Hoy" casi todo aparece sin rotación; usa 30 días o más para decidir reposiciones o promociones.</p>
              )}
            </div>
          </div>
        )}

        {/* VISTA DE PRODUCTOS (SOLO ADMIN) */}
        {vistaAdmin === 'productos' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50">
              <h2 className="text-xl font-bold text-gray-800">Inventario Global</h2>

              <div className="w-full md:w-72">
                <input 
                  type="text" placeholder="🔍 Buscar producto a editar..." 
                  value={busquedaAdmin} onChange={(e) => setBusquedaAdmin(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                />
              </div>

              <div className="flex gap-4 w-full md:w-auto justify-end">
                <button onClick={abrirModalCrear} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition text-sm shadow-sm">
                  + Registrar Nuevo Producto
                </button>
                <button onClick={() => setVistaAdmin('dashboard')} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver</button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-600 text-sm sticky top-0">
                  <tr>
                    <th className="p-4 font-semibold">Nombre</th>
                    <th className="p-4 font-semibold">Marca</th>
                    <th className="p-4 font-semibold">Categoría</th>
                    <th className="p-4 font-semibold">Precio (S/)</th>
                    <th className="p-4 font-semibold">Stock</th>
                    <th className="p-4 font-semibold text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {productosAdminFiltrados.map((prod) => (
                    <tr key={prod.id} className="hover:bg-gray-50 transition">
                      <td className="p-4 font-medium text-gray-800">{prod.nombre}</td>
                      <td className="p-4 text-blue-600 font-semibold">{prod.marca}</td>
                      <td className="p-4 text-gray-500">{prod.tipo}</td>
                      <td className="p-4 font-bold text-green-700">S/ {prod.precio.toFixed(2)}</td>
                      <td className="p-4 text-gray-700">{prod.stock} unids.</td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => abrirModalEditar(prod)}
                          className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs transition"
                        >
                          ✏️ Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {productosAdminFiltrados.length === 0 && (
                    <tr><td colSpan="6" className="p-6 text-center text-gray-400">No se encontraron productos en la búsqueda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VISTA DE USUARIOS */}
        {vistaAdmin === 'usuarios' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-800">Lista de Empleados</h2>
              <div className="flex gap-4">
                <button onClick={() => setMostrarFormNuevo(!mostrarFormNuevo)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition text-sm">
                  {mostrarFormNuevo ? 'Cancelar' : '+ Nuevo Empleado'}
                </button>
                <button onClick={() => setVistaAdmin('dashboard')} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Volver</button>
              </div>
            </div>

            {mostrarFormNuevo && (
              <div className="p-6 bg-blue-50 border-b border-blue-100">
                <form onSubmit={crearNuevoUsuario} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Nombre Completo</label>
                    <input type="text" required value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="Ej. Ashly" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Correo Electrónico</label>
                    <input type="email" required value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="cajero@valkat.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Rol</label>
                    <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm">
                      <option value="cajero">Cajero</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-600 mb-1">Contraseña Temporal</label>
                    <input type="password" required value={nuevoPasswordCrear} onChange={(e) => setNuevoPasswordCrear(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="Min. 6 caracteres" />
                  </div>
                  <div className="md:col-span-3 flex justify-end">
                    <button type="submit" disabled={cargando} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition text-sm">
                      {cargando ? 'Guardando...' : 'Guardar Empleado'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-600 text-sm">
                  <tr>
                    <th className="p-4 font-semibold">Nombre Completo</th>
                    <th className="p-4 font-semibold">Correo</th>
                    <th className="p-4 font-semibold">Rango</th>
                    <th className="p-4 font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {listaUsuarios.map((usuario) => (
                    <tr key={usuario.id} className="hover:bg-gray-50 transition">
                      <td className="p-4 font-medium text-gray-800">{usuario.nombre_completo}</td>
                      <td className="p-4 text-gray-500">{usuario.email}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${usuario.rol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                          {usuario.rol.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4">
                        <button onClick={() => cambiarRolUsuario(usuario.id, usuario.rol)} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded transition">
                          Cambiar Rango
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODAL DE PRODUCTO */}
        {mostrarModalProductoAdmin && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg border border-green-200">
              <h3 className="text-lg font-bold text-gray-800 mb-1">
                {modoEdicion ? '✏️ Editar Producto Existente' : '➕ Registrar Nuevo Producto'}
              </h3>
              <form onSubmit={guardarProductoAdmin} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-600 mb-1">Nombre del Producto</label>
                  <input type="text" required placeholder="Ej. Cámara Domo 4K Hikvision" value={prodNombre} onChange={(e) => setProdNombre(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Marca</label>
                  <input type="text" required placeholder="Ej. Dahua, Imou" value={prodMarca} onChange={(e) => setProdMarca(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Categoría (Tipo)</label>
                  <select value={prodTipo} onChange={(e) => setProdTipo(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                    <option value="Cámaras">Cámaras</option>
                    <option value="NVR / Grabadores">NVR / Grabadores</option>
                    <option value="Almacenamiento">Almacenamiento</option>
                    <option value="Networking">Networking</option>
                    <option value="Accesorios">Accesorios</option>
                    <option value="Soportes y Paneles">Soportes y Paneles</option>
                    <option value="Cámara Foco">Cámara Foco</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Precio de Venta (S/)</label>
                  <input type="number" step="0.10" required placeholder="0.00" value={prodPrecio} onChange={(e) => setProdPrecio(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Stock Actual</label>
                  <input type="number" required placeholder="10" value={prodStock} onChange={(e) => setProdStock(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div className="md:col-span-2 flex gap-3 mt-4">
                  <button type="button" onClick={() => setMostrarModalProductoAdmin(false)} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl transition text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl transition text-sm shadow-md">Guardar</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- VISTA DE CAJERO ---
  if (rol === 'cajero') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        {capaGlobal}
        <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="Logo" className="w-10 h-10 object-contain rounded" />
            <h1 className="text-2xl font-bold text-green-700">Módulo de Caja - Valkat Store</h1>
          </div>
          <button onClick={cerrarSesion} className="bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-lg font-medium transition text-sm">Cerrar Sesión</button>
        </div>

        {!turnoAbierto ? (
          <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-lg border border-gray-200 mt-10">
            <h2 className="text-xl font-semibold text-gray-800 mb-2 text-center">Apertura de Turno de Caja</h2>
            <p className="text-xs text-gray-500 mb-6 text-center">Ingresa el monto de sencillo con el que inicias el día.</p>
            
            <form onSubmit={abrirCajaTurno} className="flex flex-col gap-4">
              <div>
                <label className="block text-gray-600 text-xs mb-1 font-bold">Monto Inicial (Sencillo)</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-gray-500 font-bold">S/</span>
                  <input 
                    type="number" step="0.10" required 
                    value={montoApertura} onChange={(e) => setMontoApertura(e.target.value)} 
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" 
                    placeholder="0.00" 
                  />
                </div>
              </div>
              <button type="submit" disabled={cargando} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-md text-sm">
                {cargando ? 'Abriendo caja...' : 'Abrir Caja y Empezar a Vender'}
              </button>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* CATÁLOGO, BUSCADOR Y FILTROS */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center border-b pb-4 mb-4">
                <div>
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full">Caja Abierta</span>
                  <p className="text-xs text-gray-500 mt-1">Sencillo inicial: <span className="font-bold text-gray-800">S/ {turnoAbierto.monto_apertura}</span></p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setMostrarModalRetiro(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition shadow-xs">
                    💸 Retiro de Caja
                  </button>
                  <button onClick={() => setMostrarModalCierre(true)} className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition shadow-xs">
                    🔒 Cerrar Caja / Cuadre
                  </button>
                </div>
              </div>

              {/* BARRA DE BÚSQUEDA Y FILTROS */}
              <div className="flex flex-col md:flex-row gap-3 mb-4">
                <input 
                  type="text" placeholder="🔍 Buscar por nombre de cámara o marca..." 
                  value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"
                />
                <select 
                  value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50 font-medium text-gray-700"
                >
                  <option value="Todos">📁 Todas las categorías</option>
                  <option value="Cámaras">📷 Cámaras</option>
                  <option value="NVR / Grabadores">🖥️ NVR / Grabadores</option>
                  <option value="Almacenamiento">💾 Almacenamiento (SD)</option>
                  <option value="Networking">🌐 Networking (Routers)</option>
                  <option value="Accesorios">🔌 Accesorios</option>
                  <option value="Soportes y Paneles">🛠️ Soportes y Paneles</option>
                  <option value="Cámara Foco">💡 Cámara Foco</option>
                </select>
              </div>

              {/* GRILLA DE PRODUCTOS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[450px] overflow-y-auto pr-2">
                {productosFiltrados.map(prod => (
                  <div key={prod.id} className="border border-gray-200 p-4 rounded-xl flex flex-col justify-between hover:shadow-md transition">
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{prod.marca}</span>
                        <span className={`text-xs font-bold ${prod.stock < 5 ? 'text-red-500' : 'text-gray-400'}`}>Stock: {prod.stock}</span>
                      </div>
                      <h4 className="font-bold text-gray-800 mt-2 text-sm">{prod.nombre}</h4>
                      <p className="text-xs text-gray-500">{prod.tipo}</p>
                    </div>
                    <div className="flex justify-between items-center mt-4 pt-3 border-t">
                      <span className="font-extrabold text-green-700">S/ {prod.precio.toFixed(2)}</span>
                      <button 
                        onClick={() => agregarAlCarrito(prod)}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                      >
                        + Agregar
                      </button>
                    </div>
                  </div>
                ))}
                {productosFiltrados.length === 0 && (
                  <div className="col-span-2 text-center py-10 text-gray-400 text-sm">
                    No se encontraron productos con ese filtro o búsqueda.
                  </div>
                )}
              </div>
            </div>

            {/* CARRITO Y DESCUENTOS */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col justify-between">
              <div>
                <h3 className="text-md font-bold text-gray-800 border-b pb-3 mb-3">🛒 Venta Actual</h3>

                {/* CLIENTE DE LA VENTA */}
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-gray-600">Cliente</label>
                    <button type="button" onClick={() => setMostrarModalCliente(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Nuevo cliente</button>
                  </div>

                  {clienteSeleccionado ? (
                    <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-blue-900 truncate">👤 {clienteSeleccionado.nombre}</p>
                        <p className="text-[11px] text-blue-700">
                          {clienteSeleccionado.documento ? `Doc: ${clienteSeleccionado.documento}` : 'Sin documento'}
                          {clienteSeleccionado.telefono ? ` · ${clienteSeleccionado.telefono}` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => setClienteSeleccionado(null)} className="text-xs font-bold text-red-500 hover:text-red-700 ml-2">Quitar</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Consumidor final · busca por nombre o DNI/RUC"
                        value={busquedaCliente}
                        onChange={(e) => { setBusquedaCliente(e.target.value); setMostrarListaClientes(true) }}
                        onFocus={() => setMostrarListaClientes(true)}
                        onBlur={() => setTimeout(() => setMostrarListaClientes(false), 150)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {mostrarListaClientes && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {clientesFiltrados.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={() => { setClienteSeleccionado(c); setBusquedaCliente(''); setMostrarListaClientes(false) }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                            >
                              <p className="text-xs font-semibold text-gray-800">{c.nombre}</p>
                              <p className="text-[11px] text-gray-500">{c.documento || 'Sin documento'}{c.telefono ? ` · ${c.telefono}` : ''}</p>
                            </button>
                          ))}
                          {clientesFiltrados.length === 0 && (
                            /^\d{8}$|^\d{11}$/.test(busquedaCliente.trim()) ? (
                            <button
                              type="button"
                              onMouseDown={() => registrarDesdeBusqueda(busquedaCliente.trim())}
                              className="w-full text-left px-3 py-3 hover:bg-blue-50"
                            >
                              <p className="text-xs font-bold text-blue-700">🔎 Consultar {busquedaCliente.trim().length === 8 ? 'DNI' : 'RUC'} {busquedaCliente.trim()}</p>
                              <p className="text-[11px] text-gray-500">No está registrado. Se buscará en RENIEC/SUNAT.</p>
                            </button>
                          ) : (
                            <p className="px-3 py-3 text-xs text-gray-400 text-center">Sin coincidencias. Usa "+ Nuevo cliente".</p>
                          )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="max-h-[230px] overflow-y-auto divide-y divide-gray-100 pr-1">
                  {carrito.map(item => (
                    <div key={item.id} className="py-3 flex justify-between items-center">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">{item.nombre}</h4>
                        <p className="text-xs text-gray-500">S/ {item.precio.toFixed(2)} c/u</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => cambiarCantidad(item.id, -1)} className="w-6 h-6 bg-gray-100 rounded text-gray-600 font-bold hover:bg-gray-200">-</button>
                        <span className="text-sm font-bold w-4 text-center">{item.cantidad}</span>
                        <button onClick={() => cambiarCantidad(item.id, 1)} className="w-6 h-6 bg-gray-100 rounded text-gray-600 font-bold hover:bg-gray-200">+</button>
                      </div>
                    </div>
                  ))}
                  {carrito.length === 0 && (
                    <p className="text-center text-gray-400 py-8 text-sm">El carrito está vacío.</p>
                  )}
                </div>
              </div>

              {/* CAMPO DE DESCUENTO */}
              <div className="border-t pt-3 mt-2 bg-gray-50 p-3 rounded-xl">
                <label className="block text-xs font-bold text-gray-600 mb-1">Descuento (S/)</label>
                <input 
                  type="number" step="0.50" min="0" placeholder="0.00"
                  value={descuentoMonto} onChange={(e) => setDescuentoMonto(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="border-t pt-3 mt-2">
                <div className="flex justify-between items-center mb-1 text-xs text-gray-500">
                  <span>Subtotal:</span>
                  <span>S/ {calcularSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mb-2 text-xs text-red-500">
                  <span>Descuento:</span>
                  <span>- S/ {Number(descuentoMonto || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mb-4 border-t pt-2">
                  <span className="font-bold text-gray-700">Total a Pagar:</span>
                  <span className="text-xl font-extrabold text-green-700">S/ {calcularTotalFinal()}</span>
                </div>
                <button 
                  disabled={carrito.length === 0 || cargando}
                  onClick={procesarCobro}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl transition shadow-md text-sm"
                >
                  {cargando ? 'Procesando...' : 'Cobrar Pedido'}
                </button>
              </div>
            </div>

          </div>
        )}

        {/* MODAL DE SELECCIÓN DE MEDIO DE PAGO */}
        {mostrarModalCobro && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-green-200">
              <div className="flex justify-center mb-2"><span className="text-3xl">💳</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Seleccionar Medio de Pago</h3>
              <p className="text-xs text-gray-500 text-center mb-4">Total a cobrar: <span className="font-extrabold text-green-700">S/ {calcularTotalFinal()}</span></p>

              <div className="flex flex-col gap-3 mb-4">
                <label className="block text-xs font-bold text-gray-600">Método de Pago Principal</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Efectivo', 'Yape / Plin', 'Tarjeta POS', 'Mixto'].map(metodo => (
                    <button
                      key={metodo}
                      type="button"
                      onClick={() => setMetodoPago(metodo)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition ${metodoPago === metodo ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}
                    >
                      {metodo === 'Mixto' ? '🔀 Pago Mixto' : metodo}
                    </button>
                  ))}
                </div>
              </div>

              {metodoPago === 'Mixto' && (
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl mb-4 flex flex-col gap-3">
                  <span className="text-xs font-bold text-blue-900">Desglose de Pago Mixto</span>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">Monto en Efectivo (S/)</label>
                    <input 
                      type="number" step="0.10" placeholder="0.00" 
                      value={montoEfectivoMixto} onChange={(e) => setMontoEfectivoMixto(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">Monto en Yape / Plin (S/)</label>
                    <input 
                      type="number" step="0.10" placeholder="0.00" 
                      value={montoYapeMixto} onChange={(e) => setMontoYapeMixto(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => setMostrarModalCobro(false)} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                <button type="button" disabled={cargando} onClick={finalizarVentaConPago} className="w-1/2 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                  {cargando ? 'Registrando...' : 'Confirmar Cobro'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO CLIENTE */}
        {mostrarModalCliente && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-blue-200">
              <div className="flex justify-center mb-2"><span className="text-3xl">👤</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Registrar Cliente</h3>
              <p className="text-xs text-gray-500 text-center mb-4">Se asignará automáticamente a la venta actual.</p>

              <form onSubmit={guardarCliente} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Nombre o Razón Social *</label>
                  <input type="text" required value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Ej: Juan Pérez" className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">DNI / RUC (opcional)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={clienteDocumento}
                      onChange={(e) => { setClienteDocumento(e.target.value); setDatosConsultados(false) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); consultarDocumento() } }}
                      placeholder="DNI (8 dígitos) o RUC (11)"
                      className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => consultarDocumento()}
                      disabled={consultandoDocumento}
                      className="px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-bold rounded-xl whitespace-nowrap transition"
                    >
                      {consultandoDocumento ? 'Consultando...' : '🔎 Consultar'}
                    </button>
                  </div>
                  <p className={`text-[11px] mt-1 ${datosConsultados ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
                    {datosConsultados ? '✔ Datos obtenidos de RENIEC/SUNAT. Puedes corregirlos si hace falta.' : 'Escribe el documento y pulsa Consultar para traer el nombre automáticamente.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Teléfono (opcional)</label>
                  <input type="tel" value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="Celular" className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm" />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalCliente} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                    {cargando ? 'Guardando...' : 'Guardar y Usar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL DE CUADRE Y CIERRE DE CAJA */}
        {mostrarModalCierre && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-yellow-300">
              <div className="flex justify-center mb-2"><span className="text-3xl">🧮</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Cuadre y Cierre de Turno</h3>
              <p className="text-xs text-gray-500 text-center mb-4">Cuenta el efectivo físico en caja e ingrésalo junto a tu contraseña.</p>

              <form onSubmit={confirmarCierreCaja} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Efectivo Real en Caja (S/)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-2.5 text-gray-500 font-bold text-sm">S/</span>
                    <input 
                      type="number" step="0.10" required 
                      placeholder="0.00" value={efectivoRealCaja} onChange={(e) => setEfectivoRealCaja(e.target.value)} 
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm" 
                    />
                  </div>
                  <span className="text-[11px] text-gray-400 mt-1 block">Sencillo inicial registrado: S/ {turnoAbierto?.monto_apertura}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Tu Contraseña de Autorización</label>
                  <input 
                    type="password" required 
                    placeholder="Contraseña actual" value={passwordCierre} onChange={(e) => setPasswordCierre(e.target.value)} 
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm" 
                  />
                </div>

                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={() => { setMostrarModalCierre(false); setPasswordCierre(''); }} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                    {cargando ? 'Calculando y cerrando...' : 'Confirmar Cierre'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL RETIRO DE CAJA (AUTORIZADO POR UN ADMIN) */}
        {mostrarModalRetiro && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-indigo-200">
              <div className="flex justify-center mb-2"><span className="text-3xl">💸</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Retiro de Caja</h3>
              <p className="text-xs text-gray-500 text-center mb-5">Un Administrador debe autorizar el retiro con sus credenciales.</p>

              <form onSubmit={registrarRetiroCajero} autoComplete="off" className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Monto a retirar (S/)</label>
                  <input type="number" step="0.01" min="0.01" required autoComplete="off" placeholder="0.00" value={retiroMonto} onChange={(e) => setRetiroMonto(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Motivo</label>
                  <input type="text" required autoComplete="off" placeholder="Ej: Depósito al banco, pago a proveedor" value={retiroMotivo} onChange={(e) => setRetiroMotivo(e.target.value)} className={claseInputModal} />
                </div>

                <div className="border-t pt-3 mt-1 flex flex-col gap-3">
                  <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Autorización del administrador</p>
                  <input type="email" name="admin-retiro-correo" autoComplete="off" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa el correo del administrador" value={retiroEmailAdmin} onChange={(e) => setRetiroEmailAdmin(e.target.value)} className={claseInputModal} />
                  <input type="password" name="admin-retiro-clave" autoComplete="new-password" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa la contraseña del administrador" value={retiroPasswordAdmin} onChange={(e) => setRetiroPasswordAdmin(e.target.value)} className={claseInputModal} />
                </div>

                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalesRetiro} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-sm shadow-md">
                    {cargando ? 'Validando...' : 'Autorizar retiro'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL DE DESCUENTO ALTO */}
        {mostrarModalDescuento && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-red-300">
              <div className="flex justify-center mb-2"><span className="text-3xl">🛡️</span></div>
              <h3 className="text-lg font-bold text-gray-800 text-center mb-1">Autorización Requerida</h3>
              <p className="text-xs text-gray-500 text-center mb-6">El descuento supera los S/ 20.00. Un Administrador debe ingresar sus datos.</p>

              <form onSubmit={autorizarDescuentoAlto} autoComplete="off" className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Correo del Administrador</label>
                  <input type="email" name="admin-descuento-correo" autoComplete="off" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa el correo del administrador" value={emailAdminDesc} onChange={(e) => setEmailAdminDesc(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Contraseña del Administrador</label>
                  <input type="password" name="admin-descuento-clave" autoComplete="new-password" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa la contraseña del administrador" value={passwordAdminDesc} onChange={(e) => setPasswordAdminDesc(e.target.value)} className={claseInputModal} />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={() => { setMostrarModalDescuento(false); setEmailAdminDesc(''); setPasswordAdminDesc(''); }} className="w-1/2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl text-sm shadow-md">Autorizar</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  return <div className="p-8">Cargando módulos...</div>
}

export default App