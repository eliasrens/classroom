/**
 * TANKEKARTANS TRÄD (issue #59) — grenar: varje bubbla har parentId
 * (null = huvudnivå, runt molnet). Rena funktioner, ingen DOM.
 *
 * Nivåer: huvudbubbla = 1, gren = 2, under-gren = 3 (MAX_DEPTH).
 */

export const MAX_DEPTH = 3;

/** id → nivå (1 = huvudnivå). Okända föräldrar räknas som huvudnivå. */
export function depths(bubbles) {
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const out = new Map();
  const depthOf = (b, guard = 0) => {
    if (out.has(b.id)) return out.get(b.id);
    const p = b.parentId && byId.get(b.parentId);
    const d = p && guard < bubbles.length ? depthOf(p, guard + 1) + 1 : 1;
    out.set(b.id, d);
    return d;
  };
  for (const b of bubbles) depthOf(b);
  return out;
}

/** Bubblorna i trädordning (förälder, dess grenar, nästa förälder …) — tabbordningen. */
export function treeOrder(bubbles) {
  const kids = new Map();
  const ids = new Set(bubbles.map((b) => b.id));
  const roots = [];
  for (const b of bubbles) {
    if (b.parentId && ids.has(b.parentId)) {
      if (!kids.has(b.parentId)) kids.set(b.parentId, []);
      kids.get(b.parentId).push(b);
    } else roots.push(b);
  }
  const out = [];
  const seen = new Set();
  const visit = (b) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    out.push(b);
    for (const c of kids.get(b.id) ?? []) visit(c);
  };
  for (const r of roots) visit(r);
  return out;
}

/** Bubblan och allt under den (id:n). */
export function subtreeIds(bubbles, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bubbles) {
      if (b.parentId && out.has(b.parentId) && !out.has(b.id)) { out.add(b.id); grew = true; }
    }
  }
  return out;
}

/**
 * Laga föräldrarna i en sparad lista (migrering och skydd mot skräp):
 * saknad/okänd förälder, sig själv eller en slinga → huvudnivå; för djupt
 * → flyttas upp till den djupaste tillåtna nivån. Äldre kartor (#53) har
 * inget parentId — alla bubblor blir huvudnivå.
 * bubbles = [{ id, parentId? }] → nya objekt med parentId: string | null
 */
export function repairParents(bubbles) {
  const ids = new Set(bubbles.map((b) => b.id));
  const parent = new Map(bubbles.map((b) => [b.id, typeof b.parentId === "string" && ids.has(b.parentId) && b.parentId !== b.id ? b.parentId : null]));
  for (const b of bubbles) {
    const seen = new Set([b.id]);
    let p = parent.get(b.id);
    while (p) {
      if (seen.has(p)) { parent.set(b.id, null); break; }
      seen.add(p);
      p = parent.get(p);
    }
  }
  const chainOf = (id) => {
    const chain = [];
    for (let p = parent.get(id); p; p = parent.get(p)) chain.push(p);
    return chain; // närmaste förälder först, huvudbubblan sist
  };
  for (const b of bubbles) {
    const chain = chainOf(b.id);
    if (chain.length >= MAX_DEPTH) parent.set(b.id, chain[chain.length - (MAX_DEPTH - 1)]);
  }
  return bubbles.map((b) => ({ ...b, parentId: parent.get(b.id) }));
}
