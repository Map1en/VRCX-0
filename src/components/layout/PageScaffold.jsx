import { cn } from '@/lib/utils.js';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

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
        <div className={cn('flex shrink-0 flex-col gap-2 border-border pb-3', className)}>
            {children}
        </div>
    );
}

export function PageHeader({ className = '', children }) {
    return (
        <div className={cn('flex shrink-0 flex-col gap-1 p-1.5', className)}>
            {children}
        </div>
    );
}

export function PageTitle({ className = '', children }) {
    return (
        <h1 className={cn('font-heading text-lg leading-none font-medium text-foreground', className)}>
            {children}
        </h1>
    );
}

export function PageDescription({ className = '', children }) {
    return (
        <p className={cn('text-sm text-muted-foreground', className)}>
            {children}
        </p>
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
        <Empty className={cn('min-h-72', className)}>
            <EmptyHeader className={contentClassName}>
                {Icon ? (
                    <EmptyMedia variant="icon">
                        <Icon />
                    </EmptyMedia>
                ) : null}
                {title ? <EmptyTitle>{title}</EmptyTitle> : null}
                {description ? <EmptyDescription>{description}</EmptyDescription> : null}
            </EmptyHeader>
            {children ? <EmptyContent>{children}</EmptyContent> : null}
        </Empty>
    );
}

export function LoadingState({ label, className = '' }) {
    return (
        <EmptyState className={className}>
            <div className="flex items-center gap-2">
                <Spinner />
                {label}
            </div>
        </EmptyState>
    );
}
