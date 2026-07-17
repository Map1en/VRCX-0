import { describe, expect, it } from 'vitest';

import { rowImage } from './userDialogEntityImages';

describe('userDialogEntityImages', () => {
    it('falls back past an empty thumbnail URL', () => {
        expect(
            rowImage(
                {
                    thumbnailImageUrl: '',
                    imageUrl: 'https://example.com/world.png'
                },
                'world'
            )
        ).toBe('https://example.com/world.png');
    });
});
