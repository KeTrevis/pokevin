// Keep the official preamble and modules intact for independent engine parity checks.
function nativeCore(source, stop = 'Underground') {
  const namespace = source.match(/([\w$]+)\.POKEDEX=/)?.[1];
  const end = namespace ? source.indexOf(`,${namespace}.${stop}=`) : -1;
  if (end < 0) throw new Error('Native game modules not found');
  return source.slice(0, end) + `;globalThis.Reference=${namespace};})();`;
}
module.exports = { nativeCore };
