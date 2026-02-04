(() => {
  // Bump this string to quickly confirm which ads.js is deployed in production.
  // (Useful when CDN/Vercel is serving an older cached build.)
  const __RDS_ADS_BUILD = "2026-02-04-ezoic";

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
  debugLog("build", __RDS_ADS_BUILD);

  function getProvider() {
    const el = document.querySelector('meta[name="ads-provider"]');
    const raw = el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
    // Examples: "ezoic", "adsense"
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

  function initAds() {
    const providers = getProvider();
    // If Ezoic is enabled, avoid initializing other ad providers from this file to prevent conflicts.
    // Ezoic manages its own scripts, placements, and downstream demand (which can still include Google).
    if (providers.includes("ezoic")) {
      debugLog("Ezoic enabled via meta; skipping AdSense init in ads.js.");
      return;
    }
    initAdSense(providers);
  }

  // Expose for pages that add ad units dynamically (e.g. after fetch/render).
  window.__RDS_INIT_ADS = initAds;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAds, { once: true });
  } else {
    initAds();
  }
})();
