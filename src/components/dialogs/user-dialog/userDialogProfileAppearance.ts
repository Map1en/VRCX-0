import type { InventoryItemRecord } from '@/repositories/vrchatMediaRepository';
import {
    profileBackgroundAssetUrl,
    profileBackgroundFileList
} from '@/shared/constants/profileBackgrounds';
import { isRecord } from '@/shared/utils/record';

import type {
    UserDialogProfileRecord,
    UserDialogProfileSnapshot
} from './userDialogProfileTypes';

const PROFILE_ENDPOINT_FIELDS = [
    'backgroundGradientBottom',
    'backgroundGradientTop',
    'backgroundTemplateId',
    'backgroundTextureId',
    'backgroundType',
    'badges',
    'bannerColor',
    'bannerCustomUrl',
    'bannerType',
    'bannerUrl',
    'bio',
    'bioLinks',
    'hasVrcPlus',
    'iconFrame',
    'iconType',
    'iconUrl',
    'isEconomyCreator',
    'nameplateEffect',
    'profileEffect',
    'pronouns',
    'themeId',
    'themes',
    'userIcon'
] as const;

type ProfileEndpointField = (typeof PROFILE_ENDPOINT_FIELDS)[number];

export const PROFILE_DECORATION_SLOTS = [
    'iconFrame',
    'profileEffect',
    'nameplateEffect'
] as const;

export type ProfileDecorationSlot = (typeof PROFILE_DECORATION_SLOTS)[number];

export type UserDialogProfileAppearance = Partial<
    Record<ProfileDecorationSlot, InventoryItemRecord>
>;

export type UserDialogProfileAppearanceVisibility = {
    profileBackground: boolean;
    avatarFrame: boolean;
    profileEffect: boolean;
    nameplateEffect: boolean;
};

export type UserDialogProfileAppearanceOverride =
    | {
          action: 'equip';
          item: InventoryItemRecord;
          templateId: string;
      }
    | { action: 'unequip' };

export type UserDialogProfileAppearanceOverrides = Partial<
    Record<ProfileDecorationSlot, UserDialogProfileAppearanceOverride>
>;

type ProfileDecorationAssetUrls = {
    animatedUrl: string;
    staticUrl: string;
};

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function mergeUserDialogProfileAppearance(
    user: UserDialogProfileSnapshot,
    appearance: unknown,
    targetUserId: string
): UserDialogProfileSnapshot {
    if (!user || !isRecord(appearance)) {
        return user;
    }

    const responseUserId = normalizeText(appearance.id);
    if (responseUserId && responseUserId !== normalizeText(targetUserId)) {
        return user;
    }

    return applyProfileEndpointFields(user, appearance, (field) =>
        Object.prototype.hasOwnProperty.call(appearance, field)
    );
}

export function preserveUserDialogProfileAppearance(
    user: UserDialogProfileSnapshot,
    previousUser: UserDialogProfileSnapshot
): UserDialogProfileSnapshot {
    if (!user || !previousUser) {
        return user;
    }

    return applyProfileEndpointFields(
        user,
        previousUser,
        (field) =>
            !Object.prototype.hasOwnProperty.call(user, field) &&
            Object.prototype.hasOwnProperty.call(previousUser, field)
    );
}

export function retainUserDialogProfileAppearance(
    user: UserDialogProfileSnapshot,
    previousUser: UserDialogProfileSnapshot
): UserDialogProfileSnapshot {
    if (!user || !previousUser) {
        return user;
    }

    return applyProfileEndpointFields(user, previousUser, (field) =>
        Object.prototype.hasOwnProperty.call(previousUser, field)
    );
}

function applyProfileEndpointFields(
    user: UserDialogProfileRecord,
    source: Record<string, unknown>,
    shouldCopy: (field: ProfileEndpointField) => boolean
): UserDialogProfileRecord {
    const patch: Record<string, unknown> = {};
    for (const field of PROFILE_ENDPOINT_FIELDS) {
        if (shouldCopy(field)) {
            patch[field] = source[field];
        }
    }
    return Object.keys(patch).length ? { ...user, ...patch } : user;
}

export function applyUserDialogProfileAppearanceOverrides(
    appearance: UserDialogProfileAppearance,
    overrides: UserDialogProfileAppearanceOverrides
): UserDialogProfileAppearance {
    let nextAppearance = appearance;
    for (const slot of PROFILE_DECORATION_SLOTS) {
        const override = overrides[slot];
        if (!override) {
            continue;
        }
        if (
            override.action === 'equip' &&
            override.templateId &&
            appearance[slot]?.id === override.templateId
        ) {
            continue;
        }
        if (nextAppearance === appearance) {
            nextAppearance = { ...appearance };
        }
        if (override.action === 'equip') {
            nextAppearance[slot] = override.item;
        } else {
            delete nextAppearance[slot];
        }
    }
    return nextAppearance;
}

export function normalizeProfileAppearanceColor(value: unknown): string {
    const color = normalizeText(value).replace(/^#/, '');
    return /^[\da-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : '';
}

const PROFILE_GRADIENT_MAX_SCRIM = 0.55;
const PROFILE_GRADIENT_DARK_THEME_RANGE = { safe: 0.3, unsafe: 0.75 };
const PROFILE_GRADIENT_LIGHT_THEME_RANGE = { safe: 0.55, unsafe: 0.12 };

function linearizeChannel(value: number): number {
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
    const [red, green, blue] = [1, 3, 5].map((offset) =>
        linearizeChannel(
            Number.parseInt(color.slice(offset, offset + 2), 16) / 255
        )
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function scrimForColor(value: string, isDarkTheme: boolean): number {
    const color = normalizeProfileAppearanceColor(value);
    if (!color) {
        return 0;
    }
    const { safe, unsafe } = isDarkTheme
        ? PROFILE_GRADIENT_DARK_THEME_RANGE
        : PROFILE_GRADIENT_LIGHT_THEME_RANGE;
    const progress = (relativeLuminance(color) - safe) / (unsafe - safe);
    return Math.min(Math.max(progress, 0), 1) * PROFILE_GRADIENT_MAX_SCRIM;
}

export function resolveProfileGradientScrimAlpha(
    topColor: string,
    bottomColor: string,
    isDarkTheme: boolean
): number {
    return Math.max(
        scrimForColor(topColor, isDarkTheme),
        scrimForColor(bottomColor, isDarkTheme)
    );
}

export function resolveUserDialogBackgroundTextureUrl(
    profile: UserDialogProfileRecord
): string {
    const fileName =
        profileBackgroundFileList[normalizeText(profile.backgroundTextureId)];
    return fileName ? `${profileBackgroundAssetUrl}${fileName}` : '';
}

export function resolveUserDialogBannerUrl(
    profile: UserDialogProfileRecord
): string {
    if (normalizeText(profile.bannerType) === 'color') {
        return '';
    }
    return (
        normalizeText(profile.bannerUrl) ||
        normalizeText(profile.bannerCustomUrl)
    );
}

export function resolveProfileDecorationAssetUrls(
    item: InventoryItemRecord | null | undefined
): ProfileDecorationAssetUrls {
    const assets = Array.isArray(item?.metadata?.assets)
        ? item.metadata.assets
        : [];
    const assetUrl = (type: string) =>
        normalizeText(assets.find((asset) => asset.type === type)?.url);

    return {
        animatedUrl: assetUrl('mainAnimation'),
        staticUrl: assetUrl('base')
    };
}
