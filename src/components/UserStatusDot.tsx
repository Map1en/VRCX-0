import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type UserStatusDotProps = HTMLAttributes<HTMLSpanElement> & {
    statusDotClassName?: string;
    variant?: 'avatar' | 'inline';
};

function isActiveStatusDotClassName(statusDotClassName = ''): boolean {
    return statusDotClassName.includes('bg-background');
}

export function UserStatusDot({
    statusDotClassName = '',
    className = '',
    variant = 'avatar',
    ...dotProps
}: UserStatusDotProps) {
    if (!statusDotClassName) {
        return null;
    }

    const isActiveStatusDot = isActiveStatusDotClassName(statusDotClassName);

    if (variant === 'inline') {
        return (
            <span
                {...dotProps}
                className={cn(
                    'rounded-full',
                    className,
                    isActiveStatusDot && 'border-2',
                    statusDotClassName
                )}
            />
        );
    }

    return (
        <span
            {...dotProps}
            className={cn(
                'border-background bg-background rounded-full border-3',
                className
            )}
        >
            <span
                className={cn(
                    'absolute inset-0 rounded-full',
                    isActiveStatusDot && 'border-2',
                    statusDotClassName
                )}
            />
        </span>
    );
}
