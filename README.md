# AI Agent Sandboxes

A structured, evidence-carrying dataset of sandboxes and adjacent approaches
for running AI coding agents (Claude Code, Codex, etc.) with some form of
isolation, network control, or credential mediation. It powers
[pleasedonotescape.com](https://pleasedonotescape.com).

Started from the [Show HN: Clawk](https://news.ycombinator.com/item?id=48892859)
thread and the official docs it cited; entries added since then are marked
accordingly (see each entry's `thread_status`).

## The data

Everything lives in [`ai-sandboxes.yaml`](ai-sandboxes.yaml):

- `taxonomy` — closed vocabularies for filterable facets (isolation boundary,
  network policy, credential mediation, threat tiers, etc.)
- `sources` — a registry of primary sources, referenced by id
- `sandboxes` — principal entries (sandbox runtimes, policy wrappers, remote
  workspaces, ...)
- `adjacent` — related tools and DIY patterns with a lighter schema

Every non-identity field is a **claim**, not a bare rating: it's either a
plain scalar (shorthand for an `official`-evidence claim sourced from the
entry's `default_source`) or a claim object with `{value, ev, src, basis,
derived_from}`. `ev: editorial` claims must state their `basis`. See the
`conventions` and `evidence_levels` keys in the YAML for the full rules.

## Updating

Add entries following the existing shape, keep every claim's evidence
traceable to a source in the `sources` registry, and bump `meta.version`
with a short changelog note at the top of the file.

## The site

[pleasedonotescape.com](https://pleasedonotescape.com) is a static page (in
[`docs/`](docs/)) that loads the live YAML from `main` and renders it as
filterable cards, flagging any claim that isn't backed by official sources.

## Shameless plug

One of the entries in here, [byre](https://github.com/pjlsergeant/byre), is
mine. Its whole pitch is being *comfortable* — a local container that feels
like your own machine, not a security appliance you have to fight. Give it
a look!

