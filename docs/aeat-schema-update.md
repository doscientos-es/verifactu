# Procedimiento de actualización AEAT

AEAT publica por separado los esquemas, el WSDL, las validaciones/errores y las especificaciones del servicio. No se debe sustituir un XSD en producción sin revisar todos esos documentos.

## Comprobación periódica

Ejecutar desde este paquete:

```bash
pnpm check:schemas
```

El comando descarga los dos XSD públicos, normaliza únicamente la importación local de XMLDSig y compara SHA-256 con los ficheros versionados en `src/schemas`. Si hay diferencias, termina con código distinto de cero.

## Cuando cambie AEAT

1. Guardar la nueva versión de los XSD en una rama.
2. Revisar también el [documento de validaciones y errores](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/documento-validaciones-errores.html), el WSDL y las especificaciones del servicio.
3. Regenerar los fixtures XML y añadir casos para cada etiqueta/regla nueva o modificada.
4. Ejecutar `pnpm check:schemas`, `pnpm typecheck`, `pnpm test` y `pnpm build`.
5. Probar en el entorno externo de AEAT antes de producción.
6. Publicar una nueva versión del paquete y actualizar la declaración responsable del SIF si el cambio afecta al producto o a su comportamiento fiscal.
7. Desplegar primero en staging y conservar el hash de los XSD, la versión del paquete y los resultados de las pruebas.

El proceso falla deliberadamente ante cambios no revisados: no actualiza ficheros automáticamente ni permite convertir una actualización externa en un cambio silencioso.
