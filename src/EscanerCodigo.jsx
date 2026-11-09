// src/EscanerCodigo.jsx  (POS de Valkat)
// Abre la cámara a pantalla completa y devuelve el código leído.
// npm i html5-qrcode
import { useEffect } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from 'html5-qrcode'

export default function EscanerCodigo({ onCodigo, onCerrar }) {
  useEffect(() => {
    let scanner
    // setTimeout evita el doble arranque del modo estricto de React en desarrollo
    const t = setTimeout(() => {
      scanner = new Html5Qrcode('lector-pos', {
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.CODE_128, F.CODE_39, F.QR_CODE],
        verbose: false,
      })
      let leido = false
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 140 } },
          (texto) => {
            if (leido) return
            leido = true
            navigator.vibrate?.(60)
            scanner.stop().finally(() => onCodigo(texto))
          },
          () => {}
        )
        .catch(() => onCerrar('No se pudo abrir la cámara. Revisa los permisos del navegador y que la página use HTTPS.'))
    }, 0)

    return () => {
      clearTimeout(t)
      if (scanner?.isScanning) scanner.stop().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div id="lector-pos" className="flex-1" />
      <button type="button" onClick={() => onCerrar()} className="bg-white p-4 font-bold text-gray-800">
        Cancelar
      </button>
    </div>
  )
}
