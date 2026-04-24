import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';
import { cn } from '@/lib/utils.js';

export function GroupListState({
    title = 'No rows',
    description = 'No matching entries.',
    loading = false,
    error = '',
    className = ''
}) {
    const { t } = useTranslation();

    if (loading) {
        return (
            <div
                className={cn(
                    'text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm',
                    className
                )}
            >
                <Spinner className="size-4" />
                <span>{t('dialog.group.generated.loading')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive" className={className}>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    return (
        <Empty className={cn('min-h-32 border', className)}>
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}
