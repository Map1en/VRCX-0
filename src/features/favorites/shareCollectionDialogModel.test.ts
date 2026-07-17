import { describe, expect, it } from 'vitest';

import {
    buildShareCollectionWorldIds,
    SHARE_COLLECTION_CLIENT_WORLD_CAP
} from './shareCollectionDialogModel';

describe('buildShareCollectionWorldIds', () => {
    it('keeps canonical ids in order, reports invalid items, deduplicates, and caps the upload list', () => {
        const ids = Array.from(
            { length: SHARE_COLLECTION_CLIENT_WORLD_CAP + 2 },
            (_, index) =>
                `wrld_${index.toString(16).padStart(8, '0')}-1111-1111-1111-111111111111`
        );

        const result = buildShareCollectionWorldIds([
            { id: ids[1], title: 'Second' },
            { id: '   ', title: 'Missing ID' },
            { id: 'legacy-world-id', title: 'Legacy ID' },
            { id: ids[0], title: 'First' },
            { id: ids[1], title: 'Second duplicate' },
            ...ids.slice(2).map((id) => ({ id }))
        ]);

        expect(result.worldIds).toHaveLength(SHARE_COLLECTION_CLIENT_WORLD_CAP);
        expect(result.totalWorldIds).toBe(
            SHARE_COLLECTION_CLIENT_WORLD_CAP + 2
        );
        expect(result.truncated).toBe(true);
        expect(result.skippedWorlds).toEqual([
            { worldId: '', name: 'Missing ID' },
            { worldId: 'legacy-world-id', name: 'Legacy ID' }
        ]);
        expect(result.worldIds[0]).toBe(ids[1]);
        expect(result.worldIds[1]).toBe(ids[0]);
        expect(result.worldIds.at(-1)).toBe(
            ids[SHARE_COLLECTION_CLIENT_WORLD_CAP - 1]
        );
    });
});
