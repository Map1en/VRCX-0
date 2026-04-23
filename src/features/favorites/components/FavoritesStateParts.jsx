import { Spinner } from '@/ui/shadcn/spinner';

function FavoritesEmptyState({ title, description }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center p-6 text-center">
            <div className="flex max-w-sm flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </div>
    );
}

function FavoritesLoadingState({ title }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <Spinner />
                <span>{title}</span>
            </div>
        </div>
    );
}

export { FavoritesEmptyState, FavoritesLoadingState };
