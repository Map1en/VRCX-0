import { lazy, Suspense } from 'react';

import { Spinner } from '@/ui/shadcn/spinner';
import { appI18n } from '@/services/i18nService.js';

const InstanceActivityPageImpl = lazy(() =>
    import('./InstanceActivityPageImpl.jsx').then((module) => ({
        default: module.InstanceActivityPage
    }))
);

function ChartPageFallback() {
    return (
        <div className="text-muted-foreground flex h-full min-h-0 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>{appI18n.t('view.charts.generated.loading_chart')}</span>
        </div>
    );
}

export function InstanceActivityPage(props) {
    return (
        <Suspense fallback={<ChartPageFallback />}>
            <InstanceActivityPageImpl {...props} />
        </Suspense>
    );
}
