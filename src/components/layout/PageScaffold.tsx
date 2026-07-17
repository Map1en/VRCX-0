import { ArrowLeftIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

type EmptyStateVariant = 'page' | 'panel' | 'table' | 'inline';

const emptyStateVariantClassName: Record<EmptyStateVariant, string> = {
    page: 'min-h-72',
    panel: 'min-h-48 px-4',
    table: 'min-h-24 px-3',
    inline: 'min-h-0 py-4'
};

export function PageScaffold({
    embedded = false,
    flushBottom = false,
    className = '',
    embeddedClassName = '',
    children,
    ...divProps
}: any) {
    return (
        <div
            {...divProps}
            className={cn(
                'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
                embedded ? 'p-3' : 'x-container x-container--auto-height p-4',
                embedded ? embeddedClassName : '',
                className,
                flushBottom && 'pb-0'
            )}
        >
            {children}
        </div>
    );
}

export function PageToolbar({ className = '', children }: any) {
    return (
        <div
            className={cn(
                'border-border flex shrink-0 flex-col gap-2 pb-3',
                className
            )}
        >
            {children}
        </div>
    );
}

export function PageHeader({ className = '', children }: any) {
    return (
        <div className={cn('flex shrink-0 flex-col gap-1 p-1.5', className)}>
            {children}
        </div>
    );
}

export function PageTitle({ className = '', children }: any) {
    return (
        <h1
            className={cn(
                'font-heading text-foreground text-base leading-5 font-medium',
                className
            )}
        >
            {children}
        </h1>
    );
}

export function PageDescription({ className = '', children }: any) {
    return (
        <p className={cn('text-muted-foreground text-sm', className)}>
            {children}
        </p>
    );
}

export function PageToolbarRow({ className = '', children }: any) {
    return (
        <div
            className={cn(
                'flex min-w-0 flex-wrap items-center gap-2',
                className
            )}
        >
            {children}
        </div>
    );
}

export function PageBackButton({ label, onClick, className = '' }: any) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
                'text-muted-foreground hover:text-foreground -ml-1 h-8 shrink-0 gap-1.5 rounded-md px-1.5 font-medium',
                className
            )}
            onClick={onClick}
        >
            <ArrowLeftIcon data-icon="inline-start" className="size-4" />
            <span className="truncate">{label}</span>
        </Button>
    );
}

export function PageBody({ className = '', children }: any) {
    return (
        <div
            className={cn(
                'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden',
                className
            )}
        >
            {children}
        </div>
    );
}

export function PageFooter({ className = '', children }: any) {
    return (
        <div
            className={cn(
                'flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between',
                className
            )}
        >
            {children}
        </div>
    );
}

export function EmptyState({
    title,
    description,
    icon: Icon,
    variant = 'page',
    className = '',
    contentClassName = '',
    descriptionClassName = '',
    children
}: {
    title?: ReactNode;
    description?: ReactNode;
    icon?: ComponentType;
    variant?: EmptyStateVariant;
    className?: string;
    contentClassName?: string;
    descriptionClassName?: string;
    children?: ReactNode;
}) {
    const safeDescription =
        typeof description === 'string'
            ? userFacingErrorMessage(
                  description,
                  'The requested data could not be loaded.'
              )
            : description;
    const hasHeaderContent = Boolean(Icon || title || safeDescription);

    return (
        <Empty className={cn(emptyStateVariantClassName[variant], className)}>
            {hasHeaderContent ? (
                <EmptyHeader className={contentClassName}>
                    {Icon ? (
                        <EmptyMedia variant="icon">
                            <Icon />
                        </EmptyMedia>
                    ) : null}
                    {title ? <EmptyTitle>{title}</EmptyTitle> : null}
                    {safeDescription ? (
                        <EmptyDescription className={descriptionClassName}>
                            {safeDescription}
                        </EmptyDescription>
                    ) : null}
                </EmptyHeader>
            ) : null}
            {children ? <EmptyContent>{children}</EmptyContent> : null}
        </Empty>
    );
}

export function LoadingState({
    label,
    variant,
    className = ''
}: {
    label?: ReactNode;
    variant?: EmptyStateVariant;
    className?: string;
}) {
    return (
        <EmptyState variant={variant} className={className}>
            <div className="text-muted-foreground flex items-center gap-2">
                <Spinner />
                {label}
            </div>
        </EmptyState>
    );
}
