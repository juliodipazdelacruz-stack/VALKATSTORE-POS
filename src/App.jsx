import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { LogOut, Lock, LayoutDashboard, Wallet, BarChart3, Package, Users, Globe, Briefcase, Search, X, ShoppingCart, UserRound, ArrowDownToLine, Plus, CheckCircle2, XCircle, AlertTriangle, PartyPopper, SearchCheck, Coins, LockKeyhole, Sun, Moon, ReceiptText, TrendingUp, Flame, Snowflake, Settings2, Pencil, Eye, CreditCard, Calculator, ShieldCheck, Landmark } from 'lucide-react'
import { supabase } from './supabase'
import SpecsEditor, { cargarFicha, guardarFicha } from './SpecsEditor'
import EscanerCodigo from './EscanerCodigo'
import SelectorImagen, { subirImagen } from './SelectorImagen'
import AdminWeb from './AdminWeb'
import AdminCuentas from './AdminCuentas'
import GestorListas from './GestorListas'
import StockLocales from './StockLocales'
import TrasladosPorRecibir from './TrasladosPorRecibir'
import './dark.css'

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

const claseInputModal = 'w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition'
const claseCampo = 'w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition'

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

// Emojis solo para las categorías de siempre; las nuevas salen con 📁
const EMOJI_CATEGORIA = {
  'Cámaras': '📷', 'NVR / Grabadores': '🖥️', 'Almacenamiento': '💾', 'Networking': '🌐',
  'Accesorios': '🔌', 'Soportes y Paneles': '🛠️', 'Cámara Foco': '💡',
}

// ---------- Búsqueda de productos (sin tildes, varias palabras, apodos, código de barras y ficha) ----------
const quitaTildes = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function buscarProductos(lista, fichas, texto) {
  const tokens = quitaTildes(texto).split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return lista
  const res = []
  for (const p of lista) {
    const f = fichas[p.id]
    const specs = f?.especificaciones ? Object.entries(f.especificaciones).map(([k, v]) => `${k} ${v}`).join(' ') : ''
    const principal = quitaTildes(`${p.nombre} ${p.marca || ''}`)
    const otros = quitaTildes(`${p.tipo || ''} ${f?.apodos || ''} ${f?.codigo_barras || ''} ${specs}`)
    let puntos = 0, ok = true
    for (const t of tokens) {
      if (principal.includes(t)) puntos += (principal.startsWith(t) || principal.includes(' ' + t)) ? 3 : 2
      else if (otros.includes(t)) puntos += 1
      else { ok = false; break }
    }
    if (ok) res.push({ p, puntos })
  }
  return res.sort((a, b) => b.puntos - a.puntos).map(x => x.p)
}

// Miniatura del producto: muestra la foto o un recuadro punteado si aún no tiene imagen
function MiniFoto({ url, nombre, tam = 'w-12 h-12', onClick }) {
  if (!url) {
    return (
      <div className="shrink-0 flex flex-col items-center gap-0.5" title="Este producto aún no tiene imagen">
        <div className={`${tam} rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 flex items-center justify-center text-zinc-300 text-lg`}>📷</div>
      </div>
    )
  }
  const img = <img src={url} alt={nombre} loading="lazy" className={`${tam} rounded-lg border border-zinc-200 object-cover bg-white`} />
  return (
    <div className="relative shrink-0">
      {onClick
        ? <button type="button" onClick={onClick} title="Ver imagen" className="block hover:ring-2 hover:ring-emerald-500 rounded-lg transition">{img}</button>
        : img}
      <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] leading-4 text-center border-2 border-white" aria-hidden="true">✓</span>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [tema, setTema] = useState(() => {
    try { return localStorage.getItem('valkat-tema') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [modoRecuperacion, setModoRecuperacion] = useState(false)
  const [olvideClave, setOlvideClave] = useState(false)
  const [correoEnviado, setCorreoEnviado] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', tema === 'dark')
    try { localStorage.setItem('valkat-tema', tema) } catch { /* sin almacenamiento */ }
  }, [tema])
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
  const [fichas, setFichas] = useState({})
  const [filtroTipoAdmin, setFiltroTipoAdmin] = useState('Todos')
  const [filtroStockAdmin, setFiltroStockAdmin] = useState('todos')
  const [imagenVista, setImagenVista] = useState(null)
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [listaCategorias, setListaCategorias] = useState([])
  const [listaMarcas, setListaMarcas] = useState([])
  const [mostrarGestorListas, setMostrarGestorListas] = useState(false)
  const [mostrarStockLocales, setMostrarStockLocales] = useState(false)

  // Estados para Modal de Crear / Editar Producto (Admin)
  const [mostrarModalProductoAdmin, setMostrarModalProductoAdmin] = useState(false)
  const [modoEdicion, setModoEdicion] = useState(false)
  const [prodIdEditando, setProdIdEditando] = useState(null)
  const [prodNombre, setProdNombre] = useState('')
  const [prodMarca, setProdMarca] = useState('Valkat')
  const [prodTipo, setProdTipo] = useState('Cámaras')
  const [prodPrecio, setProdPrecio] = useState('')
  const [prodStock, setProdStock] = useState('')
  const [prodApodos, setProdApodos] = useState('')
  const [prodCodigo, setProdCodigo] = useState('')
  const [prodSpecs, setProdSpecs] = useState({})
  const [mostrarEscaner, setMostrarEscaner] = useState(false)
  const [prodImagenUrl, setProdImagenUrl] = useState('')
  const [prodImagenArchivo, setProdImagenArchivo] = useState(null)

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

  // Al abrir el resumen del admin se cargan productos y ventas del rango activo
  useEffect(() => {
    if (rol === 'admin' && vistaAdmin === 'dashboard') {
      cargarProductos()
      cargarReporteVentas(rangoReporte)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol, vistaAdmin])

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
      if (_event === 'PASSWORD_RECOVERY') setModoRecuperacion(true)
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
    const { data: fi } = await supabase.from('productos_ficha')
      .select('producto_id, apodos, codigo_barras, imagen_url, especificaciones')
    if (fi) setFichas(Object.fromEntries(fi.map(f => [f.producto_id, f])))

    // Listas de categorías y marcas (si la tabla aún no existe, se arman con lo que usan los productos)
    const [{ data: cats }, { data: mars }] = await Promise.all([
      supabase.from('categorias').select('nombre').order('nombre'),
      supabase.from('marcas').select('nombre').order('nombre'),
    ])
    const usados = (campo) => Array.from(new Set((data ?? []).map(p => p[campo]).filter(Boolean))).sort()
    setListaCategorias(cats?.length ? cats.map(c => c.nombre) : usados('tipo'))
    setListaMarcas(mars?.length ? mars.map(m => m.nombre) : usados('marca'))
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

  const manejarRecuperar = async (e) => {
    e.preventDefault()
    setCargando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setCargando(false)
    if (error) return notificar('No se pudo enviar el correo: ' + error.message, 'error')
    setCorreoEnviado(true)
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

    setModoRecuperacion(false)
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

    const datosProducto = {
      nombre: prodNombre,
      marca: prodMarca,
      tipo: prodTipo,
      precio: parseFloat(prodPrecio),
      stock: parseInt(prodStock)
    }

    let productoId = prodIdEditando
    let errorProducto = null

    if (modoEdicion) {
      const { error } = await supabase
        .from('productos')
        .update(datosProducto)
        .eq('id', prodIdEditando)
      errorProducto = error
    } else {
      const { data, error } = await supabase
        .from('productos')
        .insert([datosProducto])
        .select('id')
        .single()
      errorProducto = error
      productoId = data?.id
    }

    if (errorProducto) {
      notificar((modoEdicion ? 'Error al actualizar producto: ' : 'Error al registrar producto: ') + errorProducto.message)
      setCargando(false)
      return
    }

    // Ficha técnica (apodos, código de barras, especificaciones)
    // Foto (si se eligió una nueva); si falla la subida, se conserva la anterior
    let imagenUrl = prodImagenUrl
    if (prodImagenArchivo) {
      const r = await subirImagen(supabase, productoId, prodImagenArchivo)
      if (r.error) notificar('No se pudo subir la foto: ' + (r.error.message || r.error))
      else imagenUrl = r.url
    }

    const { error: errorFicha } = await guardarFicha(supabase, productoId, {
      apodos: prodApodos,
      codigo: prodCodigo,
      specs: prodSpecs,
      imagen: imagenUrl
    })

    if (errorFicha) {
      notificar(errorFicha.code === '23505'
        ? 'Producto guardado, pero ese código de barras ya pertenece a otro producto.'
        : 'Producto guardado, pero falló la ficha técnica: ' + errorFicha.message)
    } else {
      notificar(modoEdicion
        ? '¡Producto actualizado con éxito!'
        : '¡Producto agregado al inventario global con éxito!')
      setMostrarModalProductoAdmin(false)
    }

    cargarProductos()
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
    setProdApodos('')
    setProdCodigo('')
    setProdSpecs({})
    setProdImagenUrl('')
    setProdImagenArchivo(null)
    setMostrarModalProductoAdmin(true)
  }

  const abrirModalEditar = async (prod) => {
    // Se carga la ficha antes de abrir el modal para que el editor nazca con sus datos
    const ficha = await cargarFicha(supabase, prod.id)
    setModoEdicion(true)
    setProdIdEditando(prod.id)
    setProdNombre(prod.nombre)
    setProdMarca(prod.marca)
    setProdTipo(prod.tipo)
    setProdPrecio(prod.precio)
    setProdStock(prod.stock)
    setProdApodos(ficha?.apodos ?? '')
    setProdCodigo(ficha?.codigo_barras ?? '')
    setProdSpecs(ficha?.especificaciones ?? {})
    setProdImagenUrl(ficha?.imagen_url ?? '')
    setProdImagenArchivo(null)
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

  const productosFiltrados = buscarProductos(
    productos.filter(p => filtroTipo === 'Todos' || p.tipo === filtroTipo), fichas, busqueda)

  // Enter en el buscador del POS: agrega el producto si el código de barras coincide o si hay una sola coincidencia
  const alBuscarEnter = (e) => {
    if (e.key !== 'Enter') return
    const q = busqueda.trim()
    if (!q) return
    const exacto = productos.find(p => (fichas[p.id]?.codigo_barras || '') === q)
    const elegido = exacto || (productosFiltrados.length === 1 ? productosFiltrados[0] : null)
    if (elegido) { agregarAlCarrito(elegido); setBusqueda('') }
  }

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

  const productosAdminFiltrados = buscarProductos(
    listaProductosAdmin.filter(p =>
      (filtroTipoAdmin === 'Todos' || p.tipo === filtroTipoAdmin) &&
      (filtroStockAdmin === 'todos' || (filtroStockAdmin === 'agotado' ? p.stock <= 0 : (p.stock > 0 && p.stock < 5)))),
    fichas, busquedaAdmin)
  const tiposAdmin = ['Todos', ...Array.from(new Set(listaProductosAdmin.map(p => p.tipo).filter(Boolean)))]
  const conteoTiposAdmin = listaProductosAdmin.reduce((acc, p) => { if (p.tipo) acc[p.tipo] = (acc[p.tipo] || 0) + 1; return acc }, {})
  const hayFiltrosAdmin = busquedaAdmin || filtroTipoAdmin !== 'Todos' || filtroStockAdmin !== 'todos'
  const limpiarFiltrosAdmin = () => { setBusquedaAdmin(''); setFiltroTipoAdmin('Todos'); setFiltroStockAdmin('todos') }

  const modulosAdmin = [
    { vista: 'dashboard', icono: LayoutDashboard, titulo: 'Resumen', ir: () => setVistaAdmin('dashboard') },
    { vista: 'cuadre', icono: Wallet, titulo: 'Cuadre de caja', ir: () => { setVistaAdmin('cuadre'); cargarTurnosAdmin() } },
    { vista: 'reportes', icono: BarChart3, titulo: 'Reportes y analítica', ir: () => { setVistaAdmin('reportes'); cargarProductos(); cargarReporteVentas(rangoReporte) } },
    { vista: 'productos', icono: Package, titulo: 'Inventario', ir: () => { setVistaAdmin('productos'); cargarProductos() } },
    { vista: 'usuarios', icono: Users, titulo: 'Usuarios', ir: () => { setVistaAdmin('usuarios'); cargarUsuarios() } },
    { vista: 'web', icono: Globe, titulo: 'Tienda web', ir: () => setVistaAdmin('web') },
    { vista: 'cuentas', icono: Briefcase, titulo: 'Cuentas y pagos', ir: () => setVistaAdmin('cuentas') }
  ]

  // Indicadores del resumen (inventario)
  const kpiInventario = listaProductosAdmin.reduce((acc, p) => {
    const st = Number(p.stock) || 0
    acc.valor += st * Number(p.precio || 0)
    if (st <= 0) acc.agotados++
    else if (st < 5) acc.bajos++
    return acc
  }, { valor: 0, agotados: 0, bajos: 0 })
  const alertasStock = listaProductosAdmin
    .filter(p => (Number(p.stock) || 0) < 5)
    .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
    .slice(0, 6)

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
      // Venta + detalle + descuento de stock en UNA sola operación en la base:
      // si algo falla (por ejemplo, stock insuficiente) no queda nada a medias.
      const { error: ventaError } = await supabase.rpc('registrar_venta', {
        p_turno_id: turnoAbierto.id,
        p_cliente_id: clienteSeleccionado?.id || null,
        p_total: totalPagar,
        p_monto_efectivo: efectivoVenta,
        p_medio_pago: metodoPago,
        p_items: carrito.map(item => ({
          producto_id: item.id,
          cantidad: item.cantidad,
          precio: item.precio
        }))
      })

      if (ventaError) throw ventaError

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
    exito: { barra: 'bg-emerald-500', icono: CheckCircle2, titulo: 'Listo' },
    error: { barra: 'bg-red-500', icono: XCircle, titulo: 'Ups, algo salió mal' },
    aviso: { barra: 'bg-amber-400', icono: AlertTriangle, titulo: 'Atención' }
  }

  const botonTema = (
    <button
      type="button"
      onClick={() => setTema(t => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      className="inline-flex items-center justify-center rounded-lg p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition"
    >
      {tema === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )

  const capaGlobal = (
    <>
      {toast && (
        <div key={toast.id} className="fixed top-5 right-5 z-[60] w-[calc(100%-2.5rem)] max-w-sm">
          <div className="bg-white rounded-xl shadow-xl border border-zinc-200 overflow-hidden flex">
            <div className={`w-1.5 ${estilosToast[toast.tipo].barra}`} />
            <div className="flex-1 p-4 flex items-start gap-3">
              {(() => { const I = estilosToast[toast.tipo].icono; return <I className="w-5 h-5 shrink-0 mt-0.5 text-zinc-700" /> })()}
              <div className="flex-1">
                <p className="text-sm font-bold text-zinc-800">{estilosToast[toast.tipo].titulo}</p>
                <p className="text-xs text-zinc-600 mt-0.5 break-words">{toast.mensaje}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
            </div>
          </div>
        </div>
      )}

      {resumenCierre && (() => {
        const dif = resumenCierre.diferencia
        const cuadra = Math.abs(dif) < 0.005
        const tono = cuadra
          ? { fondo: 'bg-emerald-50', borde: 'border-emerald-200', texto: 'text-emerald-700', icono: PartyPopper, titulo: '¡Caja cuadrada!', sub: 'Todo coincide al céntimo. Buen trabajo.' }
          : dif > 0
            ? { fondo: 'bg-blue-50', borde: 'border-blue-200', texto: 'text-blue-700', icono: Coins, titulo: 'Caja con sobrante', sub: 'Hay más efectivo del esperado. Revisa si faltó registrar algo.' }
            : { fondo: 'bg-red-50', borde: 'border-red-200', texto: 'text-red-700', icono: SearchCheck, titulo: 'Caja con faltante', sub: 'Hay menos efectivo del esperado. Revisa las ventas del turno.' }
        const fila = (label, valor, destacado) => (
          <div className={`flex justify-between items-center py-2 ${destacado ? 'font-bold text-zinc-800' : 'text-zinc-600'}`}>
            <span className="text-sm">{label}</span>
            <span className="text-sm font-semibold">S/ {valor.toFixed(2)}</span>
          </div>
        )
        return (
          <div className="fixed inset-0 bg-zinc-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-[70]">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
              <div className={`${tono.fondo} ${tono.borde} border-b p-6 text-center`}>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white border border-zinc-200"><tono.icono className={`w-6 h-6 ${tono.texto}`} /></div>
                <h3 className={`text-xl font-bold tracking-tight ${tono.texto}`}>{tono.titulo}</h3>
                <p className="text-xs text-zinc-600 mt-1">{tono.sub}</p>
              </div>
              <div className="p-6">
                <div className="divide-y divide-zinc-100">
                  {fila('Sencillo inicial', resumenCierre.apertura)}
                  {fila('Ventas en efectivo', resumenCierre.ventasEfectivo)}
                  {resumenCierre.retiros > 0 && fila('Retiros de caja (-)', resumenCierre.retiros)}
                  {fila('Monto esperado', resumenCierre.esperado, true)}
                  {fila('Efectivo contado', resumenCierre.real, true)}
                </div>
                <p className="text-[11px] text-zinc-400 mt-3 text-center">
                  {resumenCierre.cantidadVentas} ventas por S/ {resumenCierre.totalVentas.toFixed(2)} en total · S/ {resumenCierre.ventasDigitales.toFixed(2)} fueron Yape/Plin/POS y no entran al cuadre
                </p>
                <div className={`mt-4 rounded-xl ${tono.fondo} ${tono.borde} border p-4 flex justify-between items-center`}>
                  <span className="text-sm font-bold text-zinc-700">Diferencia</span>
                  <span className={`text-lg font-bold tracking-tight ${tono.texto}`}>
                    {dif > 0 ? '+' : dif < 0 ? '-' : ''}S/ {Math.abs(dif).toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={() => { setResumenCierre(null); setTurnoAbierto(null) }}
                  className="w-full mt-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm shadow-md transition"
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
    return <div className="min-h-screen flex items-center justify-center bg-zinc-100 font-medium">Cargando sistema Valkat Store...</div>
  }

  if (!session) {
    return (
      <div className="relative min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        {capaGlobal}
        <div className="absolute top-4 right-4">{botonTema}</div>
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.png" alt="Logo Valkat Store" className="h-14 w-14 object-contain rounded-xl border border-zinc-200 bg-white p-1.5" />
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">Valkat Store</h1>
            <p className="text-sm text-zinc-500">Punto de venta</p>
          </div>
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-6">
            {olvideClave ? (
              correoEnviado ? (
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">Revisa tu correo</h2>
                  <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Si <span className="font-medium text-zinc-700">{email}</span> está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.</p>
                  <button type="button" onClick={() => { setOlvideClave(false); setCorreoEnviado(false) }} className="mt-5 w-full bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm">Volver a iniciar sesión</button>
                </div>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-zinc-900">Recuperar contraseña</h2>
                  <p className="text-xs text-zinc-500 mt-1">Te enviaremos un enlace a tu correo para crear una nueva contraseña.</p>
                  <form onSubmit={manejarRecuperar} className="mt-5 flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1.5">Correo electrónico</label>
                      <input type="email" required placeholder="nombre@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} className={claseCampo} />
                    </div>
                    <button type="submit" disabled={cargando} className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm">
                      {cargando ? 'Enviando...' : 'Enviar enlace'}
                    </button>
                    <button type="button" onClick={() => setOlvideClave(false)} className="text-xs font-medium text-zinc-500 hover:text-zinc-900 transition">Volver</button>
                  </form>
                </>
              )
            ) : (
              <>
                <h2 className="text-base font-semibold text-zinc-900">Iniciar sesión</h2>
                <p className="text-xs text-zinc-500 mt-1">Ingresa con tu cuenta para acceder al sistema.</p>
                <form onSubmit={manejarLogin} className="mt-5 flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1.5">Correo electrónico</label>
                    <input type="email" required placeholder="nombre@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} className={claseCampo} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-zinc-600">Contraseña</label>
                      <button type="button" onClick={() => setOlvideClave(true)} className="text-xs font-medium text-zinc-500 hover:text-zinc-900 transition">¿Olvidaste tu contraseña?</button>
                    </div>
                    <input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={claseCampo} />
                  </div>
                  <button type="submit" disabled={cargando} className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm mt-1">
                    {cargando ? 'Ingresando...' : 'Iniciar sesión'}
                  </button>
                </form>
              </>
            )}
          </div>
          <p className="text-center text-[11px] text-zinc-400 mt-5">© Valkat Store</p>
        </div>
      </div>
    )
  }

  if (debeCambiarPassword || modoRecuperacion) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        {capaGlobal}
        <div className="w-full max-w-sm bg-white rounded-xl border border-zinc-200 shadow-sm p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 border border-amber-200 text-amber-600"><LockKeyhole className="w-5 h-5" /></div>
          <h2 className="mt-4 text-base font-semibold text-zinc-900">Crea tu contraseña personal</h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Por políticas de Valkat Store, debes crear una contraseña personal antes de entrar a la caja.</p>
          <form onSubmit={manejarCambioPassword} className="mt-5 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Nueva contraseña</label>
              <input type="password" required placeholder="Nueva contraseña" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} className={claseCampo} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Confirmar contraseña</label>
              <input type="password" required placeholder="Confirma tu nueva contraseña" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className={claseCampo} />
            </div>
            <button type="submit" disabled={cargando} className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm mt-1">
              {cargando ? 'Actualizando...' : 'Guardar y entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // --- VISTA DE ADMINISTRADOR ---
  if (rol === 'admin') {
    return (
      <div className="min-h-screen bg-zinc-50">
        {capaGlobal}
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-[1600px] px-4 lg:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain rounded-md" />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-zinc-900">Valkat Store</p>
                <p className="text-[11px] text-zinc-500">Panel administrativo</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Administrador · En línea
              </span>
              {botonTema}
              <button onClick={cerrarSesion} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition">
                <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Cerrar sesión</span>
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-6 flex flex-col lg:flex-row gap-6 items-start">
          <aside className="w-full lg:w-60 shrink-0 lg:sticky lg:top-20 bg-white rounded-xl border border-zinc-200 p-2">
            <p className="hidden lg:block px-3 pt-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Menú</p>
            <nav className="flex lg:flex-col gap-1 overflow-x-auto">
              {modulosAdmin.map((m) => {
                const activo = vistaAdmin === m.vista
                return (
                  <button
                    key={m.vista}
                    onClick={m.ir}
                    className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${activo ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'}`}
                  >
                    <m.icono className="w-4 h-4 shrink-0" />
                    <span>{m.titulo}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="flex-1 min-w-0 w-full">
        {/* RESUMEN (VISTA PREDETERMINADA DEL ADMIN) */}
        {vistaAdmin === 'dashboard' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-zinc-800">Resumen general</h2>
                <p className="text-sm text-zinc-500">Así va Valkat Store · {etiquetaRangoReporte.toLowerCase()}</p>
              </div>
              <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
                {RANGOS_REPORTE.map(r => (
                  <button key={r.id} onClick={() => cambiarRangoReporte(r.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${rangoReporte === r.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                    {r.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {[
                { t: 'Importe vendido', v: cargandoReporte ? '…' : soles(resumenReporte.totalImporte), s: 'en el período', c: 'text-zinc-900' },
                { t: 'Unidades vendidas', v: cargandoReporte ? '…' : resumenReporte.totalUnidades, s: `${resumenReporte.productos.length} productos distintos`, c: 'text-indigo-700' },
                { t: 'Productos en catálogo', v: listaProductosAdmin.length, s: `${kpiInventario.agotados} agotados · ${kpiInventario.bajos} con stock bajo`, c: 'text-emerald-700' }
              ].map(k => (
                <div key={k.t} className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5">
                  <p className="text-xs font-semibold text-zinc-500">{k.t}</p>
                  <p className={`mt-2 text-2xl font-bold tracking-tight ${k.c}`}>{k.v}</p>
                  <p className="mt-1 text-[11px] text-zinc-400">{k.s}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-zinc-800">Más vendidos</h3>
                  <button onClick={() => modulosAdmin.find(m => m.vista === 'reportes').ir()} className="text-xs font-bold text-blue-700 hover:underline">Ver reportes →</button>
                </div>
                {cargandoReporte ? (
                  <p className="text-sm text-zinc-400">Calculando…</p>
                ) : resumenReporte.productos.length === 0 ? (
                  <p className="text-sm text-zinc-400">Sin ventas en este período.</p>
                ) : (
                  <ul className="space-y-3">
                    {resumenReporte.productos.slice(0, 5).map((prod, i) => (
                      <li key={prod.nombre + prod.marca}>
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-zinc-700 truncate pr-3">{i + 1}. {prod.nombre}</span>
                          <span className="text-zinc-500 whitespace-nowrap">{prod.cantidad} und · {soles(prod.importe)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${(prod.cantidad / resumenReporte.productos[0].cantidad) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5">
                <h3 className="font-bold text-zinc-800 mb-4">Ventas por categoría</h3>
                {cargandoReporte ? (
                  <p className="text-sm text-zinc-400">Calculando…</p>
                ) : resumenReporte.categorias.length === 0 ? (
                  <p className="text-sm text-zinc-400">Sin ventas en este período.</p>
                ) : (
                  <ul className="space-y-3">
                    {resumenReporte.categorias.slice(0, 6).map(c => (
                      <li key={c.tipo}>
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-zinc-700">{c.tipo}</span>
                          <span className="text-zinc-500">{c.cantidad} und · {soles(c.importe)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-zinc-100">
                          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(c.cantidad / resumenReporte.categorias[0].cantidad) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-zinc-800"><AlertTriangle className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Alertas de stock</h3>
                <button onClick={() => modulosAdmin.find(m => m.vista === 'productos').ir()} className="text-xs font-bold text-emerald-700 hover:underline">Ir al inventario →</button>
              </div>
              {alertasStock.length === 0 ? (
                <p className="text-sm text-zinc-400">Sin alertas: todo tiene stock suficiente.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {alertasStock.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-700">{p.nombre}</p>
                        <p className="text-[11px] text-zinc-400">{p.tipo}</p>
                      </div>
                      {(Number(p.stock) || 0) <= 0
                        ? <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-full">Agotado</span>
                        : <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">Quedan {p.stock}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {vistaAdmin === 'web' && (
          <AdminWeb onVolver={() => setVistaAdmin('dashboard')} notificar={notificar} />
        )}

        {vistaAdmin === 'cuentas' && (
          <AdminCuentas onVolver={() => setVistaAdmin('dashboard')} notificar={notificar} />
        )}

        {/* VISTA DE CUADRE Y RESUMEN DE CAJAS */}
        {vistaAdmin === 'cuadre' && (
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
              <div>
                <h2 className="text-xl font-bold text-zinc-800"><Briefcase className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Cuadre de caja y turnos de empleados</h2>
                <p className="text-xs text-zinc-500 mt-1">Historial completo con montos esperados, reales y diferencias.</p>
              </div>
              <button onClick={() => setVistaAdmin('dashboard')} className="text-zinc-500 hover:text-zinc-800 font-medium text-sm">← Volver</button>
            </div>

            <div className="overflow-x-auto max-h-[550px]">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 text-zinc-600 text-sm sticky top-0">
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
                <tbody className="divide-y divide-zinc-100 text-sm">
                  {listaTurnosAdmin.map((turno) => (
                    <tr key={turno.id} className="hover:bg-zinc-50 transition">
                      <td className="p-4 font-medium text-zinc-800">
                        {turno.usuarios?.nombre_completo || 'Usuario'} 
                        <span className="block text-xs text-zinc-400">{turno.usuarios?.email}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${turno.estado === 'Abierta' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}>
                          {turno.estado.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-blue-700">S/ {turno.monto_apertura.toFixed(2)}</td>
                      <td className="p-4 font-semibold text-zinc-700">
                        {turno.monto_cierre_esperado !== null ? `S/ ${Number(turno.monto_cierre_esperado).toFixed(2)}` : 'Calculando...'}
                      </td>
                      <td className="p-4 font-bold text-emerald-700">
                        {turno.monto_cierre_real !== null ? `S/ ${Number(turno.monto_cierre_real).toFixed(2)}` : 'En caja'}
                      </td>
                      <td className="p-4">
                        {turno.diferencia !== null ? (
                          <span className={`font-bold px-2 py-1 rounded text-xs ${Number(turno.diferencia) < 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            S/ {Number(turno.diferencia).toFixed(2)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-4 text-xs text-zinc-500">
                        {fechaLocal(turno.fecha_apertura)?.toLocaleString('es-PE')}
                        <span className="block text-[10px] text-zinc-400">
                          {turno.fecha_cierre ? `Cierre: ${fechaLocal(turno.fecha_cierre).toLocaleString('es-PE')}` : 'Turno en curso'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1.5 items-start">
                          <button onClick={() => verDetalleTurno(turno)} className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap">
                          <Eye className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Ver detalle
                        </button>
                          {turno.estado === 'Abierta' && (
                            <button onClick={() => abrirRetiroAdmin(turno)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap">
                              <ArrowDownToLine className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Retirar efectivo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {listaTurnosAdmin.length === 0 && (
                    <tr><td colSpan="8" className="p-6 text-center text-zinc-400">No hay turnos de caja registrados todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODAL RETIRO DE CAJA (ADMIN) */}
        {turnoRetiro && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-[55]">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-indigo-200">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><ArrowDownToLine className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Retiro de Caja</h3>
              <p className="text-xs text-zinc-500 text-center mb-4">Turno de {turnoRetiro.usuarios?.nombre_completo || 'cajero'}</p>

              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-center mb-4">
                <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">Efectivo disponible en caja</span>
                <p className="text-2xl font-bold tracking-tight text-indigo-900 mt-1">{retiroDisponible === null ? 'Calculando...' : soles(retiroDisponible)}</p>
                <span className="text-[10px] text-indigo-500">Sencillo inicial + ventas en efectivo - retiros anteriores</span>
              </div>

              <form onSubmit={registrarRetiroAdmin} autoComplete="off" className="flex flex-col gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-zinc-600">Monto a retirar (S/)</label>
                    <button type="button" disabled={retiroDisponible === null} onClick={() => setRetiroMonto(Math.max(0, retiroDisponible).toFixed(2))} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Retirar todo</button>
                  </div>
                  <input type="number" step="0.01" min="0.01" required autoComplete="off" placeholder="0.00" value={retiroMonto} onChange={(e) => setRetiroMonto(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Motivo</label>
                  <input type="text" required autoComplete="off" placeholder="Ej: Depósito al banco, pago a proveedor" value={retiroMotivo} onChange={(e) => setRetiroMotivo(e.target.value)} className={claseInputModal} />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalesRetiro} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando || retiroDisponible === null} className="w-1/2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 rounded-xl text-sm shadow-md">
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
              <p className="text-lg font-bold tracking-tight mt-0.5">{valor}</p>
            </div>
          )
          return (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b p-5 flex justify-between items-start z-10">
                  <div>
                    <h3 className="text-lg font-bold text-zinc-800">Detalle del turno · {turnoDetalle.usuarios?.nombre_completo || 'Cajero'}</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      {fechaLocal(turnoDetalle.fecha_apertura)?.toLocaleString('es-PE')}
                      {turnoDetalle.fecha_cierre ? ` → ${fechaLocal(turnoDetalle.fecha_cierre).toLocaleString('es-PE')}` : ' · Turno en curso'}
                    </p>
                  </div>
                  <button onClick={() => setTurnoDetalle(null)} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none">×</button>
                </div>

                {cargandoDetalle ? (
                  <p className="p-10 text-center text-sm text-zinc-400">Cargando ventas del turno...</p>
                ) : (
                  <div className="p-5 flex flex-col gap-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {kpi('Total vendido', soles(r.total), 'bg-emerald-50 border-emerald-100 text-emerald-800')}
                      {kpi('N° de ventas', r.cantidad, 'bg-zinc-50 border-zinc-200 text-zinc-800')}
                      {kpi('Descuentos', soles(r.descuento), 'bg-red-50 border-red-100 text-red-700')}
                      {kpi('Efectivo', soles(r.efectivo), 'bg-amber-50 border-amber-100 text-amber-800')}
                      {kpi('Yape / Plin', soles(r.yape), 'bg-purple-50 border-purple-100 text-purple-800')}
                      {kpi('Tarjeta POS', soles(r.tarjeta), 'bg-blue-50 border-blue-100 text-blue-800')}
                    </div>
                    {r.mixtoSinDesglose > 0 && (
                      <p className="text-xs text-zinc-500 -mt-3">
                        Hay {soles(r.mixtoSinDesglose)} en pagos mixtos antiguos sin desglose de efectivo/Yape.
                      </p>
                    )}

                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div><span className="block text-[11px] text-zinc-500">Sencillo inicial</span><b>{soles(turnoDetalle.monto_apertura)}</b></div>
                      <div><span className="block text-[11px] text-zinc-500">Retiros</span><b className={totalRetirosDetalle > 0 ? 'text-indigo-700' : ''}>{totalRetirosDetalle > 0 ? '-' : ''}{soles(totalRetirosDetalle)}</b></div>
                      <div><span className="block text-[11px] text-zinc-500">Esperado en caja</span><b>{cerrado ? soles(turnoDetalle.monto_cierre_esperado) : soles(Number(turnoDetalle.monto_apertura) + r.efectivo - totalRetirosDetalle) + ' (parcial)'}</b></div>
                      <div><span className="block text-[11px] text-zinc-500">Efectivo contado</span><b>{cerrado ? soles(turnoDetalle.monto_cierre_real) : 'En caja'}</b></div>
                      <div>
                        <span className="block text-[11px] text-zinc-500">Diferencia</span>
                        {cerrado && turnoDetalle.diferencia !== null ? (
                          <b className={Number(turnoDetalle.diferencia) < 0 ? 'text-red-600' : Number(turnoDetalle.diferencia) > 0 ? 'text-blue-600' : 'text-emerald-600'}>
                            {soles(turnoDetalle.diferencia)}
                          </b>
                        ) : <b>-</b>}
                      </div>
                    </div>

                    {(retirosTurnoDetalle.length > 0 || !cerrado) && (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="text-sm font-bold text-zinc-700"><ArrowDownToLine className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Retiros de caja</h4>
                          {!cerrado && (
                            <button onClick={() => abrirRetiroAdmin(turnoDetalle)} className="bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">
                              + Retirar efectivo
                            </button>
                          )}
                        </div>
                        <div className="border border-zinc-200 rounded-xl overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-zinc-50 text-zinc-500 text-[11px] uppercase tracking-wider border-b border-zinc-200">
                              <tr><th className="p-3">Hora</th><th className="p-3">Motivo</th><th className="p-3">Autorizó</th><th className="p-3 text-right">Monto</th></tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                              {retirosTurnoDetalle.map(x => (
                                <tr key={x.id}>
                                  <td className="p-3 text-xs text-zinc-500 whitespace-nowrap">{fechaLocal(x.created_at)?.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                  <td className="p-3 text-xs text-zinc-800">{x.motivo}</td>
                                  <td className="p-3 text-xs text-zinc-600">{x.usuarios?.nombre_completo || '-'}</td>
                                  <td className="p-3 text-right font-bold text-indigo-700 whitespace-nowrap">-{soles(x.monto)}</td>
                                </tr>
                              ))}
                              {retirosTurnoDetalle.length === 0 && (
                                <tr><td colSpan="4" className="p-4 text-center text-zinc-400 text-xs">Este turno aún no tiene retiros.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-sm font-bold text-zinc-700 mb-2"><Package className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Productos vendidos</h4>
                      <div className="border border-zinc-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-50 text-zinc-500 text-[11px] uppercase tracking-wider border-b border-zinc-200">
                            <tr><th className="p-3">Producto</th><th className="p-3 text-center">Cant.</th><th className="p-3 text-right">Importe</th></tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {r.productos.map(pr => (
                              <tr key={pr.nombre + pr.marca}>
                                <td className="p-3 text-zinc-800">{pr.nombre}{pr.marca && <span className="text-xs text-zinc-400"> · {pr.marca}</span>}</td>
                                <td className="p-3 text-center font-bold">{pr.cantidad}</td>
                                <td className="p-3 text-right font-semibold text-emerald-700">{soles(pr.importe)}</td>
                              </tr>
                            ))}
                            {r.productos.length === 0 && (
                              <tr><td colSpan="3" className="p-5 text-center text-zinc-400 text-xs">Este turno no tiene ventas registradas.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-zinc-700 mb-2"><ReceiptText className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Ventas del turno</h4>
                      <div className="border border-zinc-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-50 text-zinc-500 text-[11px] uppercase tracking-wider border-b border-zinc-200">
                            <tr>
                              <th className="p-3">Hora</th><th className="p-3">Cliente</th><th className="p-3">Productos</th>
                              <th className="p-3">Medio de pago</th><th className="p-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {ventasTurnoDetalle.map(v => {
                              const bruto = (v.detalle_ventas || []).reduce((a, d) => a + Number(d.subtotal), 0)
                              const desc = Math.max(0, bruto - Number(v.total))
                              return (
                                <tr key={v.id} className="align-top">
                                  <td className="p-3 text-xs text-zinc-500 whitespace-nowrap">{fechaLocal(v.fecha_venta)?.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                                  <td className="p-3 text-xs">
                                    {v.clientes ? (<>{v.clientes.nombre}<span className="block text-zinc-400">{v.clientes.documento || ''}</span></>) : <span className="text-zinc-400">Consumidor final</span>}
                                  </td>
                                  <td className="p-3 text-xs text-zinc-700">{(v.detalle_ventas || []).map(d => `${d.cantidad}× ${d.productos?.nombre || 'Producto'}`).join(', ')}</td>
                                  <td className="p-3 text-xs">{etiquetaPago(v)}</td>
                                  <td className="p-3 text-right font-bold text-emerald-700 whitespace-nowrap">
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
          <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-200">
            <div className="flex justify-between items-center border-b pb-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-zinc-800"><TrendingUp className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Dashboard gerencial · Valkat Store</h2>
                <p className="text-xs text-zinc-500 mt-1">Análisis de rotación de productos y alertas operativas.</p>
              </div>
              <button onClick={() => setVistaAdmin('dashboard')} className="text-zinc-500 hover:text-zinc-800 font-medium text-sm">← Volver al Dashboard</button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="text-xs font-bold text-zinc-500 mr-1">Período de ventas:</span>
              {RANGOS_REPORTE.map(r => (
                <button
                  key={r.id}
                  onClick={() => cambiarRangoReporte(r.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${rangoReporte === r.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
                >
                  {r.etiqueta}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Catálogo</span>
                <h3 className="text-2xl font-bold tracking-tight text-zinc-900 mt-1">{listaProductosAdmin.length} productos</h3>
                <span className="text-xs text-blue-500 mt-1 block">Registrados en tienda (Ate)</span>
              </div>

              <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Stock Crítico (&lt; 5)</span>
                <h3 className="text-2xl font-bold tracking-tight text-amber-900 mt-1">
                  {listaProductosAdmin.filter(p => p.stock < 5).length} productos
                </h3>
                <span className="text-xs text-amber-600 mt-1 block">Requieren pedido de reposición</span>
              </div>

              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Categoría Destacada</span>
                <h3 className="text-xl font-bold tracking-tight text-emerald-900 mt-1">
                  {cargandoReporte ? 'Calculando...' : (resumenReporte.categorias[0]?.tipo || 'Sin ventas')}
                </h3>
                <span className="text-xs text-emerald-600 mt-1 block">
                  {resumenReporte.categorias[0]
                    ? `${resumenReporte.categorias[0].cantidad} unidades · ${soles(resumenReporte.categorias[0].importe)} (${etiquetaRangoReporte.toLowerCase()})`
                    : `Sin ventas en: ${etiquetaRangoReporte.toLowerCase()}`}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50">
                <h3 className="text-sm font-bold text-zinc-700 mb-4 flex items-center gap-2">
                  <Flame className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" /> Productos con Mayor Salida
                  <span className="text-[10px] font-normal text-zinc-400">({etiquetaRangoReporte})</span>
                </h3>
                {cargandoReporte ? (
                  <p className="text-xs text-zinc-400 text-center py-6">Calculando ventas...</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-3">
                      {resumenReporte.productos.slice(0, 5).map((prod, idx) => (
                        <div key={prod.nombre + prod.marca} className="bg-white p-3 rounded-xl border border-zinc-100 shadow-xs">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">#{idx + 1}</span>
                              <div>
                                <h4 className="font-bold text-zinc-800 text-xs">{prod.nombre}</h4>
                                <span className="text-[10px] text-zinc-400">Marca: {prod.marca || '-'} | Tipo: {prod.tipo}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold tracking-tight text-blue-700 text-xs">{prod.cantidad} und.</span>
                              <span className="block text-[10px] text-zinc-400">{soles(prod.importe)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-zinc-100 rounded-full mt-2">
                            <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${(prod.cantidad / resumenReporte.productos[0].cantidad) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                      {resumenReporte.productos.length === 0 && (
                        <p className="text-xs text-zinc-400 text-center py-6">Aún no hay ventas en este período.</p>
                      )}
                    </div>
                    {resumenReporte.productos.length > 0 && (
                      <p className="text-[11px] text-zinc-500 mt-4 pt-3 border-t border-zinc-200">
                        Total del período: <b>{resumenReporte.totalUnidades}</b> unidades · <b>{soles(resumenReporte.totalImporte)}</b> en {resumenReporte.productos.length} productos distintos
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50">
                <h3 className="text-sm font-bold text-zinc-700 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" /> Alertas de Stock Bajo (Menos de 5 unidades)
                </h3>
                <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                  {listaProductosAdmin.filter(p => p.stock < 5).map(prod => (
                    <div key={prod.id} className="bg-white p-3 rounded-xl border border-red-100 flex justify-between items-center shadow-xs">
                      <div>
                        <h4 className="font-bold text-zinc-800 text-xs">{prod.nombre}</h4>
                        <span className="text-[10px] text-zinc-400">Categoría: {prod.tipo}</span>
                      </div>
                      <span className="px-2.5 py-1 bg-red-100 text-red-700 font-bold text-xs rounded-full">
                        {prod.stock} unids.
                      </span>
                    </div>
                  ))}
                  {listaProductosAdmin.filter(p => p.stock < 5).length === 0 && (
                    <div className="text-center py-10 text-zinc-400 text-xs">
                      ¡Excelente! No hay productos con stock crítico en este momento.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 p-5 rounded-xl bg-zinc-50 mt-6">
              <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-700 flex items-center gap-2">
                    <Snowflake className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" /> Productos sin Rotación
                    <span className="text-[10px] font-normal text-zinc-400">({etiquetaRangoReporte})</span>
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-1">Tienen stock pero no se vendió ninguna unidad en el período.</p>
                </div>
                {!cargandoReporte && productosSinRotacion.length > 0 && (
                  <div className="text-right">
                    <span className="text-xs font-bold tracking-tight text-indigo-700">{productosSinRotacion.length} productos</span>
                    <span className="block text-[10px] text-zinc-500">{soles(valorSinRotacion)} en stock (a precio de venta)</span>
                  </div>
                )}
              </div>

              {cargandoReporte ? (
                <p className="text-xs text-zinc-400 text-center py-6">Calculando...</p>
              ) : productosSinRotacion.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-xs">
                  Todo el inventario con stock tuvo salida en este período.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[320px] overflow-y-auto pr-1">
                  {productosSinRotacion.map(prod => (
                    <div key={prod.id} className="bg-white p-3 rounded-xl border border-zinc-100 flex justify-between items-center shadow-xs">
                      <div>
                        <h4 className="font-bold text-zinc-800 text-xs">{prod.nombre}</h4>
                        <span className="text-[10px] text-zinc-400">{prod.marca} | {prod.tipo}</span>
                      </div>
                      <div className="text-right">
                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-full">{prod.stock} unids.</span>
                        <span className="block text-[10px] text-zinc-400 mt-1">{soles(prod.valorStock)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rangoReporte === 'hoy' && (
                <p className="text-[11px] text-zinc-400 mt-3">Con "Hoy" casi todo aparece sin rotación; usa 30 días o más para decidir reposiciones o promociones.</p>
              )}
            </div>
          </div>
        )}

        {/* VISTA DE PRODUCTOS (SOLO ADMIN) */}
        {vistaAdmin === 'productos' && (
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 bg-zinc-50 space-y-4">
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
                <div>
                  <h2 className="text-xl font-bold text-zinc-800">Inventario Global</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {productosAdminFiltrados.length} de {listaProductosAdmin.length} productos
                  </p>
                </div>
                <div className="flex gap-4 justify-end items-center">
                  <button onClick={() => setMostrarStockLocales(true)} className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-semibold py-2 px-4 rounded-lg transition text-sm">
                    <Package className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Stock y traslados
                  </button>
                  <button onClick={() => setMostrarGestorListas(true)} className="bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-semibold py-2 px-4 rounded-lg transition text-sm">
                    <Settings2 className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Categorías y marcas
                  </button>
                  <button onClick={abrirModalCrear} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg transition text-sm shadow-sm">
                    + Registrar Nuevo Producto
                  </button>
                  <button onClick={() => setVistaAdmin('dashboard')} className="text-zinc-500 hover:text-zinc-800 font-medium text-sm">← Volver</button>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text" placeholder="Buscar por nombre, marca, apodo, código de barras o ficha técnica…"
                    value={busquedaAdmin} onChange={(e) => setBusquedaAdmin(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && productosAdminFiltrados.length === 1) abrirModalEditar(productosAdminFiltrados[0]) }}
                    className="w-full pl-4 pr-10 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 bg-white"
                  />
                  {busquedaAdmin && (
                    <button onClick={() => setBusquedaAdmin('')} aria-label="Limpiar búsqueda" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"><X className="w-4 h-4" /></button>
                  )}
                </div>
                <select value={filtroStockAdmin} onChange={(e) => setFiltroStockAdmin(e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400">
                  <option value="todos">Todo el stock</option>
                  <option value="bajo">Stock bajo (menos de 5)</option>
                  <option value="agotado">Agotado</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-zinc-500 mr-1">Categoría:</span>
                {tiposAdmin.map(t => {
                  const activo = filtroTipoAdmin === t
                  const n = t === 'Todos' ? listaProductosAdmin.length : (conteoTiposAdmin[t] || 0)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFiltroTipoAdmin(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${activo ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
                    >
                      {t === 'Todos' ? 'Todas' : t} <span className={activo ? 'text-emerald-100' : 'text-zinc-400'}>({n})</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 text-zinc-600 text-sm sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-4 font-semibold w-24">Imagen</th>
                    <th className="p-4 font-semibold">Producto</th>
                    <th className="p-4 font-semibold">Marca</th>
                    <th className="p-4 font-semibold">Categoría</th>
                    <th className="p-4 font-semibold">Precio (S/)</th>
                    <th className="p-4 font-semibold">Stock</th>
                    <th className="p-4 font-semibold text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-sm">
                  {productosAdminFiltrados.map((prod) => {
                    const f = fichas[prod.id]
                    return (
                      <tr key={prod.id} className="hover:bg-zinc-50 transition">
                        <td className="p-3">
                          <MiniFoto url={f?.imagen_url} nombre={prod.nombre} tam="w-14 h-14" onClick={() => setImagenVista({ url: f.imagen_url, nombre: prod.nombre })} />
                        </td>
                        <td className="p-4">
                          <p className="font-medium text-zinc-800">{prod.nombre}</p>
                          {f?.apodos && <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-xs">{f.apodos}</p>}
                        </td>
                        <td className="p-4 text-blue-600 font-semibold">{prod.marca}</td>
                        <td className="p-4 text-zinc-500">{prod.tipo}</td>
                        <td className="p-4 font-bold text-emerald-700">S/ {prod.precio.toFixed(2)}</td>
                        <td className="p-4">
                          {prod.stock <= 0
                            ? <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-full">Agotado</span>
                            : prod.stock < 5
                              ? <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">Bajo · {prod.stock}</span>
                              : <span className="text-zinc-700">{prod.stock} unids.</span>}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => abrirModalEditar(prod)}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold px-3 py-1.5 rounded-lg text-xs transition"
                          >
                            <Pencil className="w-4 h-4 inline -mt-0.5 mr-1.5 text-zinc-500" />Editar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {productosAdminFiltrados.length === 0 && (
                    <tr>
                      <td colSpan="7" className="p-8 text-center text-zinc-400">
                        No se encontraron productos con esos filtros.
                        {hayFiltrosAdmin && <button onClick={limpiarFiltrosAdmin} className="ml-2 text-blue-600 font-semibold underline">Limpiar filtros</button>}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {imagenVista && (
              <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setImagenVista(null)}>
                <div className="bg-white rounded-xl p-3 max-w-xl w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <img src={imagenVista.url} alt={imagenVista.nombre} className="w-full max-h-[70vh] object-contain rounded-xl bg-zinc-50" />
                  <p className="text-center text-sm font-semibold text-zinc-800 mt-3">{imagenVista.nombre}</p>
                  <button onClick={() => setImagenVista(null)} className="mt-2 w-full py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-sm font-bold text-zinc-700">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VISTA DE USUARIOS */}
        {vistaAdmin === 'usuarios' && (
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
              <h2 className="text-xl font-bold text-zinc-800">Lista de Empleados</h2>
              <div className="flex gap-4">
                <button onClick={() => setMostrarFormNuevo(!mostrarFormNuevo)} className="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold py-2 px-4 rounded-lg transition text-sm">
                  {mostrarFormNuevo ? 'Cancelar' : '+ Nuevo Empleado'}
                </button>
                <button onClick={() => setVistaAdmin('dashboard')} className="text-zinc-500 hover:text-zinc-800 font-medium text-sm">← Volver</button>
              </div>
            </div>

            {mostrarFormNuevo && (
              <div className="p-6 bg-blue-50 border-b border-blue-100">
                <form onSubmit={crearNuevoUsuario} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-zinc-600 mb-1.5">Nombre Completo</label>
                    <input type="text" required value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="Ej. Ashly" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-zinc-600 mb-1.5">Correo Electrónico</label>
                    <input type="email" required value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="cajero@valkat.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 mb-1.5">Rol</label>
                    <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm">
                      <option value="cajero">Cajero</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-zinc-600 mb-1.5">Contraseña Temporal</label>
                    <input type="password" required value={nuevoPasswordCrear} onChange={(e) => setNuevoPasswordCrear(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm" placeholder="Min. 6 caracteres" />
                  </div>
                  <div className="md:col-span-3 flex justify-end">
                    <button type="submit" disabled={cargando} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg transition text-sm">
                      {cargando ? 'Guardando...' : 'Guardar Empleado'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 text-zinc-600 text-sm">
                  <tr>
                    <th className="p-4 font-semibold">Nombre Completo</th>
                    <th className="p-4 font-semibold">Correo</th>
                    <th className="p-4 font-semibold">Rango</th>
                    <th className="p-4 font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-sm">
                  {listaUsuarios.map((usuario) => (
                    <tr key={usuario.id} className="hover:bg-zinc-50 transition">
                      <td className="p-4 font-medium text-zinc-800">{usuario.nombre_completo}</td>
                      <td className="p-4 text-zinc-500">{usuario.email}</td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${usuario.rol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {usuario.rol.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4">
                        <button onClick={() => cambiarRolUsuario(usuario.id, usuario.rol)} className="text-sm bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-3 py-1 rounded transition">
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

          </div>
        </div>

        {mostrarStockLocales && (
          <StockLocales
            supabase={supabase}
            onCerrar={() => setMostrarStockLocales(false)}
            onCambio={cargarProductos}
          />
        )}

        {mostrarGestorListas && (
          <GestorListas
            supabase={supabase}
            onCerrar={() => setMostrarGestorListas(false)}
            onCambio={cargarProductos}
          />
        )}

        {/* MODAL DE PRODUCTO */}
        {mostrarModalProductoAdmin && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-lg border border-emerald-200 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-bold text-zinc-800 mb-1">
                {modoEdicion ? 'Editar producto existente' : 'Registrar nuevo producto'}
              </h3>
              <form onSubmit={guardarProductoAdmin} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Nombre del Producto</label>
                  <input type="text" required placeholder="Ej. Cámara Domo 4K Hikvision" value={prodNombre} onChange={(e) => setProdNombre(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Marca</label>
                  <select required value={prodMarca} onChange={(e) => setProdMarca(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                    {(prodMarca && !listaMarcas.includes(prodMarca) ? [prodMarca, ...listaMarcas] : listaMarcas).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Categoría (Tipo)</label>
                  <select value={prodTipo} onChange={(e) => setProdTipo(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm bg-white">
                    {(prodTipo && !listaCategorias.includes(prodTipo) ? [prodTipo, ...listaCategorias] : listaCategorias).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2 -mt-2 text-right">
                  <button type="button" onClick={() => setMostrarGestorListas(true)} className="text-xs font-bold text-emerald-700 hover:underline">
                    ¿Falta una marca o categoría? Gestionar listas
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Precio de Venta (S/)</label>
                  <input type="number" step="0.10" required placeholder="0.00" value={prodPrecio} onChange={(e) => setProdPrecio(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Stock en tienda</label>
                  <input type="number" required placeholder="10" value={prodStock} onChange={(e) => setProdStock(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div className="md:col-span-2">
                  <SelectorImagen urlActual={prodImagenUrl} onArchivo={setProdImagenArchivo} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Apodos y N.º de panel (separados por coma)</label>
                  <input type="text" placeholder="Ej. 5, robot, giratoria, interior" value={prodApodos} onChange={(e) => setProdApodos(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Código de barras (escanea con el lector o escribe)</label>
                  <div className="flex gap-2">
                    <input type="text" inputMode="numeric" placeholder="Ej. 6939554912345" value={prodCodigo} onChange={(e) => setProdCodigo(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" />
                    <button type="button" onClick={() => setMostrarEscaner(true)} className="shrink-0 bg-zinc-800 hover:bg-zinc-900 text-white font-bold px-4 rounded-xl text-sm">Escanear</button>
                  </div>
                  {mostrarEscaner && (
                    <EscanerCodigo
                      onCodigo={(c) => { setProdCodigo(c); setMostrarEscaner(false) }}
                      onCerrar={(msg) => { setMostrarEscaner(false); if (msg) notificar(msg, 'aviso') }}
                    />
                  )}
                </div>
                <div className="md:col-span-2">
                  <SpecsEditor key={prodIdEditando ?? 'nuevo'} inicial={prodSpecs} tipo={prodTipo} onChange={setProdSpecs} />
                </div>
                <div className="md:col-span-2 flex gap-3 mt-4">
                  <button type="button" onClick={() => setMostrarModalProductoAdmin(false)} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl transition text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition text-sm shadow-md">Guardar</button>
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
      <div className="min-h-screen bg-zinc-50 p-4 lg:p-6">
        {capaGlobal}
        <div className="flex justify-between items-center bg-white px-4 py-3 rounded-xl border border-zinc-200 mb-5">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain rounded-md" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-zinc-900">Valkat Store</p>
              <p className="text-[11px] text-zinc-500">Módulo de caja</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TrasladosPorRecibir supabase={supabase} userId={session?.user?.id} onCambio={cargarProductos} />
            {botonTema}
              <button onClick={cerrarSesion} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition">
              <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>

        {!turnoAbierto ? (
          <div className="max-w-sm mx-auto bg-white p-6 rounded-xl border border-zinc-200 shadow-sm mt-16">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><Wallet className="w-5 h-5" /></div>
            <h2 className="mt-4 text-base font-semibold text-zinc-900">Apertura de turno</h2>
            <p className="text-xs text-zinc-500 mt-1 mb-5">Ingresa el monto de sencillo con el que inicias el día.</p>
            <form onSubmit={abrirCajaTurno} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">Monto inicial (sencillo)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">S/</span>
                  <input
                    type="number" step="0.10" required
                    value={montoApertura} onChange={(e) => setMontoApertura(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <button type="submit" disabled={cargando} className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm">
                {cargando ? 'Abriendo caja...' : 'Abrir caja y empezar a vender'}
              </button>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
            
            {/* CATÁLOGO, BUSCADOR Y FILTROS */}
            <div className="bg-white p-5 rounded-xl border border-zinc-200">
              <div className="flex flex-wrap justify-between items-center gap-3 border-b border-zinc-200 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Caja abierta</span>
                  <p className="text-xs text-zinc-500">Sencillo inicial: <span className="font-semibold text-zinc-900">S/ {turnoAbierto.monto_apertura}</span></p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setMostrarModalRetiro(true)} className="inline-flex items-center gap-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs font-medium px-3 py-2 rounded-lg transition">
                    <ArrowDownToLine className="w-3.5 h-3.5" /> Retiro de caja
                  </button>
                  <button onClick={() => setMostrarModalCierre(true)} className="inline-flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium px-3 py-2 rounded-lg transition">
                    <Lock className="w-3.5 h-3.5" /> Cerrar caja / Cuadre
                  </button>
                </div>
              </div>

              {/* BARRA DE BÚSQUEDA Y FILTROS */}
              <div className="flex flex-col md:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <input 
                    type="text" placeholder="Buscar por nombre, marca, apodo o escanear código de barras…" 
                    value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={alBuscarEnter}
                    className="w-full pl-9 pr-10 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 bg-white"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                  {busqueda && (
                    <button onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"><X className="w-4 h-4" /></button>
                  )}
                </div>
                <select 
                  value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
                  className="px-4 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 bg-zinc-50 font-medium text-zinc-700"
                >
                  <option value="Todos">Todas las categorías</option>
                  {listaCategorias.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* GRILLA DE PRODUCTOS */}
              <p className="text-xs text-zinc-400 mb-2">
                {productosFiltrados.length} producto{productosFiltrados.length === 1 ? '' : 's'}
                {busqueda.trim() && ' · Enter agrega el producto si hay una sola coincidencia'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[calc(100vh-330px)] min-h-[320px] overflow-y-auto pr-1 content-start">
                {productosFiltrados.map(prod => (
                  <div key={prod.id} className="border border-zinc-200 bg-white p-3 rounded-xl flex flex-col justify-between hover:border-zinc-200 hover:shadow-sm transition">
                    <div className="flex gap-3">
                      <MiniFoto url={fichas[prod.id]?.imagen_url} nombre={prod.nombre} tam="w-16 h-16" />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{prod.marca}</span>
                          <span className={`text-xs font-bold ${prod.stock < 5 ? 'text-red-500' : 'text-zinc-400'}`}>Stock: {prod.stock}</span>
                        </div>
                        <h4 className="font-bold text-zinc-800 mt-1.5 text-sm leading-snug">{prod.nombre}</h4>
                        <p className="text-xs text-zinc-500">{prod.tipo}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-3 pt-3 border-t">
                      <span className="font-bold text-zinc-900 tabular-nums">S/ {prod.precio.toFixed(2)}</span>
                      <button 
                        onClick={() => agregarAlCarrito(prod)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                      >
                        <Plus className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />Agregar
                      </button>
                    </div>
                  </div>
                ))}
                {productosFiltrados.length === 0 && (
                  <div className="col-span-2 text-center py-10 text-zinc-400 text-sm">
                    No se encontraron productos con ese filtro o búsqueda.
                  </div>
                )}
              </div>
            </div>

            {/* CARRITO Y DESCUENTOS */}
            <div className="bg-white p-5 rounded-xl border border-zinc-200 flex flex-col justify-between lg:sticky lg:top-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 border-b border-zinc-200 pb-3 mb-3">Venta actual</h3>

                {/* CLIENTE DE LA VENTA */}
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-zinc-600">Cliente</label>
                    <button type="button" onClick={() => setMostrarModalCliente(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Nuevo cliente</button>
                  </div>

                  {clienteSeleccionado ? (
                    <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-zinc-900 truncate">{clienteSeleccionado.nombre}</p>
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
                        className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
                      />
                      {mostrarListaClientes && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-zinc-200 rounded-xl shadow-md max-h-48 overflow-y-auto">
                          {clientesFiltrados.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={() => { setClienteSeleccionado(c); setBusquedaCliente(''); setMostrarListaClientes(false) }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-zinc-100 last:border-0"
                            >
                              <p className="text-xs font-semibold text-zinc-800">{c.nombre}</p>
                              <p className="text-[11px] text-zinc-500">{c.documento || 'Sin documento'}{c.telefono ? ` · ${c.telefono}` : ''}</p>
                            </button>
                          ))}
                          {clientesFiltrados.length === 0 && (
                            /^\d{8}$|^\d{11}$/.test(busquedaCliente.trim()) ? (
                            <button
                              type="button"
                              onMouseDown={() => registrarDesdeBusqueda(busquedaCliente.trim())}
                              className="w-full text-left px-3 py-3 hover:bg-blue-50"
                            >
                              <p className="text-xs font-bold text-blue-700">Consultar {busquedaCliente.trim().length === 8 ? 'DNI' : 'RUC'} {busquedaCliente.trim()}</p>
                              <p className="text-[11px] text-zinc-500">No está registrado. Se buscará en RENIEC/SUNAT.</p>
                            </button>
                          ) : (
                            <p className="px-3 py-3 text-xs text-zinc-400 text-center">Sin coincidencias. Usa "+ Nuevo cliente".</p>
                          )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="max-h-[230px] overflow-y-auto divide-y divide-zinc-100 pr-1">
                  {carrito.map(item => (
                    <div key={item.id} className="py-3 flex justify-between items-center">
                      <div>
                        <h4 className="text-sm font-semibold text-zinc-800">{item.nombre}</h4>
                        <p className="text-xs text-zinc-500">S/ {item.precio.toFixed(2)} c/u</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => cambiarCantidad(item.id, -1)} className="w-6 h-6 bg-zinc-100 rounded text-zinc-600 font-bold hover:bg-zinc-200">-</button>
                        <span className="text-sm font-bold w-4 text-center">{item.cantidad}</span>
                        <button onClick={() => cambiarCantidad(item.id, 1)} className="w-6 h-6 bg-zinc-100 rounded text-zinc-600 font-bold hover:bg-zinc-200">+</button>
                      </div>
                    </div>
                  ))}
                  {carrito.length === 0 && (
                    <p className="text-center text-zinc-400 py-8 text-sm">El carrito está vacío.</p>
                  )}
                </div>
              </div>

              {/* CAMPO DE DESCUENTO */}
              <div className="border-t pt-3 mt-2 bg-zinc-50 p-3 rounded-xl">
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">Descuento (S/)</label>
                <input 
                  type="number" step="0.50" min="0" placeholder="0.00"
                  value={descuentoMonto} onChange={(e) => setDescuentoMonto(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
                />
              </div>

              <div className="border-t pt-3 mt-2">
                <div className="flex justify-between items-center mb-1 text-xs text-zinc-500">
                  <span>Subtotal:</span>
                  <span>S/ {calcularSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mb-2 text-xs text-red-500">
                  <span>Descuento:</span>
                  <span>- S/ {Number(descuentoMonto || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mb-4 border-t pt-2">
                  <span className="font-bold text-zinc-700">Total a Pagar:</span>
                  <span className="text-xl font-bold tracking-tight text-emerald-700">S/ {calcularTotalFinal()}</span>
                </div>
                <button 
                  disabled={carrito.length === 0 || cargando}
                  onClick={procesarCobro}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 text-white font-bold py-3 rounded-xl transition shadow-md text-sm"
                >
                  {cargando ? 'Procesando...' : 'Cobrar Pedido'}
                </button>
              </div>
            </div>

          </div>
        )}

        {/* MODAL DE SELECCIÓN DE MEDIO DE PAGO */}
        {mostrarModalCobro && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-emerald-200">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><CreditCard className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Seleccionar Medio de Pago</h3>
              <p className="text-xs text-zinc-500 text-center mb-4">Total a cobrar: <span className="font-bold tracking-tight text-emerald-700">S/ {calcularTotalFinal()}</span></p>

              <div className="flex flex-col gap-3 mb-4">
                <label className="block text-xs font-bold text-zinc-600">Método de Pago Principal</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Efectivo', 'Yape / Plin', 'Tarjeta POS', 'Mixto'].map(metodo => (
                    <button
                      key={metodo}
                      type="button"
                      onClick={() => setMetodoPago(metodo)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition ${metodoPago === metodo ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'}`}
                    >
                      {metodo === 'Mixto' ? 'Pago mixto' : metodo}
                    </button>
                  ))}
                </div>
              </div>

              {metodoPago === 'Mixto' && (
                <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl mb-4 flex flex-col gap-3">
                  <span className="text-xs font-bold text-zinc-900">Desglose de Pago Mixto</span>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Monto en Efectivo (S/)</label>
                    <input 
                      type="number" step="0.10" placeholder="0.00" 
                      value={montoEfectivoMixto} onChange={(e) => setMontoEfectivoMixto(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Monto en Yape / Plin (S/)</label>
                    <input 
                      type="number" step="0.10" placeholder="0.00" 
                      value={montoYapeMixto} onChange={(e) => setMontoYapeMixto(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => setMostrarModalCobro(false)} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                <button type="button" disabled={cargando} onClick={finalizarVentaConPago} className="w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                  {cargando ? 'Registrando...' : 'Confirmar Cobro'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO CLIENTE */}
        {mostrarModalCliente && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-blue-200">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><UserRound className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Registrar Cliente</h3>
              <p className="text-xs text-zinc-500 text-center mb-4">Se asignará automáticamente a la venta actual.</p>

              <form onSubmit={guardarCliente} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Nombre o Razón Social *</label>
                  <input type="text" required value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Ej: Juan Pérez" className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">DNI / RUC (opcional)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={clienteDocumento}
                      onChange={(e) => { setClienteDocumento(e.target.value); setDatosConsultados(false) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); consultarDocumento() } }}
                      placeholder="DNI (8 dígitos) o RUC (11)"
                      className="flex-1 px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-400"
                    />
                    <button
                      type="button"
                      onClick={() => consultarDocumento()}
                      disabled={consultandoDocumento}
                      className="px-3 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 text-white text-xs font-bold rounded-xl whitespace-nowrap transition"
                    >
                      {consultandoDocumento ? 'Consultando...' : 'Consultar'}
                    </button>
                  </div>
                  <p className={`text-[11px] mt-1 ${datosConsultados ? 'text-emerald-600 font-semibold' : 'text-zinc-400'}`}>
                    {datosConsultados ? 'Datos obtenidos de RENIEC/SUNAT. Puedes corregirlos si hace falta.' : 'Escribe el documento y pulsa Consultar para traer el nombre automáticamente.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Teléfono (opcional)</label>
                  <input type="tel" value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="Celular" className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm" />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalCliente} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                    {cargando ? 'Guardando...' : 'Guardar y Usar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL DE CUADRE Y CIERRE DE CAJA */}
        {mostrarModalCierre && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-amber-300">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><Calculator className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Cuadre y Cierre de Turno</h3>
              <p className="text-xs text-zinc-500 text-center mb-4">Cuenta el efectivo físico en caja e ingrésalo junto a tu contraseña.</p>

              <form onSubmit={confirmarCierreCaja} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Efectivo Real en Caja (S/)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-2.5 text-zinc-500 font-bold text-sm">S/</span>
                    <input 
                      type="number" step="0.10" required 
                      placeholder="0.00" value={efectivoRealCaja} onChange={(e) => setEfectivoRealCaja(e.target.value)} 
                      className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm" 
                    />
                  </div>
                  <span className="text-[11px] text-zinc-400 mt-1 block">Sencillo inicial registrado: S/ {turnoAbierto?.monto_apertura}</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Tu Contraseña de Autorización</label>
                  <input 
                    type="password" required 
                    placeholder="Contraseña actual" value={passwordCierre} onChange={(e) => setPasswordCierre(e.target.value)} 
                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm" 
                  />
                </div>

                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={() => { setMostrarModalCierre(false); setPasswordCierre(''); }} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl text-sm shadow-md">
                    {cargando ? 'Calculando y cerrando...' : 'Confirmar Cierre'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL RETIRO DE CAJA (AUTORIZADO POR UN ADMIN) */}
        {mostrarModalRetiro && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-indigo-200">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><ArrowDownToLine className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Retiro de Caja</h3>
              <p className="text-xs text-zinc-500 text-center mb-5">Un Administrador debe autorizar el retiro con sus credenciales.</p>

              <form onSubmit={registrarRetiroCajero} autoComplete="off" className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Monto a retirar (S/)</label>
                  <input type="number" step="0.01" min="0.01" required autoComplete="off" placeholder="0.00" value={retiroMonto} onChange={(e) => setRetiroMonto(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Motivo</label>
                  <input type="text" required autoComplete="off" placeholder="Ej: Depósito al banco, pago a proveedor" value={retiroMotivo} onChange={(e) => setRetiroMotivo(e.target.value)} className={claseInputModal} />
                </div>

                <div className="border-t pt-3 mt-1 flex flex-col gap-3">
                  <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Autorización del administrador</p>
                  <input type="email" name="admin-retiro-correo" autoComplete="off" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa el correo del administrador" value={retiroEmailAdmin} onChange={(e) => setRetiroEmailAdmin(e.target.value)} className={claseInputModal} />
                  <input type="password" name="admin-retiro-clave" autoComplete="new-password" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa la contraseña del administrador" value={retiroPasswordAdmin} onChange={(e) => setRetiroPasswordAdmin(e.target.value)} className={claseInputModal} />
                </div>

                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={cerrarModalesRetiro} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
                  <button type="submit" disabled={cargando} className="w-1/2 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 rounded-xl text-sm shadow-md">
                    {cargando ? 'Validando...' : 'Autorizar retiro'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL DE DESCUENTO ALTO */}
        {mostrarModalDescuento && (
          <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-red-300">
              <div className="flex justify-center mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700"><ShieldCheck className="w-5 h-5" /></span></div>
              <h3 className="text-lg font-bold text-zinc-800 text-center mb-1">Autorización Requerida</h3>
              <p className="text-xs text-zinc-500 text-center mb-6">El descuento supera los S/ 20.00. Un Administrador debe ingresar sus datos.</p>

              <form onSubmit={autorizarDescuentoAlto} autoComplete="off" className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Correo del Administrador</label>
                  <input type="email" name="admin-descuento-correo" autoComplete="off" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa el correo del administrador" value={emailAdminDesc} onChange={(e) => setEmailAdminDesc(e.target.value)} className={claseInputModal} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Contraseña del Administrador</label>
                  <input type="password" name="admin-descuento-clave" autoComplete="new-password" data-lpignore="true" data-1p-ignore readOnly onFocus={(e) => e.target.removeAttribute('readonly')} required placeholder="Ingresa la contraseña del administrador" value={passwordAdminDesc} onChange={(e) => setPasswordAdminDesc(e.target.value)} className={claseInputModal} />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="button" onClick={() => { setMostrarModalDescuento(false); setEmailAdminDesc(''); setPasswordAdminDesc(''); }} className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-xl text-sm">Cancelar</button>
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