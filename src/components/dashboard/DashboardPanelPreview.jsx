import { ArrowRightIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
    getDashboardPanelDefinition,
    resolveDashboardPanelConfig,
    resolveDashboardPanelKey
} from './dashboardRegistry.js';
import { DashboardEmbeddedPagePanel } from './DashboardEmbeddedPagePanel.jsx';
import { canEmbedDashboardPagePanel } from './dashboardPagePanelRegistry.jsx';
import { DashboardFeedWidget } from './widgets/DashboardFeedWidget.jsx';
import { DashboardGameLogWidget } from './widgets/DashboardGameLogWidget.jsx';
import { DashboardInstanceWidget } from './widgets/DashboardInstanceWidget.jsx';

import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { Button } from '@/ui/shadcn/button.jsx';

function PreviewMetric({ label, value }) {
    return (
        <div className="rounded-md border bg-muted/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-sm font-medium">{value}</div>
        </div>
    );
}

function DashboardWidgetPreview({ definition, config, configUpdater }) {
    if (definition.key === 'widget:instance') {
        return <DashboardInstanceWidget config={config} configUpdater={configUpdater} />;
    }

    if (definition.key === 'widget:game-log') {
        return <DashboardGameLogWidget config={config} configUpdater={configUpdater} />;
    }

    return <DashboardFeedWidget config={config} configUpdater={configUpdater} />;
}

function DashboardPagePreview({ definition }) {
    const navigate = useNavigate();
    const friendCount = useFriendRosterStore((state) => state.orderedFriendIds.length);
    const onlineCount = useFriendRosterStore((state) => state.onlineIds.length);
    const favoriteFriendCount = useFavoriteStore((state) => state.favoriteFriendIds.length);
    const favoriteWorldCount = useFavoriteStore((state) => state.favoriteWorldIds.length);
    const favoriteAvatarCount = useFavoriteStore((state) => state.favoriteAvatarIds.length);
    const notificationCount = useNotificationStore((state) => state.items.length);

    let metrics = [
        <PreviewMetric key="status" label="Status" value="Route available" />
    ];

    if (definition.key === 'friend-list') {
        metrics = [
            <PreviewMetric key="friends" label="Friends" value={friendCount} />,
            <PreviewMetric key="online" label="Online" value={onlineCount} />
        ];
    } else if (definition.key === 'favorite-friends') {
        metrics = [<PreviewMetric key="favorites" label="Favorites" value={favoriteFriendCount} />];
    } else if (definition.key === 'favorite-worlds') {
        metrics = [<PreviewMetric key="favorites" label="Favorites" value={favoriteWorldCount} />];
    } else if (definition.key === 'favorite-avatars') {
        metrics = [<PreviewMetric key="favorites" label="Favorites" value={favoriteAvatarCount} />];
    } else if (definition.key === 'notification') {
        metrics = [<PreviewMetric key="notifications" label="Notifications" value={notificationCount} />];
    }

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">{metrics}</div>
            <div className="mt-auto flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
                <span>{definition.path}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => navigate(definition.path)}>
                    Open
                    <ArrowRightIcon className="size-4" />
                </Button>
            </div>
        </div>
    );
}

export function DashboardPanelPreview({ panel, onPanelChange }) {
    const panelKey = resolveDashboardPanelKey(panel);
    const panelConfig = resolveDashboardPanelConfig(panel);
    const definition = getDashboardPanelDefinition(panelKey);
    const canEmbedPagePanel =
        definition?.category === 'page' && canEmbedDashboardPagePanel(panelKey);

    if (!panelKey) {
        return (
            <div className="relative flex h-full min-h-[180px] items-center justify-center overflow-hidden rounded-md border border-dashed bg-card text-sm text-muted-foreground">
                <div className="py-10 text-center">
                    Panel not configured.
                </div>
            </div>
        );
    }

    if (!definition) {
        return (
            <div className="relative flex h-full min-h-[180px] items-center justify-center overflow-hidden rounded-md border border-dashed bg-card text-sm text-muted-foreground">
                Unsupported panel: {panelKey}
            </div>
        );
    }

    if (canEmbedPagePanel) {
        return (
            <div className="dashboard-panel is-compact-table relative flex h-full min-h-[180px] overflow-hidden rounded-md border bg-card">
                <div className="h-full w-full overflow-y-auto">
                    <DashboardEmbeddedPagePanel panelKey={panelKey} />
                </div>
            </div>
        );
    }

    if (definition.category === 'widget') {
        return (
            <div className="dashboard-panel is-compact-table relative flex h-full min-h-[180px] overflow-hidden rounded-md border bg-card">
                <div className="h-full w-full overflow-y-auto">
                    <DashboardWidgetPreview
                        definition={definition}
                        config={panelConfig}
                        configUpdater={
                            onPanelChange
                                ? (nextConfig) => onPanelChange({ key: definition.key, config: nextConfig })
                                : null
                        }
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex h-full min-h-[180px] overflow-hidden rounded-md border bg-card p-3">
            <DashboardPagePreview definition={definition} />
        </div>
    );
}
