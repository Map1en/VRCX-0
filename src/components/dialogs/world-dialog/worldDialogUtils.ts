import type { TFunction } from 'i18next';

import type { WorldProfileRecord } from '@/domain/entities/profileEntities';

type WorldDialogTab = { value: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function resolveWorldDialogTab(
    tabs: readonly WorldDialogTab[],
    preferred: string,
    fallback = 'instances'
) {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

export function authorWorldTags(tags: unknown = []) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .filter((tag) => String(tag).startsWith('author_tag_'))
        .map((tag) => String(tag).replace(/^author_tag_/, ''))
        .filter(Boolean);
}

export function firstKnownValue<T>(
    ...values: Array<T | null | undefined | ''>
): T | undefined {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
}

const visibleWorldFeatureTags: Array<
    [tag: string, localeKey: string, fallbackLabel: string]
> = [
    [
        'feature_avatar_scaling_disabled',
        'dialog.world.tags.avatar_scaling_disabled',
        'Avatar scaling disabled'
    ],
    [
        'feature_focus_view_disabled',
        'dialog.world.tags.focus_view_disabled',
        'Focus view disabled'
    ],
    [
        'feature_emoji_disabled',
        'dialog.world.tags.emoji_disabled',
        'Emoji disabled'
    ],
    [
        'feature_stickers_disabled',
        'dialog.world.tags.stickers_disabled',
        'Stickers disabled'
    ],
    [
        'feature_pedestals_disabled',
        'dialog.world.tags.pedestals_disabled',
        'Pedestals disabled'
    ],
    [
        'feature_prints_disabled',
        'dialog.world.tags.prints_disabled',
        'Prints disabled'
    ],
    [
        'feature_drones_disabled',
        'dialog.world.tags.drones_disabled',
        'Drones disabled'
    ],
    [
        'feature_props_disabled',
        'dialog.world.tags.props_disabled',
        'Items disabled'
    ],
    [
        'feature_third_person_view_disabled',
        'dialog.world.tags.third_person_view_disabled',
        'Third person disabled'
    ]
];

export function visibleWorldTags(world: WorldProfileRecord, t: TFunction) {
    const tags = world.tags;
    const entries: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    const pushTag = (key: string, label: string) => {
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push({ key, label: label || key });
    };

    for (const [tag, localeKey, fallbackLabel] of visibleWorldFeatureTags) {
        if (!tags.includes(tag)) {
            continue;
        }
        const localized = t(localeKey);
        pushTag(tag, localized === localeKey ? fallbackLabel : localized);
    }

    if (tags.includes('debug_allowed')) {
        pushTag('debug_allowed', 'Debug allowed');
    }
    const unityPackage = isRecord(world.unityPackage)
        ? world.unityPackage
        : null;
    if (world.unityPackageUrl || unityPackage?.url) {
        pushTag('future_proofing', t('dialog.world.tags.future_proofing'));
    }
    for (const tag of tags) {
        if (String(tag).startsWith('content_')) {
            const localeKey = `dialog.world.tags.${tag}`;
            const localized = t(localeKey);
            pushTag(
                tag,
                localized === localeKey
                    ? String(tag).replace(/^content_/, '')
                    : localized
            );
        }
    }

    return entries;
}
