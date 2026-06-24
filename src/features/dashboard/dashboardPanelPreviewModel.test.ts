import { describe, expect, it, vi } from 'vitest';

import { createDashboardPanelPreviewProps } from './dashboardPanelPreviewModel';

const pageMetrics = {
    friendCount: 10,
    onlineCount: 4,
    favoriteFriendCount: 3,
    favoriteWorldCount: 2,
    favoriteAvatarCount: 1,
    notificationCount: 5
};

describe('dashboardPanelPreviewModel', () => {
    it('resolves raw widget panels into fixed preview props', () => {
        const onPanelChange = vi.fn();
        const props = createDashboardPanelPreviewProps({
            panel: {
                key: 'widget:feed',
                config: {
                    showType: true
                }
            },
            pageMetrics,
            onPanelChange
        });

        expect(Object.keys(props).sort()).toEqual([
            'config',
            'definition',
            'onConfigChange',
            'pageMetrics',
            'panelKey'
        ]);
        expect(props.panelKey).toBe('widget:feed');
        expect(props.definition?.key).toBe('widget:feed');
        expect(props.config).toEqual({ showType: true });

        props.onConfigChange?.({ filters: ['GPS'] });

        expect(onPanelChange).toHaveBeenCalledWith({
            key: 'widget:feed',
            config: { filters: ['GPS'] }
        });
    });

    it('keeps unsupported panel keys explicit for preview rendering', () => {
        const props = createDashboardPanelPreviewProps({
            panel: 'legacy-panel',
            pageMetrics
        });

        expect(props.panelKey).toBe('legacy-panel');
        expect(props.definition).toBeNull();
        expect(props.config).toEqual({});
        expect(props.onConfigChange).toBeUndefined();
    });
});
