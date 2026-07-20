// please do not escape — minimal client-side renderer for ai-sandboxes.yaml
// No build step: fetch the live YAML from GitHub, parse, render, filter.

const RAW_URL = "https://raw.githubusercontent.com/pjlsergeant/ai-sandboxes/main/ai-sandboxes.yaml";
const FALLBACK_URL = "../ai-sandboxes.yaml"; // works if this page happens to be served alongside the data file

const state = {
  data: null,
  filters: {
    isolation_boundary: new Set(),
    execution_locus: new Set(),
    network_policy: new Set(),
    credential_mediation: new Set(),
    pricing_model: new Set(),
    role: new Set(),
    agents_supported: new Set(),
    platforms: new Set(),
  },
  search: "",
  officialOnly: false,
  showAdjacent: false,
};

const FACET_DEFS = [
  { key: "role", label: "Role", getter: (e) => single(getRole(e)), taxonomy: "product_role" },
  { key: "isolation_boundary", label: "Isolation boundary", getter: (e) => single(get(e, "classification.isolation_boundary")), taxonomy: "isolation_boundary" },
  { key: "execution_locus", label: "Where it runs", getter: (e) => single(get(e, "classification.execution_locus")), taxonomy: "execution_locus" },
  { key: "network_policy", label: "Network policy", getter: (e) => single(get(e, "classification.network_policy")), taxonomy: "network_policy" },
  { key: "credential_mediation", label: "Credential mediation", getter: (e) => single(get(e, "classification.credential_mediation")), taxonomy: "credential_mediation" },
  { key: "pricing_model", label: "Pricing", getter: (e) => single(get(e, "pricing.model")), taxonomy: "pricing_model" },
  { key: "agents_supported", label: "Agents supported", getter: (e) => list(get(e, "agents_supported")), taxonomy: null },
  { key: "platforms", label: "Platforms", getter: (e) => list(get(e, "platforms")), taxonomy: null },
];

init();

async function init() {
  bindStaticControls();
  try {
    const text = await fetchYaml();
    state.data = jsyaml.load(text);
    renderFacets();
    renderCards();
  } catch (err) {
    showStatus(
      `Could not load the dataset (${err.message}). It's fetched live from ` +
      `<a href="${RAW_URL}">GitHub</a> — try refreshing, or check the repo directly.`,
      true
    );
  }
}

async function fetchYaml() {
  for (const url of [RAW_URL, FALLBACK_URL]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch (_) { /* try next */ }
  }
  throw new Error("all sources failed");
}

function showStatus(html, isError) {
  const el = document.getElementById("status");
  el.innerHTML = html;
  el.hidden = false;
  el.classList.toggle("error", !!isError);
}

// ---- claim resolution -------------------------------------------------

// Every non-identity field is either a bare scalar/list (shorthand for
// {ev: official, src: default_source}) or a claim object {value, ev, src,
// basis, derived_from}. This unwraps either shape uniformly.
function resolveClaim(raw, entry) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    return {
      value: raw.value,
      ev: raw.ev || "official",
      src: raw.src || entry.default_source,
      basis: raw.basis || null,
    };
  }
  return { value: raw, ev: "official", src: entry.default_source, basis: null };
}

function get(entry, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), entry);
}

function getRole(entry) {
  return get(entry, "classification.role") ?? entry.role;
}

// A facet getter normalizes a raw field into an array of plain string values
// (unwrapping the claim envelope first) so single- and multi-value facets
// can share the same filtering code.
function single(raw) {
  if (raw === undefined) return [];
  const v = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "value" in raw ? raw.value : raw;
  return v === undefined || v === null ? [] : [v];
}
function list(raw) {
  if (raw === undefined) return [];
  const v = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "value" in raw ? raw.value : raw;
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function humanize(id) {
  if (id === undefined || id === null) return "";
  return String(id).replace(/_/g, " ");
}

function taxonomyLabel(data, taxonomyKey, id) {
  if (!taxonomyKey) return humanize(id);
  const entries = data.taxonomy[taxonomyKey];
  if (!entries) return humanize(id);
  const match = entries.find((e) => e.id === id);
  return match ? match.label : humanize(id);
}

// ---- facets -------------------------------------------------------------

function renderFacets() {
  const container = document.getElementById("facets");
  container.innerHTML = "";
  for (const facet of FACET_DEFS) {
    const values = new Set();
    for (const entry of allEntries()) {
      for (const v of facet.getter(entry)) values.add(v);
    }
    if (values.size === 0) continue;

    const group = document.createElement("div");
    group.className = "facet-group";
    const h4 = document.createElement("h4");
    h4.textContent = facet.label;
    group.appendChild(h4);

    const chips = document.createElement("div");
    chips.className = "facet-chips";
    [...values].sort().forEach((val) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "facet-chip";
      btn.textContent = taxonomyLabel(state.data, facet.taxonomy, val);
      btn.dataset.facet = facet.key;
      btn.dataset.value = val;
      btn.addEventListener("click", () => {
        const set = state.filters[facet.key];
        set.has(val) ? set.delete(val) : set.add(val);
        btn.classList.toggle("active");
        renderCards();
      });
      chips.appendChild(btn);
    });
    group.appendChild(chips);
    container.appendChild(group);
  }
}

function allEntries() {
  return [...state.data.sandboxes, ...state.data.adjacent];
}

// ---- filtering ------------------------------------------------------------

function matchesFilters(entry) {
  for (const facet of FACET_DEFS) {
    const active = state.filters[facet.key];
    if (active.size === 0) continue;
    const values = facet.getter(entry);
    if (!values.some((v) => active.has(v))) return false;
  }
  if (state.search) {
    const haystack = [
      entry.name,
      entry.tagline,
      resolveClaim(entry.summary, entry)?.value,
      ...(entry.limitations || []).map((l) => resolveClaim(l, entry)?.value),
    ]
      .filter(Boolean)
      .join(" \n ")
      .toLowerCase();
    if (!haystack.includes(state.search)) return false;
  }
  return true;
}

// ---- rendering ------------------------------------------------------------

function renderCards() {
  const container = document.getElementById("cards");
  container.innerHTML = "";

  const pool = state.showAdjacent ? allEntries() : state.data.sandboxes;
  const results = pool.filter(matchesFilters);

  document.getElementById("resultCount").textContent =
    `${results.length} of ${pool.length} shown`;

  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing matches those filters. Try clearing some.";
    container.appendChild(empty);
    return;
  }

  const template = document.getElementById("cardTemplate");
  for (const entry of results) {
    const isAdjacent = !state.data.sandboxes.includes(entry);
    container.appendChild(renderCard(entry, isAdjacent));
  }
  void template;
}

function chip(labelText, claim) {
  const span = document.createElement("span");
  span.className = "chip" + (claim.ev !== "official" ? ` ev-${claim.ev}` : "");
  span.textContent = labelText;
  if (claim.basis) span.title = claim.basis;
  return span;
}

function renderCard(entry, isAdjacent) {
  const node = document.getElementById("cardTemplate").content.cloneNode(true);
  const card = node.querySelector(".card");
  card.classList.toggle("is-adjacent", isAdjacent);

  const title = node.querySelector(".card-title");
  title.textContent = entry.name;
  if (entry.id === "byre") {
    // Disclosed the same way the source README discloses it (see its
    // "Shameless plug" section): this dataset's author also built byre.
    const badge = document.createElement("span");
    badge.className = "self-badge";
    badge.textContent = "this dataset's author's project";
    title.appendChild(badge);
  }

  const roleClaim = resolveClaim(getRole(entry), entry);
  node.querySelector(".card-role").textContent = roleClaim
    ? taxonomyLabel(state.data, "product_role", roleClaim.value)
    : "";

  const taglineClaim = resolveClaim(entry.tagline ?? entry.summary, entry);
  node.querySelector(".card-tagline").textContent = taglineClaim ? taglineClaim.value : "";

  // Badges: the four classification facets + pricing, when present.
  const badgesEl = node.querySelector(".card-badges");
  const badgeFields = [
    ["classification.isolation_boundary", "isolation_boundary"],
    ["classification.network_policy", "network_policy"],
    ["classification.credential_mediation", "credential_mediation"],
    ["pricing.model", "pricing_model"],
  ];
  for (const [path, taxonomyKey] of badgeFields) {
    const raw = get(entry, path);
    if (raw === undefined) continue;
    const claim = resolveClaim(raw, entry);
    if (state.officialOnly && claim.ev !== "official") continue;
    badgesEl.appendChild(chip(taxonomyLabel(state.data, taxonomyKey, claim.value), claim));
  }

  // Facts: maturity, license, platforms, agents supported, audience.
  const factsEl = node.querySelector(".card-facts");
  const facts = [
    ["Maturity", entry.maturity],
    ["License", entry.license],
    ["Platforms", entry.platforms],
    ["Agents", entry.agents_supported],
    ["Audience", entry.audience],
  ];
  for (const [label, raw] of facts) {
    if (raw === undefined) continue;
    const claim = resolveClaim(raw, entry);
    if (state.officialOnly && claim.ev !== "official") continue;
    const value = Array.isArray(claim.value) ? claim.value.map(humanize).join(", ") : humanize(claim.value);
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (claim.ev !== "official") dd.title = `(${claim.ev}) ${claim.basis || ""}`.trim();
    factsEl.appendChild(dt);
    factsEl.appendChild(dd);
  }

  // Limitations (or, for adjacent entries, the risk basis) as a short list.
  const limsEl = node.querySelector(".card-limitations");
  const limitations = (entry.limitations || [])
    .map((l) => resolveClaim(l, entry))
    .filter((c) => c && (!state.officialOnly || c.ev === "official"));
  if (limitations.length) {
    const ul = document.createElement("ul");
    for (const c of limitations) {
      const li = document.createElement("li");
      li.textContent = c.value;
      if (c.ev !== "official") li.title = `(${c.ev}) ${c.basis || ""}`.trim();
      ul.appendChild(li);
    }
    limsEl.appendChild(ul);
  } else {
    limsEl.remove();
  }

  // Footer: license text + links (repo/docs URLs + primary source).
  node.querySelector(".card-license").textContent = "";
  const linksEl = node.querySelector(".card-links");
  const urls = entry.urls || {};
  for (const [label, url] of Object.entries(urls)) {
    if (!url) continue;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = humanize(label);
    linksEl.appendChild(a);
  }
  const src = state.data.sources[entry.default_source];
  if (src && src.url && !Object.values(urls).includes(src.url)) {
    const a = document.createElement("a");
    a.href = src.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "source";
    linksEl.appendChild(a);
  }

  return card;
}

// ---- static controls --------------------------------------------------

function bindStaticControls() {
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderCards();
  });
  document.getElementById("officialOnly").addEventListener("change", (e) => {
    state.officialOnly = e.target.checked;
    renderCards();
  });
  document.getElementById("showAdjacent").addEventListener("change", (e) => {
    state.showAdjacent = e.target.checked;
    renderFacets();
    renderCards();
  });
  document.getElementById("clearFilters").addEventListener("click", () => {
    for (const set of Object.values(state.filters)) set.clear();
    state.search = "";
    document.getElementById("search").value = "";
    document.querySelectorAll(".facet-chip.active").forEach((el) => el.classList.remove("active"));
    renderCards();
  });
}
