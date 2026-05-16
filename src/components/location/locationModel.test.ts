// @ts-nocheck
import { describe, expect, it } from 'vitest';

import {
    buildInstanceActionTarget,
    normalizeLocationObject,
    resolveLocationTarget
} from './locationModel.js';

describe('locationModel', () => {
    it('uses the traveling destination as the display target', () => {
        expect(
            resolveLocationTarget('traveling', 'wrld_test:12345~region(jp)')
        ).toBe('wrld_test:12345~region(jp)');
    });

    it('normalizes object-shaped instance locations', () => {
        const location = normalizeLocationObject({
            worldId: 'wrld_test',
            instanceId: '12345',
            regionName: 'eu',
            secureName: 'token'
        });

        expect(location.tag).toBe('wrld_test:12345');
        expect(location.worldId).toBe('wrld_test');
        expect(location.instanceId).toBe('12345');
        expect(location.region).toBe('eu');
        expect(location.launchToken).toBe('token');
        expect(location.isRealInstance).toBe(true);
    });

    it('builds one action target for launch, invite, and refresh', () => {
        const target = buildInstanceActionTarget({
            target: {
                location: 'wrld_test:12345~hidden(usr_owner)',
                shortName: 'abc12345',
                worldName: 'Test World'
            }
        });

        expect(target.launchLocation).toBe('wrld_test:12345~hidden(usr_owner)');
        expect(target.inviteLocation).toBe('wrld_test:12345~hidden(usr_owner)');
        expect(target.instanceLocation).toBe(
            'wrld_test:12345~hidden(usr_owner)'
        );
        expect(target.isRealLaunchLocation).toBe(true);
        expect(target.isRealInviteLocation).toBe(true);
        expect(target.isRealInstanceLocation).toBe(true);
        expect(target.shortName).toBe('abc12345');
        expect(target.worldName).toBe('Test World');
    });
});
