// User settings (File > Preferences > Settings).

import { Lifecycle, type Deletable } from '../util/lifecycle';

export const SETTING_VIEWPORT = 'blocksmooth_viewport';
export const SETTING_EXPORT = 'blocksmooth_apply_on_export';

export function registerSettings(onViewportChange: () => void): Deletable {
  const life = new Lifecycle();
  life.add(new Setting(SETTING_VIEWPORT, {
    name: 'BlockSmooth: Show Modifiers in Viewport',
    description: 'Draw meshes with their BlockSmooth modifiers (subdivision, smooth by angle). Turn off to see and edit only the cages.',
    category: 'preview',
    type: 'toggle',
    value: true,
    onChange: onViewportChange,
  }));
  life.add(new Setting(SETTING_EXPORT, {
    name: 'BlockSmooth: Apply Modifiers on Export',
    description: 'OBJ, FBX, Collada, glTF and STL exports contain the subdivided, smooth-shaded meshes. The .bbmodel project file always keeps the editable cages.',
    category: 'export',
    type: 'toggle',
    value: true,
  }));
  return { delete: () => life.dispose() };
}

export function settingEnabled(id: string): boolean {
  const value = Settings?.get?.(id);
  return value === undefined ? true : !!value;
}
