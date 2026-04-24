import { Suspense } from 'react';

import { useTranslation } from 'react-i18next';

import { Spinner } from '@/ui/shadcn/spinner';
import { getDashboardPagePanelComponent } from './dashboardPagePanelRegistry.jsx';

function EmbeddedPageFallback() {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground flex min-h-[220px] flex-1 items-center justify-center gap-2 text-sm">
            <Spinner />
            {t('view.dashboard.generated.loading_dashboard_panel')}
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
