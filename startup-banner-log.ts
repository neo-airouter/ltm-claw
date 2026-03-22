const LOG_KEY = Symbol.for("ltm-claw/startup-logged");

type Logger = { info: (msg: string) => void };

export function logStartupBannerOnce(msg: string, logger?: Logger): void {
  if ((globalThis as Record<symbol, boolean>)[LOG_KEY]) return;
  (globalThis as Record<symbol, boolean>)[LOG_KEY] = true;
  if (logger) {
    logger.info(msg);
  } else {
    console.log(msg);
  }
}
