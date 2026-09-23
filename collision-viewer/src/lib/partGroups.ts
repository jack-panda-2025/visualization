import * as THREE from 'three';

/**
 * Functional assemblies for part colouring.
 *
 * The mesh has 704 parts, which is far too many to read as colour: every
 * panel ends up its own hue and the vehicle turns back into noise. LS-DYNA
 * part names carry the structure needed to collapse them — they follow
 * `<num>_<assembly>_<name>` (`1_ob_hood`, `168_bw_roof`, `179_fr_railfrontleft`)
 * — but the assembly code is too coarse on its own: `ob` alone holds the hood,
 * fenders, bumper, doors and glazing. So the name is matched instead, which
 * gets 99% of nodes into twenty groups that correspond to how someone would
 * actually describe the vehicle.
 *
 * Order matters: the first pattern that matches wins.
 */
const RULES: [string, RegExp][] = [
  ['Barrier concrete', /concrete/],
  ['Barrier steel',    /steel tube|t lok|rebar|reinforcement/],
  ['Hood',             /hood/],
  ['Fender',           /fender/],
  ['Bumper',           /bumper|frontface|grille|tow/],
  ['Lights',           /headlight|taillight|lamp/],
  ['Glazing',          /windshield|window|glass|backlite/],
  ['Doors',            /door|lockplate|hinge/],
  ['Roof & cab rail',  /roof|cabrail/],
  ['Pillars',          /pillar/],
  ['Cab body',         /sidepanel|backwall|cabpanel|rocker|bodyside|quarter/],
  ['Bed',              /bed|tailgate/],   // before Floor: 'bd_bedfloor' is bed, not cab floor
  ['Floor & firewall', /floor|firewall|dash(?!.*screen)|tunnel/],
  ['Frame & rails',    /rail|xmember|crossmem|frame|bodymount|shackle|brkt|bracket|sidebar|cornersupport/],
  ['Powertrain',       /engine|transmiss|radiator|condensor|condenser|fan|gastank|fuel|battery|exhaust|muffler|oilpan|clutch|driveshaft|axle|axel|differen|diffen|manifold|fusebox/],
  ['Suspension',       /tire|rim|wheel|aarm|upright|spindle|disk|brake|shock|sway|spring|leaf|suspension|steering|knuckle|tierod|antitoll/],
  ['Occupant',         /seat|foam|dummy|belt|airbag|headrest|strap/],
  ['Instrument panel', /ipbeam|dashboard|glovebox|console|steeringcol/],
  ['Sensors',          /accelerom|sensor|nrb|rigid|spot weld/],
];

export const OTHER_GROUP = 'Other';

/** Hand-assigned rather than cycled: neighbouring assemblies get separable
 *  hues, the barrier stays neutral so the vehicle reads against it, and the
 *  crash-relevant front end gets the strongest colours. */
export const GROUP_COLORS: Record<string, string> = {
  'Barrier concrete': '#6b7076',
  'Barrier steel':    '#454c54',
  'Hood':             '#3d6fa0',
  'Fender':           '#3f8288',
  'Bumper':           '#a34a3f',
  'Lights':           '#c08a2a',
  'Glazing':          '#7fa8b8',
  'Doors':            '#7a7f3a',
  'Roof & cab rail':  '#4a5d8a',
  'Pillars':          '#6b5a8a',
  'Cab body':         '#4a7f52',
  'Floor & firewall': '#8a5a2b',
  'Frame & rails':    '#7f4a4a',
  'Bed':              '#8a7a4a',
  'Powertrain':       '#2f6b6b',
  'Suspension':       '#9a6b8a',
  'Occupant':         '#b08a2e',
  'Instrument panel': '#566370',
  'Sensors':          '#b5514c',
  [OTHER_GROUP]:      '#5c6169',
};

/** Group order for the legend — declaration order, with Other last. */
export const GROUP_ORDER = [...RULES.map(r => r[0]), OTHER_GROUP];

/** Assemblies that form the visible outside of the vehicle (plus the barrier
 *  it hits). Everything else — engine, frame, suspension, seats — sits inside
 *  the skin, where it contributes nothing to a surface render except pushing
 *  the envelope around and speckling the seams. Hidden by default. */
export const OUTER_GROUPS = new Set([
  'Barrier concrete', 'Barrier steel', 'Hood', 'Fender', 'Bumper', 'Lights',
  'Glazing', 'Doors', 'Roof & cab rail', 'Pillars', 'Cab body', 'Bed',
]);

export const INTERNAL_GROUPS = GROUP_ORDER.filter(g => !OUTER_GROUPS.has(g));

export function groupOf(partName: string): string {
  const n = partName.toLowerCase().replace(/^\d+_[a-z]+_/, '');
  for (const [group, pattern] of RULES) {
    if (pattern.test(n)) return group;
  }
  return OTHER_GROUP;
}

/** Per-node colour buffer, plus the groups actually present with their node
 *  counts, for the legend. */
export function buildGroupColors(
  partArr: Int32Array, n: number,
  parts: { id: number; name: string }[],
): {
  buf: Float32Array;
  /** Index into GROUP_ORDER for each node, for visibility filtering. */
  groupIdx: Uint8Array;
  legend: { group: string; nodes: number }[];
} {
  const groupById = new Map<number, string>();
  for (const p of parts) groupById.set(p.id, groupOf(p.name));

  const colorByGroup = new Map<string, THREE.Color>();
  for (const [g, hex] of Object.entries(GROUP_COLORS)) {
    colorByGroup.set(g, new THREE.Color(hex));
  }
  const fallback = colorByGroup.get(OTHER_GROUP)!;

  const orderIdx = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  const counts = new Map<string, number>();
  const buf = new Float32Array(n * 3);
  const groupIdx = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = groupById.get(partArr[i]) ?? OTHER_GROUP;
    counts.set(g, (counts.get(g) ?? 0) + 1);
    groupIdx[i] = orderIdx.get(g) ?? GROUP_ORDER.length - 1;
    const c = colorByGroup.get(g) ?? fallback;
    const i3 = i * 3;
    buf[i3] = c.r; buf[i3 + 1] = c.g; buf[i3 + 2] = c.b;
  }

  const legend = GROUP_ORDER
    .filter(g => counts.has(g))
    .map(g => ({ group: g, nodes: counts.get(g)! }));
  return { buf, groupIdx, legend };
}
