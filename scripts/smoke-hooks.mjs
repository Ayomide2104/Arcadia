// Start-up smoke test helpers.
// - socket.io-client is always replaced (no network needed to check start-up order).
// - motion, auto-animate and confetti use the real packages when they are installed;
//   if they are missing (for example in a bare checkout) simple stand-ins are used so the check still runs.
const STANDINS = {
  'motion': 'export const animate = () => ({ finished: Promise.resolve(), stop() {} });',
  '@formkit/auto-animate': 'export default function autoAnimate() { return { enable() {}, disable() {}, isEnabled() { return true; } }; }',
  'canvas-confetti': 'export default function confetti() { return Promise.resolve(); }',
};
const asModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

export async function resolve(specifier, context, next) {
  if (specifier === 'socket.io-client') {
    return { url: asModule('export const io = () => ({ on(){}, off(){}, emit(){}, connect(){}, disconnect(){}, connected:false, io:{ on(){} } });'), shortCircuit: true };
  }
  if (STANDINS[specifier]) {
    try { return await next(specifier, context); }
    catch { return { url: asModule(STANDINS[specifier]), shortCircuit: true }; }
  }
  return next(specifier, context);
}
