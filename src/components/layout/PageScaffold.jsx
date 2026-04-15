import { LoaderCircleIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';

export function PageScaffold({
    embedded = false,
    className = '',
    embeddedClassName = '',
    children
}) {
    return (
        <div
            className={cn(
                'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
                embedded
                    ? 'p-3'
                    : 'x-container x-container--auto-height p-4 pb-0',
                embedded ? embeddedClassName : '',
                className
            )}>
            {children}
        </div>
    );
}

export function PageToolbar({ className = '', children }) {
    return (
        <div className={cn('flex shrink-0 flex-col gap-2 border-b border-border pb-3', className)}>
            {children}
        </div>
    );
}

export function PageToolbarRow({ className = '', children }) {
    return (
        <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
            {children}
        </div>
    );
}

export function PageBody({ className = '', children }) {
    return (
        <div className={cn('flex min-h-0 flex-1 flex-col gap-3 overflow-hidden', className)}>
            {children}
        </div>
    );
}

export function PageFooter({ className = '', children }) {
    return (
        <div
            className={cn(
                'flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between',
                className
            )}>
            {children}
        </div>
    );
}

export function EmptyState({
    title,
    description,
    icon: Icon,
    className = '',
    contentClassName = '',
    children
}) {
    return (
        <div
            className={cn(
                'flex min-h-72 flex-1 items-center justify-center rounded-md border border-dashed bg-muted/20 p-6 text-center',
                className
            )}>
            <div className={cn('flex max-w-sm flex-col items-center gap-2', contentClassName)}>
                {Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
                {title ? <div className="text-sm font-medium">{title}</div> : null}
                {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
                {children}
            </div>
        </div>
    );
}

export function LoadingState({ label, className = '' }) {
    return (
        <EmptyState className={className}>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-5 animate-spin" />
                {label}
            </div>
        </EmptyState>
    );
}
