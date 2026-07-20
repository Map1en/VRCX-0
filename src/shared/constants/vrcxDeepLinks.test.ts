import { describe, expect, it } from 'vitest';

import {
    VRCX_DEEP_LINK_SCHEME,
    vrcxAvatarDeepLink,
    vrcxWorldDeepLink
} from './vrcxDeepLinks';

const UUID = '12345678-1234-1234-1234-1234567890ab';

describe('vrcxDeepLinks', () => {
    it('builds canonical world and avatar detail links', () => {
        expect(vrcxWorldDeepLink(`wrld_${UUID}`)).toBe(
            `${VRCX_DEEP_LINK_SCHEME}://world/open?id=wrld_${UUID}`
        );
        expect(vrcxAvatarDeepLink(`avtr_${UUID}`)).toBe(
            `${VRCX_DEEP_LINK_SCHEME}://avatar/open?id=avtr_${UUID}`
        );
    });

    it('normalizes surrounding whitespace and rejects invalid ids', () => {
        expect(vrcxWorldDeepLink(` wrld_${UUID} `)).toBe(
            `${VRCX_DEEP_LINK_SCHEME}://world/open?id=wrld_${UUID}`
        );
        expect(vrcxWorldDeepLink(`avtr_${UUID}`)).toBe('');
        expect(vrcxAvatarDeepLink('avtr_invalid')).toBe('');
    });
});
