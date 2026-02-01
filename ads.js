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

  function initAds() {
    const providers = getProvider();
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

  // Expose for pages that add ad units dynamically (e.g. after fetch/render).
  window.__RDS_INIT_ADS = initAds;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAds, { once: true });
  } else {
    initAds();
  }
})();
