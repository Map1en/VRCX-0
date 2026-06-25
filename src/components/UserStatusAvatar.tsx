import { UserIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function UserStatusAvatar({
    imageUrl = '',
    statusDotClassName = ''
}: any) {
    const isActiveStatusDot = statusDotClassName.includes('bg-background');

    return (
        <span className="relative flex size-9 shrink-0 items-center justify-center overflow-visible">
            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        className="size-full object-cover"
                    />
                ) : (
                    <UserIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </span>
            {statusDotClassName ? (
                isActiveStatusDot ? (
                    <span className="border-background bg-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3">
                        <span
                            className={cn(
                                'absolute inset-0 rounded-full border-2',
                                statusDotClassName
                            )}
                        />
                    </span>
                ) : (
                    <span
                        className={cn(
                            'border-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3',
                            statusDotClassName
                        )}
                    />
                )
            ) : null}
        </span>
    );
}
