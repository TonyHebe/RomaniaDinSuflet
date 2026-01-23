(() => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

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
    const empty = document.getElementById("stiri-empty");
    if (!(list instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    try {
      const res = await fetch("/api/articles?category=stiri&limit=9", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];

      if (!items.length) {
        empty.hidden = false;
        list.innerHTML = "";
        return;
      }

      empty.hidden = true;
      list.innerHTML = items
        .map((a) => {
          const title = escapeHtml(String(a.title ?? ""));
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

          return `
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
          `;
        })
        .join("");
    } catch (err) {
      // Keep the page usable even if API is not configured yet.
      empty.hidden = false;
      list.innerHTML = "";
    }
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
})();
