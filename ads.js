(() => {
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
      const res = await fetch("/api/ads-config", {
        headers: { Accept: "application/json" },
      });
      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      const data = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : null;
      if (!res.ok) return null;
      if (!data || data.ok !== true) return null;
      return data;
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
    document.head.appendChild(s);
  }

  function unhideAdContainers(adInsElements) {
    for (const ins of adInsElements) {
      const container = ins.closest("[data-ad]");
      if (container instanceof HTMLElement) container.hidden = false;
    }
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
    if (!isRealClientId(client)) return;

    // Ensure the script is present even if we have no manual ad slots yet.
    ensureAdSenseScript(client);
    initAutoAds(client);

    const allIns = Array.from(document.querySelectorAll("ins.adsbygoogle"));
    const eligible = allIns.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const slot = (el.getAttribute("data-ad-slot") || "").trim();
      return isRealSlotId(slot);
    });

    if (!eligible.length) return;

    // Ensure client attribute is correct for all eligible ad units.
    for (const ins of eligible) ins.setAttribute("data-ad-client", client);

    unhideAdContainers(eligible);
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
      window.atOptions = {
        key: ${keyStr},
        format: "iframe",
        height: ${h},
        width: ${w},
        params: {}
      };
    </script>
    <script type="text/javascript" src="${src}"></script>
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

  function renderAdsterraIntoSlot(slotEl, { key, width, height }) {
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
    iframe.srcdoc = buildAdsterraIframeSrcDoc({ key, width, height });

    slotEl.appendChild(iframe);
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
        if (!isRealAdsterraKey(key)) continue;

        const container = slot.closest("[data-ad]");
        if (container instanceof HTMLElement) container.hidden = false;

        const { width, height } = getAdsterraSize(slot);
        renderAdsterraIntoSlot(slot, { key, width, height });
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
