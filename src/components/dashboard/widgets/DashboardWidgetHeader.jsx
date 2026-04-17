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
                className="text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground h-auto min-w-0 justify-start px-0 py-0 text-xs font-semibold hover:bg-transparent disabled:cursor-default"
                onClick={() => {
                    if (canNavigate) {
                        navigate(path);
                    }
                }}
            >
                {icon ? <i className={cn(icon, 'text-sm')} /> : null}
                <span className="truncate">{title}</span>
                {canNavigate ? (
                    <ExternalLinkIcon
                        data-icon="inline-end"
                        className="opacity-0 transition-opacity group-hover/header:opacity-100"
                    />
                ) : null}
            </Button>
            <div className="pointer-events-none invisible opacity-0 transition-opacity group-focus-within/header:pointer-events-auto group-focus-within/header:visible group-focus-within/header:opacity-100 group-hover/header:pointer-events-auto group-hover/header:visible group-hover/header:opacity-100">
                {children}
            </div>
        </div>
    );
}
