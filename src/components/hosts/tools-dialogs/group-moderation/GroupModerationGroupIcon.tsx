import { ShieldUserIcon } from 'lucide-react';

import { FadeInImage } from '@/components/media/FadeInImage';
import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

export function GroupModerationGroupIcon({
    group
}: {
    group: UserGroupsOverviewGroup;
}) {
    const iconUrl = group.iconUrl
        ? convertFileUrlToImageUrl(group.iconUrl, 128)
        : '';
    return (
        <span className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border">
            {iconUrl ? (
                <FadeInImage
                    src={iconUrl}
                    alt=""
                    className="size-full object-cover"
                    fallback={
                        <ShieldUserIcon className="text-muted-foreground size-4" />
                    }
                />
            ) : (
                <ShieldUserIcon className="text-muted-foreground size-4" />
            )}
        </span>
    );
}
