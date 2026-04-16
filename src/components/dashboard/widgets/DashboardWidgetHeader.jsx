import { ExternalLinkIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';

export function DashboardWidgetHeader({ title, icon, path, children }) {
    const navigate = useNavigate();
    const canNavigate = Boolean(path);

    return (
        <div className="group/header flex shrink-0 items-center justify-between border-b px-2.5 py-0">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canNavigate}
                className="h-auto min-w-0 justify-start px-0 py-0 text-xs font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                onClick={() => {
                    if (canNavigate) {
                        navigate(path);
                    }
                }}>
                {icon ? <i className={cn(icon, 'text-sm')} /> : null}
                <span className="truncate">{title}</span>
                {canNavigate ? <ExternalLinkIcon data-icon="inline-end" className="opacity-0 transition-opacity group-hover/header:opacity-100" /> : null}
            </Button>
            <div className="invisible pointer-events-none opacity-0 transition-opacity group-hover/header:visible group-hover/header:pointer-events-auto group-hover/header:opacity-100 group-focus-within/header:visible group-focus-within/header:pointer-events-auto group-focus-within/header:opacity-100">
                {children}
            </div>
        </div>
    );
}
