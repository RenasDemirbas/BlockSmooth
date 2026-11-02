// Blockbench 5.x runtime globals used by BlockSmooth. Typed as `any`: the
// authoritative API is the running app (checked at load time in index.ts).
export {};

declare global {
  const __BLOCKSMOOTH_VERSION__: string;

  const window: any;
  const console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
  function structuredClone<T>(value: T): T;
  function setTimeout(fn: () => void, ms?: number): any;

  const Blockbench: any;
  const Plugin: any;
  const Project: any;
  const ModelProject: any;
  const Format: any;
  const Codecs: any;
  const Mesh: any;
  const MeshFace: any;
  const Property: any;
  const Canvas: any;
  const Undo: any;
  const Toolbox: any;
  const Modes: any;
  const BarItems: any;
  const Action: any;
  const Panel: any;
  const Setting: any;
  const Settings: any;
  const settings: any;
  const MenuBar: any;
  const Interface: any;
  const THREE: any;
}
