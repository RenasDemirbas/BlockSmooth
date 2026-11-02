// The data BlockSmooth stores on a mesh (saved in .bbmodel, part of undo):
// the modifier stack and the per-edge crease / sharp marks. Everything read
// from a file goes through readData, which never throws and clamps every value,
// so a hand-edited or newer file cannot break the viewport. Pure — no Blockbench globals.

export const DATA_VERSION = 1;

export const LIMITS = {
  levels: { min: 0, max: 4, default: 2 },
  exportLevels: { min: 0, max: 6, default: 2 },
  angle: { min: 0, max: 180, default: 30 },
  crease: { min: 0, max: 1 },
} as const;

export const MODIFIER_TYPES = ['subdivision', 'smooth_by_angle'] as const;
export type ModifierType = typeof MODIFIER_TYPES[number];

interface ModifierBase {
  id: string;
  /** Shown in the viewport. */
  viewport: boolean;
  /** Applied to exported files. */
  export: boolean;
}

export interface SubdivisionModifier extends ModifierBase {
  type: 'subdivision';
  /** Viewport levels. */
  levels: number;
  /** Levels in exported files. */
  export_levels: number;
}

export interface SmoothByAngleModifier extends ModifierBase {
  type: 'smooth_by_angle';
  /** Degrees: edges folded more than this shade sharp. */
  angle: number;
}

/** A modifier from a newer BlockSmooth: kept as-is so saving does not lose it, but ignored. */
export interface UnknownModifier extends ModifierBase {
  type: string;
  [key: string]: unknown;
}

export type Modifier = SubdivisionModifier | SmoothByAngleModifier;

export interface SmoothData {
  version: number;
  modifiers: (Modifier | UnknownModifier)[];
  /** Edge key (see edges.ts) -> crease 0-1; 1 = fully sharp in subdivision. */
  creases: Record<string, number>;
  /** Edge key -> 1: shade this edge sharp. */
  sharp: Record<string, 1>;
}

export function emptyData(): SmoothData {
  return { version: DATA_VERSION, modifiers: [], creases: {}, sharp: {} };
}

export function isKnownModifier(m: { type: string }): m is Modifier {
  return (MODIFIER_TYPES as readonly string[]).includes(m.type);
}

export function isEmpty(data: SmoothData): boolean {
  return !data.modifiers.length && !Object.keys(data.creases).length && !Object.keys(data.sharp).length;
}

/** Normalize anything (undefined, {}, old or hand-edited data) into valid SmoothData. */
export function readData(raw: unknown): SmoothData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  const src = raw as Record<string, any>;
  if (typeof src.version === 'number' && src.version > DATA_VERSION) data.version = src.version;

  const ids = new Set<string>();
  if (Array.isArray(src.modifiers)) {
    for (const m of src.modifiers) {
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') continue;
      const mod = isKnownModifier(m) ? normalizeModifier(m.type, m) : { ...m, ...base(m) } as UnknownModifier;
      while (ids.has(mod.id)) mod.id = newId();
      ids.add(mod.id);
      data.modifiers.push(mod);
    }
  }
  if (src.creases && typeof src.creases === 'object') {
    for (const [key, value] of Object.entries(src.creases)) {
      const c = clampNumber(value, LIMITS.crease.min, LIMITS.crease.max, 0);
      if (c > 0 && isEdgeKey(key)) data.creases[key] = c;
    }
  }
  if (src.sharp && typeof src.sharp === 'object') {
    for (const [key, value] of Object.entries(src.sharp)) {
      if (value && isEdgeKey(key)) data.sharp[key] = 1;
    }
  }
  return data;
}

/** A new modifier of the given type with defaults, then the patch (validated). */
export function createModifier(type: ModifierType, patch: Record<string, unknown> = {}): Modifier {
  return normalizeModifier(type, { ...patch, id: undefined });
}

/** The modifier with the patch applied and validated; "type" and "id" cannot change. */
export function patchModifier(mod: Modifier, patch: Record<string, unknown>): Modifier {
  return normalizeModifier(mod.type, { ...mod, ...patch, id: mod.id, type: mod.type });
}

function normalizeModifier(type: ModifierType, m: Record<string, any>): Modifier {
  if (type === 'subdivision') {
    const levels = clampInt(m.levels, LIMITS.levels.min, LIMITS.levels.max, LIMITS.levels.default);
    return {
      type, ...base(m), levels,
      export_levels: clampInt(m.export_levels, LIMITS.exportLevels.min, LIMITS.exportLevels.max, levels),
    };
  }
  return { type, ...base(m), angle: clampNumber(m.angle, LIMITS.angle.min, LIMITS.angle.max, LIMITS.angle.default) };
}

function base(m: Record<string, any>): ModifierBase {
  return {
    id: typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(m.id) ? m.id : newId(),
    viewport: m.viewport !== false,
    export: m.export !== false,
  };
}

function isEdgeKey(key: string): boolean {
  return key.length >= 3 && key.length <= 128 && key.includes('_');
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}
