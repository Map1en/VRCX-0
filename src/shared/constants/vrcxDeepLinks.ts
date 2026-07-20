import { isAvatarId, isWorldId } from './vrchatIds';

export const VRCX_DEEP_LINK_SCHEME = 'vrcx-0';

function entityDeepLink(entity: 'avatar' | 'world', entityId: string): string {
    const url = new URL(`${VRCX_DEEP_LINK_SCHEME}://${entity}/open`);
    url.searchParams.set('id', entityId.trim());
    return url.toString();
}

export function vrcxWorldDeepLink(worldId: unknown): string {
    return isWorldId(worldId) ? entityDeepLink('world', String(worldId)) : '';
}

export function vrcxAvatarDeepLink(avatarId: unknown): string {
    return isAvatarId(avatarId)
        ? entityDeepLink('avatar', String(avatarId))
        : '';
}
