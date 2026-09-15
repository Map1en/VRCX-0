import { isAvatarId, isWorldId } from './vrchatIds';

export const VRCX_OPEN_RELAY_ORIGIN = 'https://open.vrcx-0.dev';

export interface VrcxInstanceLink {
    worldId: string;
    instanceId: string;
    shortName: string;
}

export function isVrcxInstanceLink(input: VrcxInstanceLink): boolean {
    return (
        isWorldId(input.worldId) &&
        input.worldId === input.worldId.trim() &&
        Boolean(input.instanceId) &&
        !/[\s:/?#&]/.test(input.instanceId) &&
        !/\s/.test(input.shortName) &&
        !Array.from(input.instanceId + input.shortName).some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || (code >= 127 && code <= 159);
        })
    );
}

export function vrcxInstanceDeepLink(input: VrcxInstanceLink): string {
    if (!isVrcxInstanceLink(input)) {
        return '';
    }
    const params = new URLSearchParams({ instanceId: input.instanceId });
    if (input.shortName) {
        params.set('shortName', input.shortName);
    }
    return `${VRCX_OPEN_RELAY_ORIGIN}/instance/${input.worldId}?${params}`;
}

export function parseVrcxInstanceLink(input: string): VrcxInstanceLink | null {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return null;
    }
    if (
        url.origin !== VRCX_OPEN_RELAY_ORIGIN ||
        url.hash ||
        url.username ||
        url.password
    ) {
        return null;
    }
    const parts = url.pathname.split('/');
    if (parts.length !== 3 || parts[1] !== 'instance') {
        return null;
    }
    if (
        url.searchParams.getAll('instanceId').length !== 1 ||
        url.searchParams.getAll('shortName').length > 1
    ) {
        return null;
    }
    const link = {
        worldId: parts[2],
        instanceId: url.searchParams.get('instanceId') || '',
        shortName: url.searchParams.get('shortName') || ''
    };
    return isVrcxInstanceLink(link) ? link : null;
}

function entityRelayLink(entity: 'avatar' | 'world', entityId: string): string {
    return `${VRCX_OPEN_RELAY_ORIGIN}/${entity}/${entityId.trim()}`;
}

export function vrcxWorldDeepLink(worldId: string): string {
    return isWorldId(worldId) ? entityRelayLink('world', worldId) : '';
}

export function vrcxAvatarDeepLink(avatarId: string): string {
    return isAvatarId(avatarId) ? entityRelayLink('avatar', avatarId) : '';
}
