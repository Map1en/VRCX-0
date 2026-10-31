import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const BRANCH_LAYOUT = {
    drawer: {
        indent: 'pl-12',
        left: 'left-[54px]',
        elbow: 'h-[30px] w-4',
        tick: 'top-[30px] w-4'
    },
    page: {
        indent: 'pl-10',
        left: 'left-[46px]',
        elbow: 'h-7 w-3.5',
        tick: 'top-7 w-3.5'
    }
} as const;

export function NotificationGroupBranch<T>({
    items,
    getKey,
    renderItem,
    variant
}: {
    getKey(item: T): string;
    items: readonly T[];
    renderItem(item: T): ReactNode;
    variant: 'page' | 'drawer';
}) {
    const layout = BRANCH_LAYOUT[variant];
    return (
        <div role={variant === 'page' ? 'list' : undefined}>
            {items.map((item, index) => (
                <div
                    key={getKey(item)}
                    role="none"
                    className={cn('relative', layout.indent)}
                >
                    {index === items.length - 1 ? (
                        <span
                            aria-hidden
                            className={cn(
                                'border-border absolute top-0 rounded-bl-md border-b border-l',
                                layout.left,
                                layout.elbow
                            )}
                        />
                    ) : (
                        <>
                            <span
                                aria-hidden
                                className={cn(
                                    'bg-border absolute top-0 bottom-0 w-px',
                                    layout.left
                                )}
                            />
                            <span
                                aria-hidden
                                className={cn(
                                    'bg-border absolute h-px',
                                    layout.left,
                                    layout.tick
                                )}
                            />
                        </>
                    )}
                    {renderItem(item)}
                </div>
            ))}
        </div>
    );
}
