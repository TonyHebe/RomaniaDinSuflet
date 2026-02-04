(() => {
  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${CSS.escape(name)}"]`);
    return el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
  }

  function parsePlacementId(raw) {
    const n = Number.parseInt(String(raw || "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getPlacementIdForNode(node) {
    const direct = String(node.getAttribute("data-ezoic-placement-id") || "").trim();
    if (direct) return parsePlacementId(direct);

    const metaName = String(node.getAttribute("data-ezoic-id-meta") || "").trim();
    if (metaName) return parsePlacementId(getMetaContent(metaName));

    return 0;
  }

  function ensurePlaceholder(node, placementId) {
    const id = `ezoic-pub-ad-placeholder-${placementId}`;
    const existing = node.querySelector(`#${CSS.escape(id)}`);
    if (existing) return;

    // Per Ezoic docs: do not style the placeholder div.
    const ph = document.createElement("div");
    ph.id = id;
    node.appendChild(ph);
  }

  function showAdsInScope(scope) {
    const root = scope instanceof Element || scope instanceof Document ? scope : document;
    const nodes = Array.from(root.querySelectorAll("[data-ezoic-id-meta],[data-ezoic-placement-id]")).filter(
      (el) => el instanceof HTMLElement,
    );

    const ids = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const placementId = getPlacementIdForNode(node);
      if (!placementId) {
        node.hidden = true;
        continue;
      }
      node.hidden = false;
      ensurePlaceholder(node, placementId);
      ids.push(placementId);
    }

    const unique = Array.from(new Set(ids));
    if (!unique.length) return;

    const ez = window.ezstandalone;
    if (!ez || !Array.isArray(ez.cmd)) return;

    ez.cmd.push(() => {
      try {
        if (typeof ez.showAds === "function") ez.showAds(...unique);
      } catch {
        // Ignore (ad blockers, CSP, etc). Site should still function.
      }
    });
  }

  // Expose for pages that inject ad placeholders dynamically.
  window.__RDS_EZOIC_SHOW_ADS = showAdsInScope;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => showAdsInScope(document), { once: true });
  } else {
    showAdsInScope(document);
  }
})();

