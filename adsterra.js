(() => {
  /**
   * Adsterra embeds often rely on a global `atOptions` object that is read
   * when their `invoke.js` executes. If you place multiple units on a page,
   * loading them in parallel can cause collisions.
   *
   * This loader queues units and loads them sequentially so each script reads
   * the correct config.
   */
  class ScriptQueue {
    constructor() {
      this._queue = [];
      this._running = false;
    }
    add(task) {
      this._queue.push(task);
      this._run();
    }
    _run() {
      if (this._running) return;
      this._running = true;
      const next = () => {
        const task = this._queue.shift();
        if (!task) {
          this._running = false;
          return;
        }
        try {
          task(next);
        } catch {
          next();
        }
      };
      next();
    }
  }

  const q = new ScriptQueue();

  function safeEl(id) {
    const el = document.getElementById(id);
    return el instanceof HTMLElement ? el : null;
  }

  function loadExternalScript({ src, done }) {
    const s = document.createElement("script");
    // Keep sequential execution semantics (do not set async).
    s.src = src;
    s.referrerPolicy = "no-referrer-when-downgrade";
    s.onload = () => done();
    s.onerror = () => done();
    document.body.appendChild(s);
  }

  function renderIframeUnit({ mount, key, width, height }) {
    // Clear any previous content (e.g. hot reload, re-init).
    mount.innerHTML = "";
    mount.classList.add("adsterra-slot");

    q.add((done) => {
      // Adsterra expects a global `atOptions`.
      window.atOptions = {
        key,
        format: "iframe",
        height,
        width,
        params: {},
      };

      loadExternalScript({
        src: `https://www.highperformanceformat.com/${encodeURIComponent(key)}/invoke.js`,
        done,
      });
    });
  }

  function renderNativeUnit({ mount, invokeSrc, containerId }) {
    mount.innerHTML = "";
    mount.classList.add("adsterra-slot");

    const container = document.createElement("div");
    container.id = containerId;
    mount.appendChild(container);

    // This format doesn't use `atOptions`, so no need to queue.
    loadExternalScript({ src: invokeSrc, done: () => {} });
  }

  function initPageAds() {
    // Sticky 320x50 (mobile-first). Safe to mount on all pages.
    const sticky = safeEl("adsterra-sticky-320x50");
    if (sticky) {
      renderIframeUnit({
        mount: sticky,
        key: "f251c55e121022814ec6e9fc4db4ec25",
        width: 320,
        height: 50,
      });
    }

    // Home placements
    const homeNative = safeEl("adsterra-home-native");
    if (homeNative) {
      renderNativeUnit({
        mount: homeNative,
        invokeSrc:
          "https://pl28620596.effectivegatecpm.com/c860229ee166b2145685fab77999ca04/invoke.js",
        containerId: "container-c860229ee166b2145685fab77999ca04",
      });
    }

    const home300 = safeEl("adsterra-home-300x250");
    if (home300) {
      renderIframeUnit({
        mount: home300,
        key: "9b54e2bf35f5d22aa230a04c465a77cf",
        width: 300,
        height: 250,
      });
    }

    // Article placements
    const article300 = safeEl("adsterra-article-300x250");
    if (article300) {
      renderIframeUnit({
        mount: article300,
        key: "9b54e2bf35f5d22aa230a04c465a77cf",
        width: 300,
        height: 250,
      });
    }
  }

  // Expose for pages that load content dynamically and want to re-init.
  window.__RDS_INIT_ADSTERRA = initPageAds;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPageAds, { once: true });
  } else {
    initPageAds();
  }
})();

