const LOG_KEY = Symbol.for("ltm-claw/startup-logged");

/** Emit a startup/config banner only once per process. */
export function logStartupBannerOnce(params: {
  key?: string | symbol;
  log: (message: string) => void;
  message: string;
}): void {
  const k = params.key ?? LOG_KEY;
  if ((globalThis as Record<symbol, boolean>)[k]) return;
  (globalThis as Record<symbol, boolean>)[k] = true;
  params.log(params.message);
}
