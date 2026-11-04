// Replaces packages that aren't needed to check start-up order.
export async function resolve(specifier, context, next) {
  if (specifier === 'socket.io-client') {
    return {
      url: 'data:text/javascript,export const io = () => ({ on(){}, off(){}, emit(){}, connect(){}, disconnect(){}, connected:false, io:{ on(){} } });',
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
