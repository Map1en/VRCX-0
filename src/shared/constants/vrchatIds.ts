export const VRCHAT_ID_PREFIX = Object.freeze({
    user: 'usr_',
    world: 'wrld_',
    avatar: 'avtr_',
    group: 'grp_',
    file: 'file_',
    instance: 'inst_'
});

const VRCHAT_UUID_PATTERN =
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const USER_ID_RE = vrchatIdRegExp(VRCHAT_ID_PREFIX.user);
const WORLD_ID_RE = vrchatIdRegExp(VRCHAT_ID_PREFIX.world);
const AVATAR_ID_RE = vrchatIdRegExp(VRCHAT_ID_PREFIX.avatar);
const GROUP_ID_RE = vrchatIdRegExp(VRCHAT_ID_PREFIX.group);

function vrchatIdRegExp(prefixPattern: string): RegExp {
    return new RegExp(`^${prefixPattern}${VRCHAT_UUID_PATTERN}$`, 'i');
}

function normalizedId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function hasVrchatIdPrefix(value: unknown, prefix: string): boolean {
    return normalizedId(value).startsWith(prefix);
}

export function hasUserIdPrefix(value: unknown): boolean {
    return hasVrchatIdPrefix(value, VRCHAT_ID_PREFIX.user);
}

export function hasWorldIdPrefix(value: unknown): boolean {
    return hasVrchatIdPrefix(value, VRCHAT_ID_PREFIX.world);
}

export function hasAvatarIdPrefix(value: unknown): boolean {
    return hasVrchatIdPrefix(value, VRCHAT_ID_PREFIX.avatar);
}

export function hasGroupIdPrefix(value: unknown): boolean {
    return hasVrchatIdPrefix(value, VRCHAT_ID_PREFIX.group);
}

export function isUserId(value: unknown): boolean {
    return USER_ID_RE.test(normalizedId(value));
}

export function isWorldId(value: unknown): boolean {
    return WORLD_ID_RE.test(normalizedId(value));
}

export function isAvatarId(value: unknown): boolean {
    return AVATAR_ID_RE.test(normalizedId(value));
}

export function isGroupId(value: unknown): boolean {
    return GROUP_ID_RE.test(normalizedId(value));
}
