import { describe, expect, it } from 'vitest';

import {
    TELEMETRY_CONFIG_FIELDS,
    TELEMETRY_ROUTE_KEYS,
    TELEMETRY_VIEW_MODE_DIMENSIONS
} from './telemetryContract';

describe('telemetry contract', () => {
    it('contains the current route keys without the retired instance chart route', () => {
        expect(TELEMETRY_ROUTE_KEYS).toContain('instance_history');
        expect(TELEMETRY_ROUTE_KEYS).toContain('charts_mutual');
        expect(TELEMETRY_ROUTE_KEYS).not.toContain('charts_instance');
    });

    it('keeps view mode dimensions and config fields in the shared contract', () => {
        expect(TELEMETRY_VIEW_MODE_DIMENSIONS).toMatchObject({
            gameLogViewMode: ['sessions', 'table'],
            feedTimeDisplayMode: ['relative', 'exact']
        });
        expect(TELEMETRY_CONFIG_FIELDS).toMatchObject({
            booleanFields: expect.arrayContaining([
                'backgroundModeEnabled',
                'mcpServerEnabled',
                'webhookEnabled'
            ]),
            optionalBooleanFields: ['mcpServerEnabled', 'webhookEnabled'],
            enumFields: expect.arrayContaining([
                'autoAcceptInviteRequests',
                'avatarAutoCleanup',
                'themeMode'
            ])
        });
    });
});
