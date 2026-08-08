import { describe, expect, it } from 'vitest';

import { mergeManualModels } from './llmEndpointsStore';

describe('llmEndpointsStore helpers', () => {
    it('merges manual model input with detected models', () => {
        expect(
            mergeManualModels(['gpt-4o-mini', 'llama'], 'llama\nqwen, gemma ')
        ).toEqual(['gemma', 'gpt-4o-mini', 'llama', 'qwen']);
    });
});
