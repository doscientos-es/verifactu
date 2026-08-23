# Integración reutilizable de VERI*FACTU

Esta guía es la receta para integrar `@doscientos/verifactu` en un cliente nuevo
sin volver a implementar reglas fiscales ni copiar el backoffice de Doscientos.

## Qué resuelve el paquete

- Alta y Anulación AEAT, XML, XSD, QR y SHA-256.
- Subsanación y Alta por rechazo (`Subsanacion=S`, `RechazoPrevio=X`).
- Decodificación y validación cerrada del payload fiscal inmutable.
- Snapshot del SIF, verificación de huella y despacho Alta/Anulación.
- Clasificación de reintentos, errores AEAT, duplicados y tiempos de espera.
- Consulta censal VNif con fallback entre endpoints oficiales.

La aplicación solo conserva cuatro responsabilidades:

1. Mapear su factura al contrato fiscal del paquete.
2. Añadir ledger y outbox atómicamente en su base de datos.
3. Reclamar un trabajo y persistir el resultado devuelto por el paquete.
4. Mostrar QR, estado y errores en su UI.

## Receta para un proyecto nuevo

### 1. Instalar y configurar

```bash
pnpm add @doscientos/verifactu
```

Copiar `config.example.ts` a la aplicación y mapear estas variables:

- `VERIFACTU_ENV`: `mock`, `test` o `prod`.
- `VERIFACTU_CERT_P12_BASE64` y `VERIFACTU_CERT_PASSWORD`.
- Identidad registrada del productor y del SIF.
- URL pública de la aplicación.

Nunca exponer certificado, contraseña ni configuración SIF en código cliente.

### 2. Crear un único mapper de factura

El mapper debe devolver `VerifactuSubmitInput`. Es el único lugar que conoce el
modelo de factura de la aplicación. Debe incluir emisor, destinatario, importes,
desglose de IVA, fecha, número y referencia al registro global anterior.

No calcular XML, QR ni hashes en componentes, acciones o controladores.

### 3. Persistir antes de enviar

En producción no se debe llamar a AEAT directamente desde «Emitir». La misma
transacción debe:

1. Bloquear la cadena del emisor.
2. Leer el último registro global por `chain_sequence`.
3. Crear el payload fiscal inmutable con snapshot del SIF.
4. Insertar ledger y outbox.
5. Confirmar la emisión de la factura.

Restricciones mínimas recomendadas:

- `unique (issuer_nif, chain_sequence)`.
- Ledger append-only; nunca actualizar ni borrar registros fiscales.
- Una fila outbox por registro ledger.
- `previous_ledger_id`, `previous_hash` y `current_hash` obligatorios según cadena.
- Estados: `pending`, `processing`, `retryable_error`, `accepted`, `rejected`,
  `terminal_error`.

### 4. Entregar con una sola llamada

Después de reclamar una fila, cargar su ledger y llamar:

```ts
const result = await deliverDurableVerifactuRecord(
  {
    recordType: ledger.record_type,
    currentHash: ledger.current_hash,
    payload: ledger.record_payload,
    incidence: outbox.incidence,
  },
  verifactuConfigFromEnv(),
  logger,
);
```

Esta función selecciona el snapshot SIF, decodifica el payload, recalcula la
huella, falla si el ledger fue alterado y envía Alta o Anulación.

La aplicación solo persiste campos tipados del resultado: `status`, `csv`,
`aeatCode`, `errorCode`, `errorMessage`, `warnings` y la respuesta minimizada con
`sanitizeVerifactuResponse`. Nunca guardar SOAP crudo ni secretos.

### 5. Reintentos y cron

- Usar `isRetryableVerifactuDelivery(result)`; no interpretar textos.
- Respetar `verifactuWaitSeconds(result)` y el control de flujo por emisor.
- Procesar secuencialmente cada cadena.
- Un timeout o respuesta inválida puede reintentarse con el mismo registro.
- Una respuesta duplicada cuyo registro previo es correcto es éxito idempotente.
- Un rechazo definitivo nunca reenvía el mismo Alta: crea una regularización.

## Flujos fiscales

### Alta normal

- Nuevo registro append-only.
- Encadena al último registro global del emisor, no al último de la factura.
- No enviar `Subsanacion` ni `RechazoPrevio` normales.

### Alta por rechazo

Si AEAT nunca registró el Alta rechazado:

- Corregir y volver a validar los datos del destinatario.
- Crear otro Alta inmutable con `subsanacion: "S"` y `rechazoPrevio: "X"`.
- Encadenarlo al último registro global generado.
- No modificar ni borrar el registro rechazado.

### Anulación

- Localizar la última Alta de esa factura que AEAT aceptó.
- Crear un `RegistroAnulacion` nuevo en la cadena global.
- No anular una Alta rechazada o inexistente en AEAT.

## VNif y UI

- Validar NIF y razón social con `validateSpanishFiscalIdentity` antes de emitir
  o regularizar una F1 española.
- Guardar fecha, NIF y nombre exactos verificados; invalidar la comprobación si
  cambian.
- Importar metadatos de error en UI desde `@doscientos/verifactu/errors`, que es
  browser-safe. El resto de entradas son server-only.

## Checklist antes de producción

- Suite en `mock` y AEAT `test` con certificado de preproducción.
- Alta, timeout/reintento, duplicado, rechazo y Alta por rechazo.
- Anulación de la última Alta aceptada.
- Dos facturas intercaladas para comprobar cadena global.
- Cero secuencias duplicadas y cero enlaces de hash rotos.
- Cron autenticado, bloqueo por emisor y recuperación de locks caducados.
- Certificado y secretos solo en servidor.
- PDF y portal consumen el QR persistido del ledger.

## Referencia actual

El adaptador Supabase de referencia vive en `internal/backoffice`:

- `lib/verifactu/outbox.ts`: adaptador fino de entrega.
- `supabase/migrations/*verifactu*.sql`: ledger, outbox y RPC atómicas.
- `app/api/cron/verifactu-outbox/route.ts`: worker programado.

Para otro cliente se reutiliza el paquete y se adapta únicamente el mapper y las
RPC a su esquema de facturas. No copiar lógica fiscal a Server Actions o UI.