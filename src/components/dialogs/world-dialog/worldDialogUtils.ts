export function resolveWorldDialogTab(
    tabs: any,
    preferred: any,
    fallback: any = 'instances'
) {
    return tabs.some((tab: any) => tab.value === preferred)
        ? preferred
        : fallback;
}

export function authorWorldTags(tags: any[] = []) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .filter((tag: any) => String(tag).startsWith('author_tag_'))
        .map((tag: any) => String(tag).replace(/^author_tag_/, ''))
        .filter(Boolean);
}

export function firstKnownValue(...values: any[]) {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
}

const visibleWorldFeatureTags = [
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

export function visibleWorldTags(world: any, t: any) {
    const tags = Array.isArray(world?.tags) ? world.tags : [];
    const entries: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    const pushTag = (key: any, label: any) => {
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
    if (world?.unityPackageUrl || world?.unityPackage?.url) {
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
