import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';

type UserDetailContentProps = {
    imageUrl?: string;
    statusDotClassName?: string;
    displayName: ReactNode;
    namePrefix?: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
};

export function UserDetailContent({
    imageUrl = '',
    statusDotClassName = '',
    displayName,
    namePrefix,
    nameStyle,
    subline
}: UserDetailContentProps) {
    return (
        <>
            <UserStatusAvatar
                imageUrl={imageUrl}
                statusDotClassName={statusDotClassName}
            />
            <span className="min-w-0 flex-1 overflow-hidden">
                <span
                    className="block truncate leading-5 font-medium"
                    style={nameStyle}
                >
                    {namePrefix ? (
                        <span className="flex min-w-0 items-center gap-1">
                            {namePrefix}
                            <span className="min-w-0 truncate">
                                {displayName}
                            </span>
                        </span>
                    ) : (
                        displayName
                    )}
                </span>
                {subline ? (
                    <span className="text-content-secondary block truncate text-xs">
                        {subline}
                    </span>
                ) : null}
            </span>
        </>
    );
}

type UserDetailTileProps = UserDetailContentProps & {
    userId?: string;
    seed?: ComponentProps<typeof UserHoverCard>['seed'];
    hoverSide?: ComponentProps<typeof UserHoverCard>['side'];
    hoverDisabled?: boolean;
    disabled?: boolean;
    className?: string;
    onOpen?: () => void;
};

export function UserDetailTile({
    userId,
    seed = null,
    hoverSide,
    hoverDisabled = false,
    disabled = false,
    className,
    onOpen,
    ...contentProps
}: UserDetailTileProps) {
    return (
        <UserHoverCard
            userId={userId}
            seed={seed}
            side={hoverSide}
            disabled={hoverDisabled || disabled}
        >
            <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                className={cn(
                    'h-auto min-w-0 justify-start gap-2 px-1.5 py-1.5 text-left font-normal',
                    className
                )}
                onClick={onOpen}
            >
                <UserDetailContent {...contentProps} />
            </Button>
        </UserHoverCard>
    );
}
