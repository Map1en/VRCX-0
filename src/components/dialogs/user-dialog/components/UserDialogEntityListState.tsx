// @ts-nocheck
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

export function EntityListEmptyTitle(kind, t) {
    if (kind === 'user') {
        return t('dialog.user.empty.no_users');
    }
    if (kind === 'world') {
        return t('dialog.user.empty.no_worlds');
    }
    if (kind === 'avatar') {
        return t('dialog.user.empty.no_avatars');
    }
    if (kind === 'group') {
        return t('dialog.user.empty.no_groups');
    }
    return t('dialog.user.empty.no_results');
}

export function EntityListState({ kind, loading = false, error = '' }) {
    const { t } = useTranslation();

    if (loading) {
        return (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
                <Spinner className="size-4" />
                <span>{t('dialog.user.loading.loading')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>{EntityListEmptyTitle(kind, t)}</EmptyTitle>
                <EmptyDescription>
                    {t('common.no_matching_entries')}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}
