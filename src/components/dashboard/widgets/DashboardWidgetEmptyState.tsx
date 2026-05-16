// @ts-nocheck
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

export function DashboardWidgetEmptyState({ title, description }) {
    return (
        <Empty className="min-h-[180px] flex-1 rounded-md border p-4">
            <EmptyHeader className="max-w-xs gap-1">
                <EmptyTitle>{title}</EmptyTitle>
                <EmptyDescription className="text-xs">
                    {description}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}
