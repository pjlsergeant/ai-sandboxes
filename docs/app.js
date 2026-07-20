// please do not escape — minimal client-side renderer for ai-sandboxes.yaml
// No build step: fetch the live YAML from GitHub, parse, render, filter.

const RAW_URL = "https://raw.githubusercontent.com/pjlsergeant/ai-sandboxes/main/ai-sandboxes.yaml";
const FALLBACK_URL = "../ai-sandboxes.yaml"; // works if this page happens to be served alongside the data file

const state = {
  data: null,
  filters: {
    threat_tier: new Set(),
    execution_locus: new Set(),
    license_bucket: new Set(),
  },
};

// The three upfront questions (adapted from the dataset's own
// `ui.decision_funnel` — "what are you afraid of" / "where must code run"
// are its two highest-signal questions) plus a license/pricing pick. This is
// the entire filter UI: no separate "advanced" tier of raw taxonomy facets —
// isolation boundary, network policy, credential mediation etc. are still
// shown as badges/facts on every card, just not filterable, since a facet
// wall for 7+ dimensions (2 of them 20+ values even deduped) was worse than
// just reading the cards.
const QUICKSTART_DEFS = [
  {
    key: "threat_tier",
    heading: "What are you worried about?",
    getter: (e) => list(get(e, "risk.assessed_tiers")),
    taxonomy: "threat_tier",
    // A sliding scale (accidents -> exfiltration -> hostile escape), not
    // independent categories, so only one applies at a time.
    singleSelect: true,
  },
  {
    key: "execution_locus",
    heading: "Where should it run?",
    getter: (e) => single(get(e, "classification.execution_locus")),
    taxonomy: "execution_locus",
  },
  {
    key: "license_bucket",
    heading: "Open-source, or a product?",
    // Buckets the `license` field's 3 real values in this dataset (a real
    // OSS license, "product_feature", or "proprietary_service") rather than
    // pricing — pricing has an awkward misfit (Fly Sprites' pure usage-based
    // metering isn't free, subscription, or enterprise); license doesn't.
    getter: (e) => {
      const lic = single(get(e, "license"))[0];
      if (!lic) return [];
      if (lic === "product_feature") return ["product_feature"];
      if (lic === "proprietary_service") return ["product"];
      return ["open_source"];
    },
    order: ["open_source", "product_feature", "product"],
    labels: { open_source: "Open-source", product_feature: "Product feature", product: "Product" },
  },
];

// Pre-checked on load: the two most common starting questions — "I'm mostly
// worried about accidents" and "it should run on my own machine". Adjacent
// tools & DIY patterns mostly lack these fields entirely, so this also has
// the effect of quietly focusing the default view on principal sandboxes;
// the "adjacent tools & patterns" checkbox clears both to widen it back out.
const DEFAULT_QUICKSTART = { threat_tier: "t1_accidents", execution_locus: "local" };

function applyDefaultQuickstart() {
  state.filters.threat_tier = new Set([DEFAULT_QUICKSTART.threat_tier]);
  state.filters.execution_locus = new Set([DEFAULT_QUICKSTART.execution_locus]);
}

init();

async function init() {
  bindStaticControls();
  try {
    const text = await fetchYaml();
    state.data = jsyaml.load(text);
    applyDefaultQuickstart();
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

// The single most appropriate page to send someone to, in priority order —
// dedicated docs first, then the official site, then source, then whatever
// write-up exists; pricing is never a good first stop.
const PRIMARY_URL_PRIORITY = [
  ["docs", "Read the docs"],
  ["official", "Visit site"],
  ["repo", "View repo"],
  ["engineering", "Read the writeup"],
  ["security", "Read the security docs"],
  ["blog", "Read the blog post"],
  ["related_blog", "Read the blog post"],
  ["containment", "Read the writeup"],
];
// Per-entry override of which url key wins as primary, for cases where the
// default priority order picks the "correct" but not most-wanted page —
// byre's docs site is real, but this dataset points people at the repo.
const PRIMARY_URL_OVERRIDE = { byre: "repo" };

function pickPrimaryUrl(urls, entryId) {
  const overrideKey = PRIMARY_URL_OVERRIDE[entryId];
  if (overrideKey && urls[overrideKey]) {
    const entry = PRIMARY_URL_PRIORITY.find(([key]) => key === overrideKey);
    return { url: urls[overrideKey], label: entry ? entry[1] : "Visit" };
  }
  for (const [key, label] of PRIMARY_URL_PRIORITY) {
    if (urls[key]) return { url: urls[key], label };
  }
  const first = Object.entries(urls).find(([, v]) => v);
  return first ? { url: first[1], label: `Visit (${humanize(first[0])})` } : null;
}

function taxonomyLabel(data, taxonomyKey, id) {
  if (!taxonomyKey) return humanize(id);
  const entries = data.taxonomy[taxonomyKey];
  if (!entries) return humanize(id);
  const match = entries.find((e) => e.id === id);
  return match ? match.label : humanize(id);
}

function taxonomyDescription(data, taxonomyKey, id) {
  if (!taxonomyKey) return null;
  const entries = data.taxonomy[taxonomyKey];
  const match = entries && entries.find((e) => e.id === id);
  return match ? match.description || null : null;
}

// ---- facets -------------------------------------------------------------

function makeChip(facet, val) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "facet-chip";
  btn.textContent = facet.labels ? facet.labels[val] : taxonomyLabel(state.data, facet.taxonomy, val);
  const desc = facet.labels ? null : taxonomyDescription(state.data, facet.taxonomy, val);
  if (desc) btn.title = desc;
  btn.dataset.facet = facet.key;
  btn.dataset.value = val;
  if (state.filters[facet.key].has(val)) btn.classList.add("active");
  btn.addEventListener("click", () => {
    const set = state.filters[facet.key];
    if (facet.singleSelect) {
      const wasActive = set.has(val);
      set.clear();
      btn.parentElement.querySelectorAll(".facet-chip.active").forEach((el) => el.classList.remove("active"));
      if (!wasActive) {
        set.add(val);
        btn.classList.add("active");
      }
    } else {
      set.has(val) ? set.delete(val) : set.add(val);
      btn.classList.toggle("active");
    }
    renderCards();
  });
  return btn;
}

// Taxonomy-backed facets render in the taxonomy's own declared order (it's
// already meaningful — weakest-to-strongest, local-first, etc.) rather than
// alphabetically; license_bucket has its own explicit `order` instead since
// it isn't a real taxonomy, just a display bucketing of the `license` field.
function valuesFor(facet) {
  const present = new Set();
  for (const entry of allEntries()) {
    for (const v of facet.getter(entry)) present.add(v);
  }
  if (facet.order) {
    return facet.order.filter((id) => present.has(id));
  }
  if (facet.taxonomy && state.data.taxonomy[facet.taxonomy]) {
    return state.data.taxonomy[facet.taxonomy]
      .map((t) => t.id)
      .filter((id) => present.has(id));
  }
  return [...present].sort();
}

function renderQuickstart() {
  const container = document.getElementById("quickstart");
  container.innerHTML = "";
  for (const facet of QUICKSTART_DEFS) {
    const values = valuesFor(facet);
    if (values.length === 0) continue;

    const row = document.createElement("div");
    row.className = "quickstart-row";
    const h4 = document.createElement("h4");
    h4.textContent = facet.heading;
    row.appendChild(h4);

    const chips = document.createElement("div");
    chips.className = "facet-chips";
    values.forEach((val) => chips.appendChild(makeChip(facet, val)));
    row.appendChild(chips);
    container.appendChild(row);
  }
}

function renderFacets() {
  renderQuickstart();
}

function allEntries() {
  return [...state.data.sandboxes, ...state.data.adjacent];
}

// ---- filtering ------------------------------------------------------------

function matchesFilters(entry) {
  for (const facet of QUICKSTART_DEFS) {
    const active = state.filters[facet.key];
    if (active.size === 0) continue;
    const values = facet.getter(entry);
    if (!values.some((v) => active.has(v))) return false;
  }
  return true;
}

// ---- rendering ------------------------------------------------------------

function renderCards() {
  const container = document.getElementById("cards");
  container.innerHTML = "";

  // "Adjacent tools & patterns" is an alternative to the sandboxes, not an
  // addition to them — checking it swaps the view entirely.
  const showingAdjacent = document.getElementById("showAdjacent").checked;
  const pool = showingAdjacent ? state.data.adjacent : state.data.sandboxes;
  const results = pool.filter(matchesFilters);

  // Pin byre to the top, glowing, when (and only when) it's honestly part of
  // the current result set — we don't force it into results that don't
  // match what was actually asked for, that would defeat the point of an
  // evidence-carrying dataset. See the cheeky note rendered on its card.
  const byreIdx = results.findIndex((e) => e.id === "byre");
  if (byreIdx > 0) results.unshift(results.splice(byreIdx, 1)[0]);

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
    container.appendChild(renderCard(entry, showingAdjacent));
  }
  void template;
}

// One Font Awesome icon per facet dimension, so the table reads at a glance
// without repeating "Isolation boundary: / Network policy: / ..." labels.
const FACET_ICONS = {
  isolation_boundary: "fa-solid fa-shield-halved",
  network_policy: "fa-solid fa-network-wired",
  credential_mediation: "fa-solid fa-key",
  pricing_model: "fa-solid fa-tag",
};

function facetTableRow(iconKey, label, labelText, claim) {
  const tr = document.createElement("tr");

  const iconTd = document.createElement("td");
  iconTd.className = "facet-icon";
  const icon = document.createElement("i");
  icon.className = FACET_ICONS[iconKey];
  icon.title = label;
  iconTd.appendChild(icon);

  const labelTd = document.createElement("td");
  labelTd.className = "facet-label";
  labelTd.textContent = label;

  const valueTd = document.createElement("td");
  valueTd.className = "facet-value" + (claim.ev !== "official" ? ` ev-${claim.ev}` : "");
  valueTd.textContent = labelText;
  if (claim.basis) valueTd.title = claim.basis;

  tr.append(iconTd, labelTd, valueTd);
  return tr;
}

// A claim's `src` always resolves (resolveClaim defaults it to the entry's
// default_source), so every row here can cite something real.
function detailRow(label, text, claim) {
  const row = document.createElement("div");
  row.className = "detail-row";

  const head = document.createElement("div");
  head.className = "detail-row-head";
  const labelSpan = document.createElement("span");
  labelSpan.className = "detail-label";
  labelSpan.textContent = `${label}:`;
  const textSpan = document.createElement("span");
  textSpan.textContent = ` ${text} `;
  const evSpan = document.createElement("span");
  evSpan.className = `detail-ev ev-${claim.ev}`;
  evSpan.textContent = claim.ev;
  head.append(labelSpan, textSpan, evSpan);
  row.appendChild(head);

  const src = state.data.sources[claim.src];
  const sourceLine = document.createElement("div");
  sourceLine.className = "detail-source";
  sourceLine.append("source: ");
  if (src && src.url) {
    const a = document.createElement("a");
    a.href = src.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = src.title;
    sourceLine.appendChild(a);
  } else {
    sourceLine.append(document.createTextNode(src ? src.title : claim.src || "unsourced"));
  }
  row.appendChild(sourceLine);

  if (claim.basis) {
    const basisLine = document.createElement("div");
    basisLine.className = "detail-basis";
    basisLine.textContent = claim.basis;
    row.appendChild(basisLine);
  }

  return row;
}

function renderCard(entry, isAdjacent) {
  const node = document.getElementById("cardTemplate").content.cloneNode(true);
  const card = node.querySelector(".card");
  card.classList.toggle("is-adjacent", isAdjacent);

  // The primary link (the single most appropriate page for this entry) is
  // used twice: the obvious title link, and the footer button.
  const urls = entry.urls || {};
  const primary = pickPrimaryUrl(urls, entry.id);
  const titleLink = node.querySelector(".card-title-link");
  titleLink.textContent = entry.name;
  if (primary) {
    titleLink.href = primary.url;
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
  } else {
    // No urls at all for this entry: plain text title, no dangling link.
    node.querySelector(".card-title").textContent = entry.name;
  }

  // Every claim shown on this card gets logged here as {label, text, claim},
  // so the "Show details" panel can cite an actual source for each one --
  // otherwise "a source cited for every claim" is just something the
  // tagline says, not something you can go check.
  const detailEntries = [];

  const roleClaim = resolveClaim(getRole(entry), entry);
  node.querySelector(".card-role").textContent = roleClaim
    ? taxonomyLabel(state.data, "product_role", roleClaim.value)
    : "";
  if (roleClaim) detailEntries.push({ label: "Role", text: taxonomyLabel(state.data, "product_role", roleClaim.value), claim: roleClaim });

  const taglineClaim = resolveClaim(entry.tagline ?? entry.summary, entry);
  node.querySelector(".card-tagline").textContent = taglineClaim ? taglineClaim.value : "";
  if (taglineClaim) detailEntries.push({ label: entry.tagline ? "Tagline" : "Summary", text: taglineClaim.value, claim: taglineClaim });

  if (entry.id === "byre") {
    card.classList.add("is-byre");
    const note = document.createElement("p");
    note.className = "byre-note";
    note.innerHTML =
      "I wrote <a href=\"https://github.com/pjlsergeant/byre\" target=\"_blank\" rel=\"noopener\">byre</a>, so I think it's great, and that's why there's a box around it.";
    node.querySelector(".card-tagline").insertAdjacentElement("afterend", note);
  }

  // Facet table: the four classification facets + pricing, when present,
  // one icon-labeled row each.
  const facetTableBody = node.querySelector(".card-facet-table tbody");
  const facetFields = [
    ["classification.isolation_boundary", "isolation_boundary", "Isolation"],
    ["classification.network_policy", "network_policy", "Network"],
    ["classification.credential_mediation", "credential_mediation", "Credentials"],
    ["pricing.model", "pricing_model", "Pricing"],
  ];
  for (const [path, taxonomyKey, label] of facetFields) {
    const raw = get(entry, path);
    if (raw === undefined) continue;
    const claim = resolveClaim(raw, entry);
    const text = taxonomyLabel(state.data, taxonomyKey, claim.value);
    facetTableBody.appendChild(facetTableRow(taxonomyKey, label, text, claim));
    detailEntries.push({ label, text, claim });
  }
  if (!facetTableBody.children.length) node.querySelector(".card-facet-table").remove();

  // Facts: maturity, license, platforms, agents supported, audience.
  const factsEl = node.querySelector(".card-facts");
  const facts = [
    ["Maturity", entry.maturity, null],
    ["License", entry.license, null],
    ["Platforms", entry.platforms, "platforms"],
    ["Agents", entry.agents_supported, "agents_supported"],
    ["Audience", entry.audience, null],
  ];
  for (const [label, raw, taxonomyKey] of facts) {
    if (raw === undefined) continue;
    const claim = resolveClaim(raw, entry);
    const labelFor = (v) => taxonomyLabel(state.data, taxonomyKey, v);
    const value = Array.isArray(claim.value) ? claim.value.map(labelFor).join(", ") : labelFor(claim.value);
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (claim.ev !== "official") dd.title = `(${claim.ev}) ${claim.basis || ""}`.trim();
    factsEl.appendChild(dt);
    factsEl.appendChild(dd);
    detailEntries.push({ label, text: value, claim });
  }

  // Limitations (or, for adjacent entries, the risk basis) as a short list.
  const limsEl = node.querySelector(".card-limitations");
  const limitations = (entry.limitations || []).map((l) => resolveClaim(l, entry)).filter(Boolean);
  if (limitations.length) {
    const ul = document.createElement("ul");
    for (const c of limitations) {
      const li = document.createElement("li");
      li.textContent = c.value;
      if (c.ev !== "official") li.title = `(${c.ev}) ${c.basis || ""}`.trim();
      ul.appendChild(li);
      detailEntries.push({ label: "Limitation", text: c.value, claim: c });
    }
    limsEl.appendChild(ul);
  } else {
    limsEl.remove();
  }

  // Show details: opens the single shared modal with every claim logged
  // above, each with its actual source linked (not just a hover tooltip on
  // the basis, which is easy to miss).
  node.querySelector(".card-details-toggle").addEventListener("click", () => {
    openDetailsModal(entry.name, detailEntries);
  });

  // Footer: the same primary link again as an obvious button, plus the rest
  // as smaller secondary links.
  const primaryEl = node.querySelector(".card-primary-link");
  if (primary) {
    primaryEl.href = primary.url;
    primaryEl.target = "_blank";
    primaryEl.rel = "noopener";
    primaryEl.textContent = `${primary.label} →`;
  } else {
    primaryEl.remove();
  }

  const linksEl = node.querySelector(".card-links");
  for (const [label, url] of Object.entries(urls)) {
    if (!url || (primary && url === primary.url)) continue;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = humanize(label);
    linksEl.appendChild(a);
  }
  const src = state.data.sources[entry.default_source];
  if (src && src.url && !Object.values(urls).includes(src.url) && (!primary || src.url !== primary.url)) {
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

function openDetailsModal(entryName, detailEntries) {
  const modal = document.getElementById("detailsModal");
  document.getElementById("detailsModalTitle").textContent = entryName;
  const body = document.getElementById("detailsModalBody");
  body.innerHTML = "";
  for (const { label, text, claim } of detailEntries) {
    body.appendChild(detailRow(label, text, claim));
  }
  modal.showModal();
}

function bindStaticControls() {
  const modal = document.getElementById("detailsModal");
  document.getElementById("detailsModalClose").addEventListener("click", () => modal.close());
  // Click on the backdrop (::backdrop is unclickable-through, so a click
  // that lands on the <dialog> element itself, outside its content box, is
  // a backdrop click) closes it too, same as the native close button.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close();
  });

  document.getElementById("clearFilters").addEventListener("click", () => {
    // "Clear filters" means "back to how the page loaded": defaults
    // restored, not everything wiped blank — a true blank slate is what
    // the checkbox above is for.
    document.getElementById("showAdjacent").checked = false;
    document.getElementById("quickstart").hidden = false;
    state.filters.license_bucket.clear();
    applyDefaultQuickstart();
    renderQuickstart();
    renderCards();
  });
  document.getElementById("showAdjacent").addEventListener("change", (e) => {
    // This isn't "clear a couple of filters" — adjacent tools & DIY patterns
    // are a genuinely different kind of thing (non-product approaches, not
    // sandboxes with a threat model / execution locus / license), so the
    // quickstart questions themselves don't apply and are hidden, not just
    // reset to empty.
    document.getElementById("quickstart").hidden = e.target.checked;
    if (e.target.checked) {
      for (const def of QUICKSTART_DEFS) state.filters[def.key].clear();
    } else {
      applyDefaultQuickstart();
    }
    renderQuickstart();
    renderCards();
  });
}
