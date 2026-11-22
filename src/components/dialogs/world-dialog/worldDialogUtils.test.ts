import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';

import { visibleWorldTags } from './worldDialogUtils';

const t = ((key: string) => key) as unknown as TFunction;

function world(fields: Partial<WorldProfileRecord>) {
    return { id: 'wrld_a', ...fields } as WorldProfileRecord;
}

describe('visibleWorldTags', () => {
    it('keeps debug and package flags out of player-facing restrictions', () => {
        const tags = visibleWorldTags(
            world({
                tags: ['feature_emoji_disabled', 'debug_allowed'],
                unityPackageUrl: 'https://example.test/package'
            }),
            t
        );

        expect(tags.restrictions.map((tag) => tag.key)).toEqual([
            'feature_emoji_disabled'
        ]);
        expect(tags.attributes.map((tag) => tag.key)).toEqual([
            'debug_allowed',
            'future_proofing'
        ]);
    });
});
