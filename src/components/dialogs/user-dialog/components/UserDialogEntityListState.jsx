import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

import { Spinner } from '@/ui/shadcn/spinner';

export function EntityListEmptyTitle(kind) {
    if (kind === 'user') {
        return 'No users';
    }
    if (kind === 'world') {
        return 'No worlds';
    }
    if (kind === 'avatar') {
        return 'No avatars';
    }
    if (kind === 'group') {
        return 'No groups';
    }
    return 'No results';
}

export function EntityListState({ kind, loading = false, error = '' }) {
    const { t } = useTranslation();

    if (loading) {
        return (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
                <Spinner className="size-4" />
                <span>{t('dialog.user.generated.loading')}</span>
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
                <EmptyTitle>{EntityListEmptyTitle(kind)}</EmptyTitle>
                <EmptyDescription>
                    {t('common.no_matching_entries')}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}
