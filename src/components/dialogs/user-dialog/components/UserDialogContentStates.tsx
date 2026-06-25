import { EntityDialogScaffold } from '@/components/dialogs/EntityDialogScaffold';
import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { Card } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Spinner } from '@/ui/shadcn/spinner';

export function UserDialogEmptyState({
    title,
    description,
    loading = false
}: any) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

function SkeletonLine({ className }: any) {
    return <Skeleton className={cn('h-4', className)} />;
}

function UserDialogHeaderSkeleton() {
    return (
        <Card size="sm" className="border shadow-none ring-0">
            <div className="space-y-4 px-4 pb-1">
                <div className="relative">
                    <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                    <Skeleton className="absolute right-3 bottom-3 size-16 rounded-full border-2 border-white shadow-sm" />
                </div>
                <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                        <SkeletonLine className="h-6 w-44" />
                        <SkeletonLine className="w-32" />
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Skeleton className="size-10 rounded-xl" />
                        <Skeleton className="size-10 rounded-xl" />
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <SkeletonLine className="h-7 w-24 rounded-full" />
                    <SkeletonLine className="h-7 w-24 rounded-full" />
                    <SkeletonLine className="h-7 w-16 rounded-full" />
                </div>
                <div className="flex gap-2 border-y py-4">
                    <Skeleton className="size-9 rounded-full" />
                    <Skeleton className="size-9 rounded-full" />
                    <Skeleton className="size-9 rounded-full" />
                    <Skeleton className="size-9 rounded-full" />
                </div>
                <div className="space-y-3">
                    <SkeletonLine className="w-3/4" />
                    <SkeletonLine className="w-2/3" />
                </div>
            </div>
        </Card>
    );
}

function UserDialogPanelSkeleton({ compact = false }: any) {
    return (
        <Card size="sm" className="border shadow-none ring-0">
            <div className="space-y-4 px-4">
                <SkeletonLine className="h-5 w-36" />
                <div className="space-y-2">
                    <SkeletonLine className="w-11/12" />
                    <SkeletonLine className="w-4/5" />
                    {!compact ? <SkeletonLine className="w-2/3" /> : null}
                </div>
                {!compact ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                        <SkeletonLine className="h-10" />
                        <SkeletonLine className="h-10" />
                    </div>
                ) : null}
            </div>
        </Card>
    );
}

export function UserDialogProfileSkeleton({
    label = 'Loading user profile',
    visible = true
}: any) {
    return (
        <EntityDialogScaffold
            className={cn(
                'gap-3 transition-opacity duration-150',
                visible ? 'opacity-100' : 'opacity-0'
            )}
        >
            <div
                aria-busy="true"
                aria-label={label}
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden min-[880px]:grid min-[880px]:grid-cols-[20rem_minmax(0,1fr)]"
                role="status"
            >
                <span className="sr-only">{label}</span>
                <div className="max-h-[42vh] min-h-0 min-w-0 shrink-0 overflow-hidden p-px min-[880px]:max-h-none min-[880px]:shrink">
                    <UserDialogHeaderSkeleton />
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                    <div className="flex h-11 min-h-11 gap-6 border-b px-4">
                        <SkeletonLine className="mt-3 w-12" />
                        <SkeletonLine className="mt-3 w-28" />
                        <SkeletonLine className="mt-3 w-20" />
                        <SkeletonLine className="mt-3 hidden w-24 sm:block" />
                    </div>
                    <div className="grid min-h-0 min-w-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                        <div className="min-w-0 space-y-4">
                            <UserDialogPanelSkeleton />
                            <UserDialogPanelSkeleton />
                        </div>
                        <div className="min-w-0 space-y-4">
                            <UserDialogPanelSkeleton compact />
                            <UserDialogPanelSkeleton compact />
                        </div>
                    </div>
                </div>
            </div>
        </EntityDialogScaffold>
    );
}
