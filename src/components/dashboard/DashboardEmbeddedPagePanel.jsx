import { Suspense } from 'react';

import { Spinner } from '@/ui/shadcn/spinner';

import { getDashboardPagePanelComponent } from './dashboardPagePanelRegistry.jsx';
import { appI18n } from '@/services/i18nService.js';

function EmbeddedPageFallback() {
    return (
        <div className="text-muted-foreground flex min-h-[220px] flex-1 items-center justify-center gap-2 text-sm">
            <Spinner />
            {appI18n.t('view.dashboard.generated.loading_dashboard_panel')}
        </div>
    );
}

export function DashboardEmbeddedPagePanel({ panelKey }) {
    const PanelComponent = getDashboardPagePanelComponent(panelKey);

    if (!PanelComponent) {
        return null;
    }

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <Suspense fallback={<EmbeddedPageFallback />}>
                <PanelComponent dashboardEmbedded embedded />
            </Suspense>
        </div>
    );
}
