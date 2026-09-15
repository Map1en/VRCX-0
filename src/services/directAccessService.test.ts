import { beforeEach, describe, expect, it, vi } from 'vitest';

import { vrcxInstanceDeepLink } from '@/shared/constants/vrcxDeepLinks';
import { useLaunchStore } from '@/state/launchStore';

const mocks = vi.hoisted(() => ({
    getInstanceFromShortName: vi.fn(),
    openInstanceInGame: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstanceShortName: vi.fn()
    }
}));

vi.mock('@/repositories/vrchatSearchRepository', () => ({
    default: { getInstanceFromShortName: mocks.getInstanceFromShortName }
}));

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn(),
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('@/services/instanceActionService', () => ({
    openInstanceInGame: mocks.openInstanceInGame
}));

import {
    directAccessParse,
    tryOpenLaunchLocation
} from './directAccessService';

const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';
const AVATAR_ID = 'avtr_12345678-1234-1234-1234-1234567890ab';
const INSTANCE_ID = '12345~hidden(usr_owner)';
const LOCATION = `${WORLD_ID}:${INSTANCE_ID}`;

describe('directAccessService', () => {
    it('routes external instance shares through the same world and launch flow', async () => {
        useLaunchStore.getState().closeLaunchDialog();
        const input = vrcxInstanceDeepLink({
            worldId: WORLD_ID,
            instanceId: INSTANCE_ID,
            shortName: 'inviteToken'
        });
        await expect(directAccessParse(input, 'detect')).resolves.toBe(true);
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
        expect(useLaunchStore.getState().launchDialog.open).toBe(false);
        await expect(directAccessParse(input)).resolves.toBe(true);
        expect(mocks.openWorldDialog).toHaveBeenCalledWith({
            worldId: WORLD_ID,
            title: undefined
        });
        expect(useLaunchStore.getState().launchDialog).toMatchObject({
            open: true,
            tag: LOCATION,
            shortName: 'inviteToken'
        });
        expect(mocks.getInstanceFromShortName).not.toHaveBeenCalled();
        expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useLaunchStore.getState().closeLaunchDialog();
        mocks.getInstanceFromShortName.mockReset();
    });

    it('normalizes launch URLs before trying to open the instance', async () => {
        mocks.openInstanceInGame.mockResolvedValue(true);
        const launchUrl = `https://vrchat.com/home/launch?worldId=${WORLD_ID}&instanceId=${encodeURIComponent(INSTANCE_ID)}&shortName=freshTok`;

        await expect(
            tryOpenLaunchLocation(launchUrl, 'freshTok')
        ).resolves.toBe(true);

        expect(mocks.openInstanceInGame).toHaveBeenCalledWith(
            LOCATION,
            'freshTok'
        );
    });

    it.each([
        `vrchat://launch?id=${encodeURIComponent(LOCATION)}&shortName=freshTok`,
        `https://vrchat.com/home/launch?worldId=${WORLD_ID}&instanceId=${encodeURIComponent(INSTANCE_ID)}&shortName=freshTok`,
        `${LOCATION}&shortName=freshTok`
    ])(
        'opens world details before the instance dialog for %s',
        async (input) => {
            mocks.getInstanceFromShortName.mockRejectedValue(
                new Error('unavailable')
            );
            mocks.openWorldDialog.mockImplementationOnce(() => {
                expect(useLaunchStore.getState().launchDialog.open).toBe(false);
            });
            await expect(directAccessParse(input)).resolves.toBe(true);
            expect(mocks.openWorldDialog).toHaveBeenCalledWith({
                worldId: WORLD_ID,
                title: undefined
            });
            expect(useLaunchStore.getState().launchDialog).toMatchObject({
                open: true,
                tag: LOCATION,
                shortName: 'freshTok'
            });
            expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
            expect(mocks.getInstanceFromShortName).not.toHaveBeenCalled();
        }
    );

    it('resolves short links only after confirmation and preserves the token', async () => {
        mocks.getInstanceFromShortName.mockResolvedValue({
            json: {
                location: LOCATION,
                shortName: 'resolved',
                world: { name: 'World' }
            }
        });
        const input = 'https://vrch.at/AbCd1234';
        await expect(directAccessParse(input, 'detect')).resolves.toBe(true);
        expect(mocks.getInstanceFromShortName).not.toHaveBeenCalled();
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
        expect(useLaunchStore.getState().launchDialog.open).toBe(false);
        await expect(directAccessParse(input)).resolves.toBe(true);
        expect(mocks.getInstanceFromShortName).toHaveBeenCalledWith('AbCd1234');
        expect(useLaunchStore.getState().launchDialog).toMatchObject({
            open: true,
            tag: LOCATION,
            shortName: 'resolved'
        });
        expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
    });

    it.each([
        WORLD_ID,
        `https://vrchat.com/home/world/${WORLD_ID}`,
        `https://vrchat.com/home/launch?worldId=${WORLD_ID}&instanceId=`,
        `https://vrchat.com/home/launch?worldId=${WORLD_ID}&instanceId=%3Abad`,
        `vrchat://launch?id=${WORLD_ID}`,
        `${WORLD_ID}:`
    ])(
        'opens only world details when no valid instance is available: %s',
        async (input) => {
            await expect(directAccessParse(input)).resolves.toBe(true);
            expect(mocks.openWorldDialog).toHaveBeenCalledWith({
                worldId: WORLD_ID,
                title: undefined
            });
            expect(useLaunchStore.getState().launchDialog.open).toBe(false);
            expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
        }
    );

    it('propagates short-link lookup failure to the input UI without opening a world', async () => {
        mocks.getInstanceFromShortName.mockRejectedValue(
            new Error('lookup failed')
        );
        await expect(
            directAccessParse('https://vrch.at/AbCd1234')
        ).rejects.toThrow('lookup failed');
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
        expect(useLaunchStore.getState().launchDialog.open).toBe(false);
    });

    it.each([WORLD_ID, 'invalid-location'])(
        'falls back to a known world returned by short-link resolution: %s',
        async (location) => {
            mocks.getInstanceFromShortName.mockResolvedValue({
                json: { location, world: { id: WORLD_ID } }
            });
            await expect(
                directAccessParse('https://vrch.at/AbCd1234')
            ).resolves.toBe(true);
            expect(useLaunchStore.getState().launchDialog.open).toBe(false);
            expect(mocks.openWorldDialog).toHaveBeenCalled();
        }
    );

    it('rejects unusable short-link responses and malformed short links', async () => {
        mocks.getInstanceFromShortName.mockResolvedValue({ json: {} });
        await expect(
            directAccessParse('https://vrch.at/AbCd1234')
        ).resolves.toBe(false);
        await expect(
            directAccessParse('https://vrch.at/AbCd1234extra', 'detect')
        ).resolves.toBe(false);
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
    });

    it('detects complete instances without side effects', async () => {
        await expect(directAccessParse(LOCATION, 'detect')).resolves.toBe(true);
        await expect(
            directAccessParse(
                `vrchat://launch?id=${encodeURIComponent(LOCATION)}`,
                'detect'
            )
        ).resolves.toBe(true);
        expect(mocks.getInstanceFromShortName).not.toHaveBeenCalled();
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
        expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
        expect(useLaunchStore.getState().launchDialog.open).toBe(false);
    });
});

describe('directAccessParse detect mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('recognises links and prefixed ids without side effects', async () => {
        const cases = [
            `https://vrchat.com/home/world/${WORLD_ID}`,
            `https://open.vrcx-0.dev/world/${WORLD_ID}`,
            `https://open.vrcx-0.dev/avatar/${AVATAR_ID}`,
            `https://vrchat.com/home/launch?worldId=${WORLD_ID}`,
            `https://vrchat.com/home/launch?worldId=${WORLD_ID}&instanceId=x`,
            'https://vrchat.com/home/user/usr_id',
            'https://vrchat.com/home/avatar/avtr_id',
            'https://vrchat.com/home/group/grp_id',
            'https://vrch.at/abcd1234',
            'https://vrc.group/vrcx.1234',
            `vrchat://launch?id=${encodeURIComponent(LOCATION)}`,
            WORLD_ID,
            'usr_12345678-1234-1234-1234-1234567890ab',
            'avtr_12345678-1234-1234-1234-1234567890ab',
            'grp_12345678-1234-1234-1234-1234567890ab',
            'vrcx.1234'
        ];

        for (const value of cases) {
            await expect(directAccessParse(value, 'detect')).resolves.toBe(
                true
            );
        }

        expect(mocks.openInstanceInGame).not.toHaveBeenCalled();
        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
    });

    it('rejects bare tokens that collide with name searches', async () => {
        await expect(directAccessParse('Kagamine', 'detect')).resolves.toBe(
            false
        );
        await expect(directAccessParse('abcd1234', 'detect')).resolves.toBe(
            false
        );
        await expect(directAccessParse('MapleNagis', 'detect')).resolves.toBe(
            false
        );
    });

    it('rejects plain queries and malformed links', async () => {
        for (const value of [
            '',
            '   ',
            'hello world',
            'https://vrchat.com/home',
            'https://open.vrcx-0.dev/world/wrld_invalid',
            `http://open.vrcx-0.dev/world/${WORLD_ID}`,
            `https://open.vrcx-0.dev.example.com/world/${WORLD_ID}`,
            `https://open.vrcx-0.dev//world/${WORLD_ID}`,
            `https://open.vrcx-0.dev/world/${WORLD_ID}/extra`,
            `Open world: https://open.vrcx-0.dev/world/${WORLD_ID}`,
            `https://open.vrcx-0.dev/avatar/${WORLD_ID}`,
            'https://example.com/x'
        ]) {
            await expect(directAccessParse(value, 'detect')).resolves.toBe(
                false
            );
        }
    });

    it('opens VRCX-0 share links in their matching dialogs', async () => {
        const dialogService = await import('@/services/dialogService');

        await expect(
            directAccessParse(`https://open.vrcx-0.dev/world/${WORLD_ID}`)
        ).resolves.toBe(true);
        await expect(
            directAccessParse(`https://open.vrcx-0.dev/avatar/${AVATAR_ID}`)
        ).resolves.toBe(true);

        expect(mocks.openWorldDialog).toHaveBeenCalledWith({
            worldId: WORLD_ID
        });
        expect(dialogService.openAvatarDialog).toHaveBeenCalledWith({
            avatarId: AVATAR_ID
        });
    });

    it('keeps mixed case payloads intact', async () => {
        await expect(
            directAccessParse('https://vrc.group/VRCX.1234', 'detect')
        ).resolves.toBe(true);
        await expect(directAccessParse('VRCX.1234', 'detect')).resolves.toBe(
            true
        );
    });
});
