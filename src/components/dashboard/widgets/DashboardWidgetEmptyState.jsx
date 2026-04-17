export function DashboardWidgetEmptyState({ title, description }) {
    return (
        <div className="bg-muted/10 flex min-h-[180px] flex-1 items-center justify-center rounded-md border border-dashed p-4 text-center">
            <div className="flex max-w-xs flex-col gap-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-xs">
                    {description}
                </div>
            </div>
        </div>
    );
}
