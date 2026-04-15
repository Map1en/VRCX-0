import { describe, expect, it } from 'vitest';

import {
    displayLocation,
    parseLocation,
    resolveRegion,
    translateAccessType
} from './locationParser.js';

describe('locationParser', () => {
    it('normalizes sentinel locations', () => {
        expect(parseLocation('offline:offline')).toMatchObject({
            isOffline: true,
            isPrivate: false,
            isTraveling: false,
            worldId: ''
        });
        expect(parseLocation('private')).toMatchObject({
            isPrivate: true,
            worldId: ''
        });
        expect(parseLocation('traveling:traveling')).toMatchObject({
            isTraveling: true,
            worldId: ''
        });
    });

    it('parses invite-plus instance tags', () => {
        const parsed = parseLocation('wrld_123:12345~private(usr_abc)~canRequestInvite~region(eu)');

        expect(parsed).toMatchObject({
            isRealInstance: true,
            worldId: 'wrld_123',
            instanceId: '12345~private(usr_abc)~canRequestInvite~region(eu)',
            instanceName: '12345',
            accessType: 'invite+',
            accessTypeName: 'invite+',
            userId: 'usr_abc',
            privateId: 'usr_abc',
            canRequestInvite: true,
            region: 'eu'
        });
    });

    it('parses group instance tags with group access metadata', () => {
        const parsed = parseLocation('wrld_123:group1~group(grp_abc)~groupAccessType(plus)~ageGate~region(jp)');

        expect(parsed).toMatchObject({
            worldId: 'wrld_123',
            instanceName: 'group1',
            accessType: 'group',
            accessTypeName: 'groupPlus',
            groupId: 'grp_abc',
            groupAccessType: 'plus',
            ageGate: true,
            region: 'jp'
        });
    });

    it('keeps short name query data outside the instance id', () => {
        const parsed = parseLocation('wrld_123:instance1~region(us)&shortName=abc123');

        expect(parsed.instanceId).toBe('instance1~region(us)');
        expect(parsed.shortName).toBe('abc123');
        expect(parsed.region).toBe('us');
    });

    it('resolves default regions for real instances only', () => {
        expect(resolveRegion(parseLocation('wrld_123:instance1'))).toBe('us');
        expect(resolveRegion(parseLocation('wrld_123:instance1~region(jp)'))).toBe('jp');
        expect(resolveRegion(parseLocation('wrld_123'))).toBe('');
        expect(resolveRegion(parseLocation('private'))).toBe('');
    });

    it('formats display text without async world lookups', () => {
        expect(displayLocation('offline', 'World')).toBe('Offline');
        expect(displayLocation('private', 'World')).toBe('Private');
        expect(displayLocation('traveling', 'World')).toBe('Traveling');
        expect(displayLocation('wrld_123:instance1~friends(usr_abc)', 'World')).toBe('World friends');
        expect(displayLocation('wrld_123:instance1~group(grp_abc)', 'World', 'Group Name')).toBe('World group(Group Name)');
    });

    it('translates group access labels with the group prefix', () => {
        const t = (key) => `t:${key}`;
        const keyMap = {
            group: 'access.group',
            groupPlus: 'access.group_plus',
            public: 'access.public'
        };

        expect(translateAccessType('groupPlus', t, keyMap)).toBe('t:access.group t:access.group_plus');
        expect(translateAccessType('public', t, keyMap)).toBe('t:access.public');
        expect(translateAccessType('invite+', t, keyMap)).toBe('invite+');
    });
});
