import type { VerifactuSubmitResult } from './client'
import { prepareDurableVerifactuRecord, type DurableVerifactuRecord } from './durable'
import { createVerifactuClient } from './facade'
import { noopLogger, type VerifactuLogger } from './logger'
import type { VerifactuConfig } from './types'

/**
 * Verify and deliver one immutable ledger record.
 *
 * The consuming app only loads/claims the record and persists the typed result;
 * payload decoding, SIF snapshot selection, hash verification and Alta versus
 * Anulación dispatch remain inside the package.
 */
export async function deliverDurableVerifactuRecord(
  record: DurableVerifactuRecord,
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): Promise<VerifactuSubmitResult> {
  const prepared = prepareDurableVerifactuRecord(record, config.software)
  const client = createVerifactuClient({ ...config, software: prepared.software }, logger)
  const result =
    prepared.recordType === 'alta'
      ? await client.registerInvoice(prepared.input)
      : await client.cancelInvoice(prepared.input)

  if (result.hash !== record.currentHash) {
    throw new Error('La huella devuelta por VERI*FACTU no coincide con el ledger')
  }
  return result
}
