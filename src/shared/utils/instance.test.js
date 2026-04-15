import { describe, expect, it } from 'vitest';

import { buildLegacyInstanceTag, getLaunchURL, isRealInstance } from './instance.js';
import { parseLocation } from './locationParser.js';

describe('instance utils', () => {
    it('filters sentinel and local locations from real instance logic', () => {
        expect(isRealInstance('wrld_123:12345')).toBe(true);
        expect(isRealInstance('private')).toBe(false);
        expect(isRealInstance('offline:offline')).toBe(false);
        expect(isRealInstance('traveling')).toBe(false);
        expect(isRealInstance('local:testing')).toBe(false);
    });

    it('builds legacy invite-plus tags that parse back to the same access semantics', () => {
        const tag = buildLegacyInstanceTag({
            instanceName: '12345',
            userId: 'usr_owner',
            accessType: 'invite+',
            region: 'Europe'
        });
        const parsed = parseLocation(`wrld_123:${tag}`);

        expect(tag).toBe('12345~private(usr_owner)~canRequestInvite~region(eu)');
        expect(parsed).toMatchObject({
            worldId: 'wrld_123',
            instanceName: '12345',
            accessType: 'invite+',
            userId: 'usr_owner',
            region: 'eu'
        });
    });

    it('builds group tags with age gate metadata and ignores strict outside invite or friends instances', () => {
        const tag = buildLegacyInstanceTag({
            instanceName: 'group-room',
            accessType: 'group',
            groupId: 'grp_123',
            groupAccessType: 'plus',
            region: 'Japan',
            ageGate: true,
            strict: true
        });
        const parsed = parseLocation(`wrld_123:${tag}`);

        expect(tag).toBe('group-room~group(grp_123)~groupAccessType(plus)~ageGate~region(jp)');
        expect(parsed).toMatchObject({
            accessType: 'group',
            accessTypeName: 'groupPlus',
            groupId: 'grp_123',
            groupAccessType: 'plus',
            ageGate: true,
            strict: false
        });
    });

    it('builds launch URLs with encoded world, instance, and short name values', () => {
        expect(getLaunchURL({
            worldId: 'wrld_123',
            instanceId: '12345~friends(usr_owner)',
            shortName: 'abc 123'
        })).toBe('https://vrchat.com/home/launch?worldId=wrld_123&instanceId=12345~friends(usr_owner)&shortName=abc%20123');

        expect(getLaunchURL({ worldId: 'wrld_123' })).toBe('https://vrchat.com/home/launch?worldId=wrld_123');
    });
});
