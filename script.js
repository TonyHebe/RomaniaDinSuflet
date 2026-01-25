(() => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${CSS.escape(name)}"]`);
    return el instanceof HTMLMetaElement ? (el.content || "").trim() : "";
  }

  function getInFeedAdConfig() {
    const slotsRaw = getMetaContent("adsense-infeed-slots");
    const everyRaw = getMetaContent("adsense-infeed-every");

    const slots = slotsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => /^\d{6,}$/.test(s));

    const every = Number.parseInt(String(everyRaw || "1"), 10);
    const freq = Number.isFinite(every) && every > 0 ? every : 1;

    return { slots, every: freq };
  }

  function renderInFeedAd({ slot }) {
    // Container is hidden by default; ads.js will unhide when properly configured.
    return `
      <div class="article-card ad-card" data-ad="stiri_infeed" aria-label="Publicitate" hidden>
        <div class="ad-label" aria-hidden="true">Publicitate</div>
        <ins
          class="adsbygoogle ad-slot"
          style="display: block"
          data-ad-client="ca-pub-REPLACE_ME"
          data-ad-slot="${escapeAttr(String(slot))}"
          data-ad-format="auto"
          data-full-width-responsive="true"
        ></ins>
      </div>
    `;
  }

  function maybeInitAds() {
    const fn = window.__RDS_INIT_ADS;
    if (typeof fn === "function") {
      try {
        fn();
      } catch {
        // Ignore (ad blockers, CSP, etc). Site should still function.
      }
    }
  }

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("primary-nav");
  if (!(toggle instanceof HTMLElement) || !(nav instanceof HTMLElement)) return;

  const setExpanded = (expanded) => {
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    nav.classList.toggle("is-open", expanded);
  };

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
  });

  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("is-open")) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (nav.contains(target) || toggle.contains(target)) return;
    setExpanded(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setExpanded(false);
  });

  async function loadStiri() {
    const list = document.getElementById("stiri-list");
    const pagination = document.getElementById("stiri-pagination");
    const empty = document.getElementById("stiri-empty");
    if (
      !(list instanceof HTMLElement) ||
      !(empty instanceof HTMLElement) ||
      !(pagination instanceof HTMLElement)
    )
      return;

    const pageSize = 9;
    const page = getStiriPage();

    try {
      const res = await fetch(
        `/api/articles?category=stiri&page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(
          String(pageSize),
        )}`,
        {
        headers: { Accept: "application/json" },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const totalPages = Number.isFinite(Number(data?.totalPages))
        ? Number(data.totalPages)
        : 0;

      if (!items.length) {
        empty.hidden = false;
        list.innerHTML = "";
        pagination.hidden = true;
        pagination.innerHTML = "";
        return;
      }

      empty.hidden = true;
      const { slots: inFeedSlots, every: inFeedEvery } = getInFeedAdConfig();
      const parts = [];
      let slotIndex = 0;

      for (let i = 0; i < items.length; i += 1) {
        const a = items[i];
        const rawTitle = String(a.title ?? "").trim();
        const titleText =
          rawTitle && !/^titlu$/i.test(rawTitle) ? rawTitle : String(a.excerpt ?? "").trim();
        const title = escapeHtml(titleText || "Fără titlu");
        const slug = encodeURIComponent(String(a.slug ?? ""));
        const imageUrl = escapeAttr(String(a.imageUrl ?? ""));
        const excerpt = escapeHtml(String(a.excerpt ?? ""));
        const date = a.publishedAt
          ? new Date(a.publishedAt).toLocaleDateString("ro-RO", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";

        parts.push(`
          <article class="article-card">
            ${
              imageUrl
                ? `<img class="article-thumb" src="${imageUrl}" alt="" loading="lazy" />`
                : `<div class="article-thumb" aria-hidden="true"></div>`
            }
            <div class="article-body">
              <h3 class="article-title">${title}</h3>
              <p class="article-excerpt">${excerpt}</p>
              <div class="article-meta">
                <span>${escapeHtml(date)}</span>
                <a class="article-link" href="/article.html?slug=${slug}">Citește</a>
              </div>
            </div>
          </article>
        `);

        const shouldInsertAd =
          inFeedSlots.length > 0 && (i + 1) % inFeedEvery === 0 && i !== items.length - 1;
        if (shouldInsertAd) {
          const slot = inFeedSlots[slotIndex % inFeedSlots.length];
          slotIndex += 1;
          parts.push(renderInFeedAd({ slot }));
        }
      }

      list.innerHTML = parts.join("");
      maybeInitAds();

      renderStiriPagination({ el: pagination, page, totalPages });
    } catch (err) {
      // Keep the page usable even if API is not configured yet.
      empty.hidden = false;
      list.innerHTML = "";
      pagination.hidden = true;
      pagination.innerHTML = "";
    }
  }

  function getStiriPage() {
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get("stiriPage") || url.searchParams.get("page");
      const n = Number.parseInt(String(raw || "1"), 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch {
      return 1;
    }
  }

  function buildStiriPageHref(page) {
    const p = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("stiriPage", String(p));
      url.hash = "stiri";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return `/?stiriPage=${encodeURIComponent(String(p))}#stiri`;
    }
  }

  function setStiriPage(page) {
    const href = buildStiriPageHref(page);
    try {
      history.pushState({}, "", href);
    } catch {
      window.location.href = href;
      return;
    }
    loadStiri();
  }

  function renderStiriPagination({ el, page, totalPages }) {
    const p = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const tp = Number.isFinite(Number(totalPages)) ? Math.max(0, Number(totalPages)) : 0;

    if (tp <= 1) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }

    const pages = buildPageList(p, tp);
    el.hidden = false;
    el.innerHTML = `
      <a class="page-link" href="${escapeAttr(buildStiriPageHref(Math.max(1, p - 1)))}" data-page="${Math.max(
        1,
        p - 1,
      )}" aria-disabled="${p <= 1 ? "true" : "false"}">Înapoi</a>
      ${pages
        .map((x) => {
          if (x === "…") return `<span class="page-ellipsis" aria-hidden="true">…</span>`;
          const isCurrent = x === p;
          return `<a class="page-link${isCurrent ? " is-current" : ""}" href="${escapeAttr(
            buildStiriPageHref(x),
          )}" data-page="${x}" ${isCurrent ? 'aria-current="page"' : ""}>Pagina ${x}</a>`;
        })
        .join("")}
      <a class="page-link" href="${escapeAttr(buildStiriPageHref(Math.min(tp, p + 1)))}" data-page="${Math.min(
        tp,
        p + 1,
      )}" aria-disabled="${p >= tp ? "true" : "false"}">Înainte</a>
    `;

    // Enhance: keep it SPA-like, no full reload.
    for (const link of Array.from(el.querySelectorAll("a.page-link"))) {
      link.addEventListener("click", (e) => {
        const target = e.currentTarget;
        if (!(target instanceof HTMLAnchorElement)) return;
        const disabled = target.getAttribute("aria-disabled") === "true";
        if (disabled) {
          e.preventDefault();
          return;
        }
        const next = Number.parseInt(String(target.dataset.page || ""), 10);
        if (!Number.isFinite(next) || next <= 0) return;
        e.preventDefault();
        setStiriPage(next);
      });
    }
  }

  function buildPageList(page, totalPages) {
    // Always include: 1, last, current +- 2. Add ellipses when gaps exist.
    const must = new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2]);
    const nums = Array.from(must)
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= totalPages)
      .sort((a, b) => a - b);

    const out = [];
    let prev = 0;
    for (const n of nums) {
      if (prev && n - prev > 1) out.push("…");
      out.push(n);
      prev = n;
    }
    return out;
  }

  function escapeHtml(str) {
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(str) {
    // Basic attribute escaping; URLs still need to be trusted server-side.
    return escapeHtml(str);
  }

  loadStiri();

  window.addEventListener("popstate", () => {
    loadStiri();
  });
})();
