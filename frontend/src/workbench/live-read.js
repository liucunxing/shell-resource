// Compare API JSON, retaining React references when a background read is unchanged.
export function keepUnchanged(previous, incoming) {
  return JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}

export function watchLiveRead(read, { onError } = {}) {
  let active = true;
  let pending = false;
  const current = () => active;
  async function run() {
    if (pending || !active || document.visibilityState === "hidden") return;
    pending = true;
    try {
      await read(current);
    } catch (error) {
      if (active) onError?.(error);
    } finally {
      pending = false;
    }
  }
  const timer = setInterval(run, 10000);
  document.addEventListener("visibilitychange", run);
  return () => {
    active = false;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", run);
  };
}

// Revision-triggered reads must ignore responses from a former version or scope.
export function readWhileMounted(read, { onError }) {
  let active = true;
  let retry;
  function load() {
    read(() => active).catch(error => {
      if (!active) return;
      onError(error);
      if ([401, 403, 404].includes(error.status)) return;
      retry = setTimeout(() => {
        if (document.visibilityState === "hidden") {
          document.addEventListener("visibilitychange", load, { once: true });
        } else load();
      }, 10000);
    });
  }
  load();
  return () => {
    active = false;
    clearTimeout(retry);
    globalThis.document?.removeEventListener?.("visibilitychange", load);
  };
}
