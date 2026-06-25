import { getTagColor } from '@/shared/constants/tags';
import { getPlatformInfo } from '@/shared/utils/avatarPlatform';

export function getMyAvatarPlatformInfo(avatar: any) {
    return getPlatformInfo(avatar?.unityPackages);
}

export function resolveMyAvatarPerformanceLabel(value: any) {
    if (!value) {
        return '-';
    }

    return value;
}

export function resolveMyAvatarActionDisabled(avatar: any, isUpdating: any) {
    return isUpdating || !avatar?.id;
}

export const MY_AVATAR_TAG_BADGE_CLASS_NAME =
    'rounded-sm px-1 py-0 text-xs leading-tight';

export function resolveMyAvatarTagBadgeStyle(entry: any) {
    const color = entry?.color
        ? {
              bg: entry.color,
              text:
                  typeof entry.color === 'string'
                      ? entry.color.replace(/\/ [\d.]+\)$/, ')')
                      : entry.color
          }
        : getTagColor(entry?.tag || '');
    return {
        backgroundColor: color.bg,
        color: color.text
    };
}
