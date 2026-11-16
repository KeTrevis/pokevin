// @ts-check
/* Read-only adapter for SaveWire FMT 2 from the official game (app.c0081498f2.js).
 * Keep storage decoding separate from simulation validation; old saves still work. */
(() => {
  /** @param {unknown} value @returns {value is Record<string, any>} */
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  /** @param {unknown} uid */
  const uidTime = uid => typeof uid === 'string' && /^[0-9a-z]{8}/.test(uid)
    ? parseInt(uid.slice(0, 8), 36) : NaN;

  /** @param {string} raw @returns {import('./types/domain').Save} */
  function parse(raw) {
    const save = JSON.parse(raw);
    if (!object(save) || save.fmt !== 2 || !object(save.mz)) return save;
    const wire = save.mz;
    const regions = Array.isArray(wire.r) ? wire.r : [];
    const places = Array.isArray(wire.w) ? wire.w : [];
    delete save.fmt;
    delete save.mz;
    save.mons = Array.isArray(wire.m) ? wire.m.map(/** @param {unknown} value */ value => {
      if (!Array.isArray(value)) return value;
      /** @type {Record<string, any>} */
      const mon = { shiny: false };
      for (const [index, key] of ['uid', 'id', 'level', 'xp'].entries()) {
        if (value[index] != null) mon[key] = value[index];
      }
      if (value[4] != null) mon.reg = regions[value[4]];
      if (value[5] != null) mon.where = places[value[5]];
      const time = uidTime(value[0]);
      if (Number.isSafeInteger(value[6]) && Math.abs(value[6]) < 1e15 && Number.isSafeInteger(time)) {
        mon.caughtAt = time + value[6];
      }
      if (object(value[7])) Object.assign(mon, value[7]);
      return mon;
    }) : [];
    if (wire.dx === 1 && object(save.dex)) {
      save.dex = Object.fromEntries(Object.entries(save.dex).map(([id, value]) => {
        if (!Array.isArray(value)) return [id, value];
        /** @type {Record<string, any>} */
        const entry = {};
        if (Number.isSafeInteger(value[2]) && value[2] >= 0) {
          entry.regs = {};
          for (let index = 0; index < regions.length; index++) {
            if (value[2] & (1 << index)) entry.regs[regions[index]] = 1;
          }
        }
        for (const [index, key] of ['caught', 'firstAt', '', 'shiny', 'n'].entries()) {
          if (key && value[index] != null) entry[key] = value[index];
        }
        return [id, entry];
      }));
    }
    if (Array.isArray(wire.s)) {
      save.seen = Object.fromEntries([...Object.keys(object(save.dex) ? save.dex : {}), ...wire.s]
        .map(id => [id, true]));
    }
    if (Array.isArray(wire.o)) {
      save.pcOrder = wire.o.map(/** @param {unknown} value */ value => Number.isSafeInteger(value)
        ? save.mons[/** @type {number} */ (value)]?.uid : value);
    }
    return /** @type {import('./types/domain').Save} */ (save);
  }
  globalThis.PokeCatchSave = { parse };
})();
