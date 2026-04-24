import { lazy, Suspense } from 'react';

import { useTranslation } from 'react-i18next';
import { Spinner } from '@/ui/shadcn/spinner';

const InstanceActivityPageImpl = lazy(() =>
    import('./InstanceActivityPageImpl.jsx').then((module) => ({
        default: module.InstanceActivityPage
    }))
);

function ChartPageFallback() {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground flex h-full min-h-0 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>{t('view.charts.generated.loading_chart')}</span>
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
