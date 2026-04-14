import { ExternalLinkIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils.js';

export function DashboardWidgetHeader({ title, icon, path, children }) {
    const navigate = useNavigate();
    const canNavigate = Boolean(path);

    return (
        <div className="group/header flex shrink-0 items-center justify-between border-b px-2.5 py-0">
            <button
                type="button"
                disabled={!canNavigate}
                className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                onClick={() => {
                    if (canNavigate) {
                        navigate(path);
                    }
                }}>
                {icon ? <i className={cn(icon, 'text-sm')} /> : null}
                <span className="truncate">{title}</span>
                {canNavigate ? <ExternalLinkIcon className="size-3 opacity-0 transition-opacity group-hover/header:opacity-100" /> : null}
            </button>
            <div className="invisible pointer-events-none opacity-0 transition-opacity group-hover/header:visible group-hover/header:pointer-events-auto group-hover/header:opacity-100 group-focus-within/header:visible group-focus-within/header:pointer-events-auto group-focus-within/header:opacity-100">
                {children}
            </div>
        </div>
    );
}
