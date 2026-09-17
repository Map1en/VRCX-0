import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Spinner } from '@/ui/shadcn/spinner';

import { getDashboardPagePanelComponent } from '../dashboardPagePanelRegistry';

function EmbeddedPageFallback() {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground flex min-h-[220px] flex-1 items-center justify-center gap-2 text-sm">
            <Spinner />
            {t('view.dashboard.loading.loading_dashboard_panel')}
        </div>
    );
}

export function DashboardEmbeddedPagePanel({ panelKey }: { panelKey: string }) {
    const PanelComponent = getDashboardPagePanelComponent(panelKey);

    if (!PanelComponent) {
        return null;
    }

    return (
        <div className="h-full min-h-0 overflow-auto">
            <Suspense fallback={<EmbeddedPageFallback />}>
                <PanelComponent embedded />
            </Suspense>
        </div>
    );
}
