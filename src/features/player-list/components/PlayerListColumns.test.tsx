// @ts-nocheck
import { describe, expect, it } from 'vitest';

import { languageTooltipLabel } from './PlayerListColumns';

describe('PlayerListColumns', () => {
    it('uses the original language text in the tooltip while the badge keeps the code', () => {
        expect(
            languageTooltipLabel(
                {
                    key: 'jpn',
                    value: 'Japanese'
                },
                'JPN'
            )
        ).toBe('Japanese');
    });

    it('falls back to the compact code when no original language text exists', () => {
        expect(languageTooltipLabel({ key: 'jpn' }, 'JPN')).toBe('JPN');
    });
});
