import type { TFunction } from 'i18next';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { WorldFriendVisitsOutput } from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';

type WorldDialogTab = { value: string };

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

export function contentTagLabel(tag: string, t: TFunction) {
    const localeKey = `dialog.world.tags.${tag}`;
    const localized = t(localeKey);
    return localized === localeKey ? tag.replace(/^content_/, '') : localized;
}

export function visibleWorldTags(world: WorldProfileRecord, t: TFunction) {
    const tags = world.tags;
    const warnings: Array<{ key: string; label: string }> = [];
    const restrictions: Array<{ key: string; label: string }> = [];
    const seenWarnings = new Set<string>();
    const seenRestrictions = new Set<string>();
    const pushWarning = (key: string, label: string) => {
        if (!key || seenWarnings.has(key)) {
            return;
        }
        seenWarnings.add(key);
        warnings.push({ key, label: label || key });
    };
    const pushRestriction = (key: string, label: string) => {
        if (!key || seenRestrictions.has(key)) {
            return;
        }
        seenRestrictions.add(key);
        restrictions.push({ key, label: label || key });
    };

    for (const [tag, localeKey, fallbackLabel] of visibleWorldFeatureTags) {
        if (!tags.includes(tag)) {
            continue;
        }
        const localized = t(localeKey);
        pushRestriction(
            tag,
            localized === localeKey ? fallbackLabel : localized
        );
    }

    const attributes: Array<{ key: string; label: string }> = [];
    if (tags.includes('debug_allowed')) {
        attributes.push({
            key: 'debug_allowed',
            label: t('dialog.world.tags.debug_allowed')
        });
    }
    const unityPackage = isRecord(world.unityPackage)
        ? world.unityPackage
        : null;
    if (world.unityPackageUrl || unityPackage?.url) {
        attributes.push({
            key: 'future_proofing',
            label: t('dialog.world.tags.future_proofing')
        });
    }
    for (const tag of tags) {
        if (String(tag).startsWith('content_')) {
            pushWarning(tag, contentTagLabel(String(tag), t));
        }
    }

    return { warnings, restrictions, attributes };
}

const FRIEND_VISIT_NAME_PREVIEW_LIMIT = 3;

export function friendVisitSummary(visits: WorldFriendVisitsOutput) {
    const names = visits.friends
        .slice(0, FRIEND_VISIT_NAME_PREVIEW_LIMIT)
        .map((row) => row.displayName)
        .filter(Boolean);
    if (!names.length) {
        return '';
    }
    const overflow = visits.friendCount - names.length;
    const preview = names.join(', ');
    return overflow > 0 ? `${preview} +${overflow}` : preview;
}
