import { describe, expect, it } from 'vitest';

import type { LlmEndpointDto } from '@/platform/tauri/bindings';

import {
    fallbackEndpointIdAfterDelete,
    mergeManualModels
} from './llmEndpointsStore';

function endpoint(id: string): LlmEndpointDto {
    return {
        id,
        name: id,
        baseUrl: 'https://example.com/v1',
        hasKey: false,
        models: [],
        lastDetectedAt: null
    };
}

describe('llmEndpointsStore helpers', () => {
    it('merges manual model input with detected models', () => {
        expect(
            mergeManualModels(['gpt-4o-mini', 'llama'], 'llama\nqwen, gemma ')
        ).toEqual(['gemma', 'gpt-4o-mini', 'llama', 'qwen']);
    });

    it('falls back when deleting the selected endpoint', () => {
        expect(
            fallbackEndpointIdAfterDelete(
                [endpoint('ep_1'), endpoint('ep_2')],
                'ep_1',
                'ep_1'
            )
        ).toBe('ep_2');
        expect(
            fallbackEndpointIdAfterDelete([endpoint('ep_1')], 'ep_1', 'ep_1')
        ).toBeNull();
        expect(
            fallbackEndpointIdAfterDelete(
                [endpoint('ep_1'), endpoint('ep_2')],
                'ep_1',
                'ep_2'
            )
        ).toBe('ep_2');
    });
});
