import { lazy, Suspense } from 'react';

import { Spinner } from '@/ui/shadcn/spinner';

const MutualFriendsPageImpl = lazy(() =>
    import('./MutualFriendsPageImpl.jsx').then((module) => ({
        default: module.MutualFriendsPage
    }))
);

function ChartPageFallback() {
    return (
        <div className="text-muted-foreground flex h-full min-h-0 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>Loading graph...</span>
        </div>
    );
}

export function MutualFriendsPage(props) {
    return (
        <Suspense fallback={<ChartPageFallback />}>
            <MutualFriendsPageImpl {...props} />
        </Suspense>
    );
}
