import { Suspense } from 'react';
import { LoaderCircleIcon } from 'lucide-react';

import { getDashboardPagePanelComponent } from './dashboardPagePanelRegistry.jsx';

function EmbeddedPageFallback() {
    return (
        <div className="flex min-h-[220px] flex-1 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
            Loading dashboard panel
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
