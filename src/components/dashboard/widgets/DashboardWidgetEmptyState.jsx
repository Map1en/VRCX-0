export function DashboardWidgetEmptyState({ title, description }) {
    return (
        <div className="flex min-h-[180px] flex-1 items-center justify-center rounded-md border border-dashed bg-muted/10 p-4 text-center">
            <div className="max-w-xs space-y-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}
