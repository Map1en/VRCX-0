import type { TFunction } from 'i18next';

import type { InstanceCreateOption } from '@/platform/tauri/bindings';

export const INSTANCE_DISPLAY_NAME_MAX = 128;
export const INSTANCE_DESCRIPTION_MAX = 256;
export const INSTANCE_VIBE_LIMIT = 3;
export const INSTANCE_LANGUAGE_LIMIT = 3;

export type InstanceCreateOptionKind = 'category' | 'vibe';

function optionTranslationSlug(name: string) {
    return name
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function instanceCreateOptionTranslation(
    option: InstanceCreateOption,
    kind: InstanceCreateOptionKind,
    t: TFunction
) {
    const slug = optionTranslationSlug(option.name);
    const translated = slug
        ? t(`dialog.new_instance.${kind}_options.${slug}`, {
              defaultValue: ''
          })
        : '';
    return translated !== option.name ? translated : '';
}

export function instanceCreateOptionLabel(
    option: InstanceCreateOption,
    kind: InstanceCreateOptionKind,
    t: TFunction
) {
    const translated = instanceCreateOptionTranslation(option, kind, t);
    return translated ? `${option.name} (${translated})` : option.name;
}

export function pickInstanceCreateOptionIds(
    ids: readonly string[],
    options: readonly InstanceCreateOption[]
) {
    const offered = new Set(options.map((option) => option.id));
    return ids.filter((id) => offered.has(id));
}
