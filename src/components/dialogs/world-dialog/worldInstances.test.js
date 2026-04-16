import { describe, expect, it } from 'vitest';

import {
    buildCreatedInstanceDetails,
    buildLegacyCreatedInstance,
    normalizeEntityId,
    parseRoleIds,
    resolveInstanceLocation
} from './worldInstances.js';

describe('worldInstances', () => {
    it('normalizes form ids, role ids, and returned instance locations', () => {
        expect(normalizeEntityId('  wrld_123  ')).toBe('wrld_123');
        expect(normalizeEntityId(null)).toBe('');
        expect(parseRoleIds('grol_a, grol_b,, ')).toEqual(['grol_a', 'grol_b']);
        expect(
            resolveInstanceLocation('wrld_base', {
                location: ' wrld_direct:1 '
            })
        ).toBe('wrld_direct:1');
        expect(
            resolveInstanceLocation('wrld_base', { id: 'wrld_from_id:2' })
        ).toBe('wrld_from_id:2');
        expect(
            resolveInstanceLocation('wrld_base', { instanceId: '3~region(eu)' })
        ).toBe('wrld_base:3~region(eu)');
        expect(resolveInstanceLocation('', {})).toBe('');
    });

    it('builds legacy created instance details from sanitized form input', () => {
        const created = buildLegacyCreatedInstance({
            worldId: 'wrld_test',
            currentUserId: 'usr_self',
            legacySeed: '00042',
            form: {
                legacyUserId: '',
                instanceName: 'Room #42!',
                accessType: 'friends',
                region: 'Japan',
                strict: true
            }
        });

        expect(created).toMatchObject({
            location: 'wrld_test:Room42~friends(usr_self)~region(jp)~strict',
            shortName: '',
            secureOrShortName: '',
            accessType: 'friends',
            ownerId: 'usr_self'
        });
        expect(created.url).toContain('worldId=wrld_test');
        expect(created.url).toContain('Room42~friends');
    });

    it('builds created instance details with instance metadata before fallback metadata', () => {
        const created = buildCreatedInstanceDetails(
            'wrld_test:123~private(usr_owner)~region(eu)',
            {
                shortName: 'short123',
                secureName: 'secure123',
                accessType: 'friends',
                owner: { id: 'usr_nested_owner' }
            },
            {
                accessType: 'invite',
                ownerId: 'usr_fallback'
            }
        );

        expect(created).toMatchObject({
            location: 'wrld_test:123~private(usr_owner)~region(eu)',
            shortName: 'short123',
            secureOrShortName: 'short123',
            accessType: 'friends',
            ownerId: 'usr_nested_owner'
        });
        expect(created.url).toContain('shortName=short123');
    });
    it('uses fallback metadata before parsed location metadata when instance fields are absent', () => {
        expect(
            buildCreatedInstanceDetails(
                'wrld_test:126~private(usr_owner)~region(us)',
                {}
            )
        ).toMatchObject({
            accessType: 'invite',
            ownerId: 'usr_owner'
        });

        expect(
            buildCreatedInstanceDetails(
                'wrld_test:127~private(usr_owner)~region(us)',
                {},
                {
                    accessType: 'public',
                    ownerId: 'usr_fallback'
                }
            )
        ).toMatchObject({
            accessType: 'public',
            ownerId: 'usr_fallback'
        });
    });
});
