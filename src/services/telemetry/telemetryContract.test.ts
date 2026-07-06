import { describe, expect, it } from 'vitest';

import {
    TELEMETRY_ROUTE_KEYS,
    TELEMETRY_VIEW_MODE_DIMENSIONS
} from './telemetryContract';

describe('telemetry contract', () => {
    it('contains the current route keys without the retired instance chart route', () => {
        expect(TELEMETRY_ROUTE_KEYS).toContain('instance_history');
        expect(TELEMETRY_ROUTE_KEYS).toContain('charts_mutual');
        expect(TELEMETRY_ROUTE_KEYS).not.toContain('charts_instance');
    });

    it('keeps frontend-owned view mode dimensions in the shared contract', () => {
        expect(TELEMETRY_VIEW_MODE_DIMENSIONS).toMatchObject({
            gameLogViewMode: ['sessions', 'table'],
            feedTimeDisplayMode: ['relative', 'exact']
        });
    });
});
