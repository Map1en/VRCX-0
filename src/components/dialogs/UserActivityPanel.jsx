import { lazy, Suspense } from 'react';

import { Spinner } from '@/ui/shadcn/spinner';
import { appI18n } from '@/services/i18nService.js';

const UserActivityPanelImpl = lazy(() =>
    import('./UserActivityPanelImpl.jsx').then((module) => ({
        default: module.UserActivityPanel
    }))
);

function UserActivityPanelFallback() {
    return (
        <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>{appI18n.t('dialog.user.generated.loading_activity')}</span>
        </div>
    );
}

export function UserActivityPanel(props) {
    return (
        <Suspense fallback={<UserActivityPanelFallback />}>
            <UserActivityPanelImpl {...props} />
        </Suspense>
    );
}
