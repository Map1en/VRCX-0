import { describe, expect, it } from 'vitest';

import {
    VRCX_OPEN_RELAY_ORIGIN,
    vrcxAvatarDeepLink,
    vrcxInstanceDeepLink,
    parseVrcxInstanceLink,
    vrcxWorldDeepLink
} from './vrcxDeepLinks';

const UUID = '12345678-1234-1234-1234-1234567890ab';

describe('vrcxDeepLinks', () => {
    it('round trips full instance identifiers and invitation tokens', () => {
        const input = {
            worldId: `wrld_${UUID}`,
            instanceId: `12345~private(usr_${UUID})~canRequestInvite~region(jp)~nonce(abc)`,
            shortName: 'token+with/symbols='
        };
        const link = vrcxInstanceDeepLink(input);
        expect(link).toContain(
            `${VRCX_OPEN_RELAY_ORIGIN}/instance/${input.worldId}?`
        );
        expect(parseVrcxInstanceLink(link)).toEqual(input);
        expect(
            vrcxInstanceDeepLink({ ...input, instanceId: '12345~region(us)' })
        ).not.toBe(link);
        expect(
            parseVrcxInstanceLink(
                vrcxInstanceDeepLink({ ...input, shortName: '' })
            )
        ).toEqual({ ...input, shortName: '' });
    });

    it('rejects ambiguous or malformed instance links', () => {
        const base = `${VRCX_OPEN_RELAY_ORIGIN}/instance/wrld_${UUID}`;
        for (const link of [
            base,
            `${base}?instanceId=`,
            `${base}?instanceId=123&instanceId=456`,
            `${base}?instanceId=123&shortName=a&shortName=b`,
            `${base}?instanceId=123%26shortName%3Devil`,
            `${base}?instanceId=123%0a`,
            `${base}?instanceId=123#fragment`,
            `${base}/extra?instanceId=123`,
            `${base.replace('open.vrcx-0.dev', 'open.vrcx-0.dev.evil')}?instanceId=123`
        ]) {
            expect(parseVrcxInstanceLink(link), link).toBeNull();
        }
        expect(
            vrcxInstanceDeepLink({
                worldId: 'wrld_invalid',
                instanceId: '123',
                shortName: ''
            })
        ).toBe('');
    });

    it('builds canonical world and avatar relay links', () => {
        expect(vrcxWorldDeepLink(`wrld_${UUID}`)).toBe(
            `${VRCX_OPEN_RELAY_ORIGIN}/world/wrld_${UUID}`
        );
        expect(vrcxAvatarDeepLink(`avtr_${UUID}`)).toBe(
            `${VRCX_OPEN_RELAY_ORIGIN}/avatar/avtr_${UUID}`
        );
    });

    it('normalizes surrounding whitespace and rejects invalid ids', () => {
        expect(vrcxWorldDeepLink(` wrld_${UUID} `)).toBe(
            `${VRCX_OPEN_RELAY_ORIGIN}/world/wrld_${UUID}`
        );
        expect(vrcxWorldDeepLink(`avtr_${UUID}`)).toBe('');
        expect(vrcxAvatarDeepLink('avtr_invalid')).toBe('');
    });
});
