// A fixed number of places for work that holds a lot of memory (merging a Reddit video
// holds the whole file). Work beyond that waits its turn, first come, first served.
// A finished job hands its place straight to the next one waiting.
export function slots(max) {
  let running = 0;
  const waiting = [];
  return {
    /** Jobs running plus jobs waiting. */
    get load() { return running + waiting.length; },
    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      if (running < max) running++;
      else await new Promise((go) => waiting.push(go));   // the place is handed over, already counted
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next) next(); else running--;
      }
    },
  };
}
