/**
 * Logger port for the Verifactu module.
 *
 * The module must not depend on any concrete logger (pino, console, …) so it
 * stays framework-agnostic and extractable to a standalone package. Consumers
 * inject anything structurally compatible with `VerifactuLogger`; pino's
 * `Logger` satisfies it out of the box. When no logger is passed, `noopLogger`
 * is used and the module emits nothing.
 */
export type VerifactuLogFn = (obj: Record<string, unknown>, msg?: string) => void;

export type VerifactuLogger = {
  debug: VerifactuLogFn;
  info: VerifactuLogFn;
  warn: VerifactuLogFn;
  error: VerifactuLogFn;
};

export const noopLogger: VerifactuLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
