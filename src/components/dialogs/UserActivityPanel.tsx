// @ts-nocheck
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Spinner } from '@/ui/shadcn/spinner';

const UserActivityPanelImpl = lazy(() =>
    import('./UserActivityPanelImpl').then((module) => ({
        default: module.UserActivityPanel
    }))
);

function UserActivityPanelFallback() {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
            <span>{t('dialog.user.loading.loading_activity')}</span>
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
