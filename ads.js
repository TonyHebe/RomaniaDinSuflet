(() => {
  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${CSS.escape(name)}"]`);
    return el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
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

  function initAds() {
    const client = getMetaContent("adsense-client");
    if (!isRealClientId(client)) return;

    const allIns = Array.from(document.querySelectorAll("ins.adsbygoogle"));
    const eligible = allIns.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const slot = (el.getAttribute("data-ad-slot") || "").trim();
      return isRealSlotId(slot);
    });

    if (!eligible.length) return;

    // Ensure client attribute is correct for all eligible ad units.
    for (const ins of eligible) ins.setAttribute("data-ad-client", client);

    ensureAdSenseScript(client);
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
