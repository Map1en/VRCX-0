import { describe, expect, it } from 'vitest';

import { ActivityType, StatusDisplayType } from '../constants/discord.js';
import {
    getPlatformLabel,
    getRpcWorldConfig,
    getStatusInfo,
    isPopcornPalaceWorld
} from './discordPresence.js';

const t = (key) => ({
    'view.settings.discord_presence.rpc.desktop': 'Desktop',
    'view.settings.discord_presence.rpc.vr': 'VR',
    'dialog.user.status.active': 'Active',
    'dialog.user.status.join_me': 'Join Me',
    'dialog.user.status.ask_me': 'Ask Me',
    'dialog.user.status.busy': 'Busy',
    'dialog.user.status.offline': 'Offline'
}[key] ?? key);

describe('discordPresence utilities', () => {
    it('derives platform labels from game state before profile platform', () => {
        expect(getPlatformLabel('standalonewindows', false, false, t)).toBe(' (PC)');
        expect(getPlatformLabel('android', false, false, t)).toBe(' (Android)');
        expect(getPlatformLabel('web', false, false, t)).toBe('');
        expect(getPlatformLabel('standalonewindows', true, true, t)).toBe(' (Desktop)');
        expect(getPlatformLabel('android', true, false, t)).toBe(' (VR)');
    });

    it('keeps private locations hidden for ask-me when invite hiding is enabled', () => {
        expect(getStatusInfo('active', true, t)).toEqual({
            statusName: 'Active',
            statusImage: 'active',
            hidePrivate: false
        });
        expect(getStatusInfo('ask me', false, t)).toMatchObject({
            statusName: 'Ask Me',
            hidePrivate: false
        });
        expect(getStatusInfo('ask me', true, t)).toMatchObject({
            statusName: 'Ask Me',
            hidePrivate: true
        });
        expect(getStatusInfo('busy', false, t)).toMatchObject({
            statusName: 'Busy',
            hidePrivate: true
        });
        expect(getStatusInfo('offline', false, t)).toMatchObject({
            statusName: 'Offline',
            statusImage: 'offline',
            hidePrivate: true
        });
    });

    it('returns copy-on-read RPC world config objects', () => {
        const worldId = 'wrld_266523e8-9161-40da-acd0-6bd82e075833';
        const config = getRpcWorldConfig(worldId);

        expect(config).toMatchObject({
            activityType: ActivityType.Watching,
            statusDisplayType: StatusDisplayType.Details,
            appId: '1095440531821170820',
            bigIcon: 'popcorn_palace'
        });
        expect(isPopcornPalaceWorld(worldId)).toBe(true);

        config.bigIcon = 'mutated';

        expect(getRpcWorldConfig(worldId).bigIcon).toBe('popcorn_palace');
        expect(getRpcWorldConfig('wrld_unknown')).toBeNull();
        expect(isPopcornPalaceWorld('wrld_unknown')).toBe(false);
    });
});
