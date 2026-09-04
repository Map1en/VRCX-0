import {
    Globe2Icon,
    ImageOffIcon,
    PersonStandingIcon,
    UserRoundIcon,
    UsersRoundIcon,
    XIcon
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { formatClock } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import type { BrowseHistoryItemOutput } from '@/repositories/browseHistoryRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Button } from '@/ui/shadcn/button';

const iconByKind = {
    user: UserRoundIcon,
    world: Globe2Icon,
    avatar: PersonStandingIcon,
    group: UsersRoundIcon
};

function openHistoryItem(item: BrowseHistoryItemOutput) {
    const seedData = {
        id: item.entityId,
        name: item.title,
        displayName: item.title,
        thumbnailImageUrl: item.imageUrl,
        profilePicOverrideThumbnail: item.imageUrl,
        iconUrl: item.imageUrl
    };
    switch (item.entityKind) {
        case 'user':
            openUserDialog({
                userId: item.entityId,
                title: item.title,
                seedData
            });
            break;
        case 'world':
            openWorldDialog({
                worldId: item.entityId,
                title: item.title,
                seedData
            });
            break;
        case 'avatar':
            openAvatarDialog({
                avatarId: item.entityId,
                title: item.title,
                seedData
            });
            break;
        case 'group':
            openGroupDialog({
                groupId: item.entityId,
                title: item.title,
                seedData
            });
            break;
    }
}

export const BrowseHistoryCard = memo(function BrowseHistoryCard({
    item,
    onRemove
}: {
    item: BrowseHistoryItemOutput;
    onRemove: (item: BrowseHistoryItemOutput) => Promise<boolean>;
}) {
    const { t } = useTranslation();
    const [removing, setRemoving] = useState(false);
    const Icon = iconByKind[item.entityKind];
    const imageUrl = convertFileUrlToImageUrl(item.imageUrl, 128);
    const title = item.title || t(`browse_history.unknown.${item.entityKind}`);
    const imageFallback = (
        <div className="bg-muted text-muted-foreground flex size-full items-center justify-center">
            {item.imageUrl ? (
                <ImageOffIcon className="size-4" />
            ) : (
                <Icon className="size-4" />
            )}
        </div>
    );

    return (
        <div
            className={cn(
                'object-row h-16',
                removing && 'pointer-events-none opacity-0'
            )}
        >
            <button
                type="button"
                className="object-row__pressable flex size-full min-w-0 cursor-pointer items-stretch rounded-lg text-left"
                onClick={() => openHistoryItem(item)}
            >
                <div className="object-row__media">
                    {imageUrl ? (
                        <FadeInImage
                            src={imageUrl}
                            alt=""
                            className="size-full object-cover"
                            fallback={imageFallback}
                        />
                    ) : (
                        imageFallback
                    )}
                    <div
                        aria-hidden="true"
                        className="object-row__media-blend"
                    />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 pr-8">
                    <div className="flex items-center gap-1.5">
                        <Icon className="text-muted-foreground size-3 shrink-0" />
                        <span className="object-row__title truncate text-[13px] leading-tight">
                            {title}
                        </span>
                    </div>
                    <p className="object-row__meta truncate text-[11px] leading-tight">
                        {formatClock(item.lastViewedAt)}
                        {item.viewCount > 1 ? ` · ×${item.viewCount}` : ''}
                    </p>
                </div>
            </button>
            <div className="absolute inset-y-0 right-1 z-10 flex items-center">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                        'object-row__context-action',
                        'text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
                    )}
                    aria-label={t('browse_history.actions.remove')}
                    onClick={() => {
                        setRemoving(true);
                        void onRemove(item).then((removed) => {
                            if (!removed) {
                                setRemoving(false);
                            }
                        });
                    }}
                >
                    <XIcon className="size-3.5" />
                </Button>
            </div>
        </div>
    );
});
