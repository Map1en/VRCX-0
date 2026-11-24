import { describe, expect, it } from 'vitest';

import { mergeModels } from './llmEndpointsStore';

describe('llmEndpointsStore helpers', () => {
    it('merges model lists into a sorted unique set', () => {
        expect(
            mergeModels(['gpt-4o-mini', 'llama'], ['llama', 'qwen', ' gemma '])
        ).toEqual(['gemma', 'gpt-4o-mini', 'llama', 'qwen']);
    });

    it('drops blank entries', () => {
        expect(mergeModels(['', '  '], ['gpt-4o-mini'])).toEqual([
            'gpt-4o-mini'
        ]);
    });
});
