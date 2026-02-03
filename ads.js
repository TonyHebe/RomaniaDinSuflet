(() => {
  function isDebug() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("ads_debug") === "1") return true;
    } catch {
      // ignore
    }
    try {
      return window.localStorage?.getItem("ads_debug") === "1";
    } catch {
      return false;
    }
  }

  const __ADS_DEBUG = isDebug();
  function debugLog(...args) {
    if (!__ADS_DEBUG) return;
    // eslint-disable-next-line no-console
    console.log("[ads]", ...args);
  }

  function getProvider() {
    const el = document.querySelector('meta[name="ads-provider"]');
    const raw = el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
    // Examples: "adsense", "adsterra", "adsense,adsterra"
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${CSS.escape(name)}"]`);
    return el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
  }

  function getClientId() {
    // Prefer the official meta name if present.
    const official = getMetaContent("google-adsense-account");
    if (official) return official;
    return getMetaContent("adsense-client");
  }

  function parseSlotList(raw) {
    return String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => /^\d{6,}$/.test(s));
  }

  function isRealClientId(client) {
    // Expected format: ca-pub-1234567890123456
    return /^ca-pub-\d{10,}$/.test(client);
  }

  function isRealSlotId(slot) {
    // Slot IDs are numeric in AdSense.
    return /^\d{6,}$/.test(slot);
  }

  function isRealAdsterraKey(key) {
    const k = String(key || "").trim();
    return /^[a-z0-9]+$/i.test(k) && !/^replace_me$/i.test(k);
  }

  let __RDS_AD_CONFIG_PROMISE = null;
  async function fetchAdConfig() {
    if (__RDS_AD_CONFIG_PROMISE) return __RDS_AD_CONFIG_PROMISE;
    __RDS_AD_CONFIG_PROMISE = (async () => {
      const tryFetch = async (path) => {
        const res = await fetch(path, { headers: { Accept: "application/json" } });
        const contentType = String(res.headers.get("content-type") || "").toLowerCase();
        const data = contentType.includes("application/json")
          ? await res.json().catch(() => null)
          : null;
        if (!res.ok) return null;
        if (!data || data.ok !== true) return null;
        return data;
      };

      // Some blockers block URLs containing "ads". Try the canonical endpoint first,
      // then a neutral alias.
      return (await tryFetch("/api/ads-config")) || (await tryFetch("/api/public-config"));
    })().catch(() => null);
    return __RDS_AD_CONFIG_PROMISE;
  }

  function ensureAdSenseScript(client) {
    const existing = document.querySelector('script[src*="pagead/js/adsbygoogle.js"]');
    if (existing) return;

    const s = document.createElement("script");
    s.async = true;
    s.dataset.adsense = "true";
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
      client,
    )}`;
    s.addEventListener("error", () => {
      debugLog("AdSense script failed to load (blocked/CSP/network).");
    });
    document.head.appendChild(s);
  }

  function getAdContainer(el) {
    const c = el?.closest?.("[data-ad]");
    return c instanceof HTMLElement ? c : null;
  }

  function isAdSenseFilled(ins) {
    const status = String(ins.getAttribute("data-adsbygoogle-status") || "").toLowerCase();
    if (status === "unfilled") return false;
    if (status) return true;
    // Fallback: some implementations don't set status but still insert an iframe.
    return Boolean(ins.querySelector("iframe"));
  }

  function watchAndRevealAdSense(ins) {
    const container = getAdContainer(ins);
    if (!container) return;

    // Hide until we actually detect a filled unit to avoid showing blank placeholders.
    container.hidden = true;

    if (isAdSenseFilled(ins)) {
      container.hidden = false;
      return;
    }

    const revealOrHide = () => {
      const status = String(ins.getAttribute("data-adsbygoogle-status") || "").toLowerCase();
      if (status === "unfilled") {
        container.hidden = true;
        return true;
      }
      if (isAdSenseFilled(ins)) {
        container.hidden = false;
        return true;
      }
      return false;
    };

    const obs = new MutationObserver(() => {
      if (revealOrHide()) obs.disconnect();
    });
    try {
      obs.observe(ins, { attributes: true, childList: true, subtree: true });
    } catch {
      // ignore
    }

    // Last resort: after a grace period, keep it hidden if unfilled.
    window.setTimeout(() => {
      try {
        revealOrHide();
      } finally {
        obs.disconnect();
      }
    }, 12000);
  }

  function pushAds(adInsElements) {
    // The AdSense script uses this global queue.
    window.adsbygoogle = window.adsbygoogle || [];

    for (const ins of adInsElements) {
      // Prevent double-push.
      if (ins.hasAttribute("data-adsbygoogle-status")) continue;
      try {
        window.adsbygoogle.push({});
      } catch {
        // Ignore (ad blockers, CSP, etc). Site should still function.
      }
    }
  }

  function initAutoAds(client) {
    // Historically, Auto ads required a page-level init push. Some accounts still benefit from it.
    // This is safe even if Auto ads is already enabled server-side.
    if (window.__RDS_AUTO_ADS_INITED) return;
    window.__RDS_AUTO_ADS_INITED = true;

    window.adsbygoogle = window.adsbygoogle || [];
    try {
      window.adsbygoogle.push({
        google_ad_client: client,
        enable_page_level_ads: true,
      });
    } catch {
      // Ignore (ad blockers, CSP, etc). Site should still function.
    }
  }

  function initAdSense(providers) {
    // Default behavior (backwards compatible): if no meta is set, assume AdSense.
    const adsenseEnabled = providers.length === 0 || providers.includes("adsense");
    if (!adsenseEnabled) return;

    const client = getClientId();
    if (!isRealClientId(client)) {
      debugLog("AdSense disabled: missing/invalid ca-pub client id.");
      return;
    }

    // Ensure the script is present even if we have no manual ad slots yet.
    ensureAdSenseScript(client);
    initAutoAds(client);

    const allIns = Array.from(document.querySelectorAll("ins.adsbygoogle"));
    const inFeedSlots = parseSlotList(getMetaContent("adsense-infeed-slots"));
    const inArticleSlots = parseSlotList(getMetaContent("adsense-article-incontent-slots"));

    // If the fixed slots still have REPLACE_ME, try to infer from the configured slot lists.
    for (const el of allIns) {
      if (!(el instanceof HTMLElement)) continue;
      const currentSlot = (el.getAttribute("data-ad-slot") || "").trim();
      if (isRealSlotId(currentSlot)) continue;

      const container = getAdContainer(el);
      const placement = String(container?.getAttribute("data-ad") || "").toLowerCase();
      const fallback =
        placement.includes("home") || placement.includes("stiri")
          ? inFeedSlots[0]
          : placement.includes("article")
            ? inArticleSlots[0]
            : "";

      if (fallback && isRealSlotId(String(fallback))) {
        el.setAttribute("data-ad-slot", String(fallback));
        debugLog("Inferred AdSense slot id for", placement || "unknown", "=>", String(fallback));
      }
    }

    const eligible = allIns.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const slot = (el.getAttribute("data-ad-slot") || "").trim();
      return isRealSlotId(slot);
    });

    if (!eligible.length) {
      debugLog("AdSense: no eligible <ins> slots found (missing numeric data-ad-slot).");
      return;
    }

    // Ensure client attribute is correct for all eligible ad units.
    for (const ins of eligible) ins.setAttribute("data-ad-client", client);

    // Keep placeholders hidden until they actually fill.
    for (const ins of eligible) watchAndRevealAdSense(ins);
    pushAds(eligible);
  }

  function buildAdsterraIframeSrcDoc({ key, width, height }) {
    const keyStr = JSON.stringify(String(key));
    const w = Number(width) || 728;
    const h = Number(height) || 90;
    const src = `https://www.highperformanceformat.com/${encodeURIComponent(String(key))}/invoke.js`;

    // Run inside a sandboxed iframe so any document.write inside invoke.js cannot affect the main page.
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ad</title>
  </head>
  <body style="margin:0;padding:0;overflow:hidden;">
    <script type="text/javascript">
      (function () {
        // NOTE: this document is sandboxed WITHOUT allow-same-origin, so we cannot be inspected by the parent.
        // Use postMessage to notify the parent when we actually see ad content.
        var TOKEN = "__RDS_TOKEN__";
        function send(status, detail) {
          try {
            parent.postMessage(
              { source: "rds_ads", type: "adsterra", token: TOKEN, status: String(status), detail: String(detail || "") },
              "*",
            );
          } catch (e) {
            // ignore
          }
        }

        function hasAdContent() {
          try {
            // Most Adsterra invoke scripts insert an iframe.
            if (document.querySelector("iframe")) return true;
            if (document.querySelector("img,object,embed")) return true;

            // Fallback: any non-script element suggests something rendered.
            var kids = document.body ? Array.prototype.slice.call(document.body.children || []) : [];
            for (var i = 0; i < kids.length; i += 1) {
              var t = String(kids[i] && kids[i].tagName ? kids[i].tagName : "").toUpperCase();
              if (t && t !== "SCRIPT" && t !== "STYLE") return true;
            }
          } catch (e) {
            // ignore
          }
          return false;
        }

        window.atOptions = {
          key: ${keyStr},
          format: "iframe",
          height: ${h},
          width: ${w},
          params: {},
        };

        var s = document.createElement("script");
        s.type = "text/javascript";
        s.src = "${src}";
        s.async = true;

        var done = false;
        function finish(status, detail) {
          if (done) return;
          done = true;
          send(status, detail);
        }

        s.onerror = function () {
          finish("blocked", "invoke.js failed to load (blocked/CSP/network)");
        };
        s.onload = function () {
          // Poll for actual content for a short grace window.
          var start = Date.now();
          (function poll() {
            if (hasAdContent()) return finish("filled", "content detected");
            if (Date.now() - start > 9000) return finish("unfilled", "no content detected after grace window");
            setTimeout(poll, 250);
          })();
        };

        try {
          document.body.appendChild(s);
        } catch (e) {
          finish("blocked", "failed to append invoke.js");
        }

        // Absolute fallback: if neither onload nor onerror fires, keep it hidden.
        setTimeout(function () {
          if (!done && hasAdContent()) finish("filled", "content detected (timeout fallback)");
          else if (!done) finish("unfilled", "no load/error event within timeout");
        }, 12000);
      })();
    </script>
  </body>
</html>`;
  }

  function getAdsterraSize(el) {
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
    const wAttr = isMobile ? "data-adsterra-width-mobile" : "data-adsterra-width";
    const hAttr = isMobile ? "data-adsterra-height-mobile" : "data-adsterra-height";

    const wRaw = (el.getAttribute(wAttr) || "").trim();
    const hRaw = (el.getAttribute(hAttr) || "").trim();

    const width = Number.parseInt(wRaw || (isMobile ? "320" : "728"), 10);
    const height = Number.parseInt(hRaw || (isMobile ? "50" : "90"), 10);

    return {
      width: Number.isFinite(width) && width > 0 ? width : isMobile ? 320 : 728,
      height: Number.isFinite(height) && height > 0 ? height : isMobile ? 50 : 90,
    };
  }

  function getAdsterraKeyForSlot({ slot, cfg, isMobile }) {
    const metaAttr = isMobile ? "data-adsterra-key-meta-mobile" : "data-adsterra-key-meta";
    const cfgAttr = isMobile
      ? "data-adsterra-config-field-mobile"
      : "data-adsterra-config-field";

    const metaName = String(slot.getAttribute(metaAttr) || "").trim();
    const cfgField = String(slot.getAttribute(cfgAttr) || "").trim();

    // Fallback to non-mobile attributes if mobile-specific not provided.
    const baseMetaName = String(slot.getAttribute("data-adsterra-key-meta") || "").trim();
    const baseCfgField = String(slot.getAttribute("data-adsterra-config-field") || "").trim();

    let key = metaName ? getMetaContent(metaName) : "";
    if (!isRealAdsterraKey(key) && baseMetaName) key = getMetaContent(baseMetaName);

    if (!isRealAdsterraKey(key) && cfg && cfgField) {
      key = String(cfg?.adsterra?.[cfgField] || "").trim();
    }
    if (!isRealAdsterraKey(key) && cfg && baseCfgField) {
      key = String(cfg?.adsterra?.[baseCfgField] || "").trim();
    }

    return String(key || "").trim();
  }

  const __RDS_ADSTERRA_REVEAL_HANDLERS =
    window.__RDS_ADSTERRA_REVEAL_HANDLERS instanceof Map
      ? window.__RDS_ADSTERRA_REVEAL_HANDLERS
      : new Map();
  window.__RDS_ADSTERRA_REVEAL_HANDLERS = __RDS_ADSTERRA_REVEAL_HANDLERS;

  function ensureAdsterraMessageListener() {
    if (window.__RDS_ADSTERRA_MSG_LISTENER_INITED) return;
    window.__RDS_ADSTERRA_MSG_LISTENER_INITED = true;

    window.addEventListener("message", (ev) => {
      const data = ev?.data;
      if (!data || typeof data !== "object") return;
      if (data.source !== "rds_ads" || data.type !== "adsterra") return;

      const token = String(data.token || "");
      if (!token) return;

      const handler = __RDS_ADSTERRA_REVEAL_HANDLERS.get(token);
      if (typeof handler !== "function") return;

      try {
        handler({
          status: String(data.status || ""),
          detail: String(data.detail || ""),
        });
      } finally {
        __RDS_ADSTERRA_REVEAL_HANDLERS.delete(token);
      }
    });
  }

  function renderAdsterraIntoSlot(slotEl, { key, width, height, container }) {
    slotEl.innerHTML = "";

    const iframe = document.createElement("iframe");
    iframe.title = "Publicitate";
    iframe.loading = "lazy";
    iframe.width = String(width);
    iframe.height = String(height);
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation",
    );
    iframe.style.border = "0";
    iframe.style.overflow = "hidden";
    iframe.style.display = "block";
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;

    // Use postMessage from the iframe to decide whether to reveal the container.
    ensureAdsterraMessageListener();
    const token = `${Math.random().toString(36).slice(2)}_${Date.now()}`;
    iframe.dataset.rdsToken = token;
    iframe.srcdoc = buildAdsterraIframeSrcDoc({ key, width, height }).replaceAll("__RDS_TOKEN__", token);

    slotEl.appendChild(iframe);

    // Avoid showing blank placeholders: only unhide once the iframe reports it actually rendered content.
    if (container instanceof HTMLElement) {
      container.hidden = true;

      __RDS_ADSTERRA_REVEAL_HANDLERS.set(token, ({ status, detail }) => {
        const s = String(status || "").toLowerCase();
        if (s === "filled") {
          container.hidden = false;
          debugLog("Adsterra filled:", detail || "filled");
        } else {
          container.hidden = true;
          debugLog("Adsterra stayed hidden:", s || "unknown", detail || "");
        }
      });

      // If we never hear back (some blockers), keep hidden and cleanup.
      window.setTimeout(() => {
        if (!__RDS_ADSTERRA_REVEAL_HANDLERS.has(token)) return;
        __RDS_ADSTERRA_REVEAL_HANDLERS.delete(token);
        container.hidden = true;
        debugLog("Adsterra stayed hidden: no postMessage received within timeout.");
      }, 13000);
    }
  }

  function initAdsterra(providers) {
    const adsterraEnabled = providers.includes("adsterra");
    if (!adsterraEnabled) return;

    const slots = Array.from(
      document.querySelectorAll(".adsterra-slot[data-adsterra-key-meta]"),
    ).filter((el) => el instanceof HTMLElement);
    if (!slots.length) return;

    // Async flow: meta-first, otherwise try /api/ads-config (env-backed).
    (async () => {
      const cfg = await fetchAdConfig();
      const isMobile = window.matchMedia && window.matchMedia("(max-width: 720px)").matches;

      for (const slot of slots) {
        if (!(slot instanceof HTMLElement)) continue;
        if (slot.dataset.adsterraRendered === "true") continue;

        const key = getAdsterraKeyForSlot({ slot, cfg, isMobile });
        if (!isRealAdsterraKey(key)) {
          debugLog("Adsterra: missing/invalid key for slot.", slot);
          continue;
        }

        const container = getAdContainer(slot);

        const { width, height } = getAdsterraSize(slot);
        renderAdsterraIntoSlot(slot, { key, width, height, container });
        slot.dataset.adsterraRendered = "true";
      }
    })().catch(() => {
      // Ignore (ad blockers, CSP, etc). Site should still function.
    });
  }

  function initAds() {
    const providers = getProvider();
    initAdSense(providers);
    initAdsterra(providers);
  }

  // Expose for pages that add ad units dynamically (e.g. after fetch/render).
  window.__RDS_INIT_ADS = initAds;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAds, { once: true });
  } else {
    initAds();
  }
})();
