import { UserIcon } from 'lucide-react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { UserStatusDot } from '@/components/UserStatusDot';

export function UserStatusAvatar({
    imageUrl = '',
    statusDotClassName = ''
}: {
    imageUrl?: string;
    statusDotClassName?: string;
}) {
    return (
        <span className="relative flex size-9 shrink-0 items-center justify-center overflow-visible">
            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        className="size-full object-cover"
                        fallback={
                            <UserIcon
                                data-icon="inline-start"
                                className="text-muted-foreground"
                            />
                        }
                    />
                ) : (
                    <UserIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </span>
            <UserStatusDot
                statusDotClassName={statusDotClassName}
                className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
            />
        </span>
    );
}
