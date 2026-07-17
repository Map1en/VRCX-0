import type { ReactNode } from 'react';

import { EmptyState } from '@/components/layout/PageScaffold';

export function DashboardWidgetEmptyState({
    title,
    description
}: {
    title?: ReactNode;
    description?: ReactNode;
}) {
    return (
        <EmptyState
            variant="panel"
            title={title}
            description={description}
            className="min-h-[180px] flex-1 rounded-md border p-4"
            contentClassName="max-w-xs gap-1"
            descriptionClassName="text-xs"
        />
    );
}
