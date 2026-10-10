# InlineCMS source conventions

User-visible copy must remain easy to trace to a source literal:

- Write copy as plain strings in JSX, quoted props, or expression-free template literals.
- Keep repeated cards, testimonials, FAQ entries and other structured copy in `content/*.ts` data modules with semantic names, then render them with `.map()`.
- Keep each sentence in one literal; avoid concatenating strings or interpolating fragments of prose.
- Use existing locale JSON message files for translated copy. Preserve message IDs and placeholders.
- Preserve source locators generated at build time; do not add `data-src` by hand.
- After rearranging content, run `inlinecms doctor` against a running development site. Resolve duplicate literals with semantic data organization where sensible.

Source is the only content store. Do not add `cms()`, structural content keys, or `content.{locale}.json` override layers.
