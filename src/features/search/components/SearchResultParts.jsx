import { GlobeIcon, UserIcon, UsersIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { EmptyState, LoadingState } from '@/components/layout/PageScaffold.jsx';
import {
    convertFileUrlToImageUrl,
    getNameColour,
    userImage
} from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { Button } from '@/ui/shadcn/button';

import { languageFlagLabel, resolveUserLanguages } from '../searchDisplay.js';

export function SearchEmptyState() {
    const { t } = useTranslation();

    return (
        <EmptyState
            title={t('common.no_data')}
            className="min-h-56"
        />
    );
}

export function SearchLoadingState() {
    const { t } = useTranslation();

    return (
        <LoadingState
            label={t('common.loading')}
            className="min-h-56"
        />
    );
}

export function AvatarCard({ avatar }) {
    const imageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;

    return (
        <Button
            type="button"
            variant="outline"
            className="h-auto w-full min-w-0 flex-col items-stretch justify-start p-3 text-left font-normal whitespace-normal"
            onClick={() =>
                openAvatarDialog({
                    avatarId: avatar.id,
                    title: avatar.name || undefined,
                    seedData: avatar
                })
            }
        >
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={avatar.name}
                    loading="lazy"
                    className="aspect-[16/10] w-full rounded-lg object-cover"
                />
            ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[16/10] w-full items-center justify-center rounded-lg [&>svg]:size-8">
                    <UserIcon />
                </div>
            )}
            <div className="mt-2 flex min-w-0 flex-col gap-1">
                <div className="truncate text-sm font-medium">
                    {avatar.name || ''}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                    {avatar.authorName || ''}
                </div>
            </div>
        </Button>
    );
}

export function WorldCard({ world }) {
    return (
        <Button
            type="button"
            variant="outline"
            className="h-auto w-full min-w-0 flex-col items-stretch justify-start p-3 text-left font-normal whitespace-normal"
            onClick={() =>
                openWorldDialog({
                    worldId: world.id,
                    title: world.name || undefined,
                    seedData: world
                })
            }
        >
            {world.thumbnailImageUrl ? (
                <img
                    src={world.thumbnailImageUrl}
                    alt={world.name}
                    loading="lazy"
                    className="aspect-[16/10] w-full rounded-lg object-cover"
                />
            ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[16/10] w-full items-center justify-center rounded-lg [&>svg]:size-8">
                    <GlobeIcon />
                </div>
            )}
            <div className="mt-2 flex min-w-0 flex-col gap-1">
                <div className="truncate text-sm font-medium">{world.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                    {world.occupants
                        ? `${world.authorName || ''} (${world.occupants})`
                        : world.authorName || ''}
                </div>
            </div>
        </Button>
    );
}

export function UserRow({ user, randomUserColours, isDarkMode }) {
    const imageUrl = userImage(user, true);
    const languages = resolveUserLanguages(user);
    const trustStyle =
        randomUserColours && user?.id
            ? { color: getNameColour(user.id, isDarkMode) }
            : user?.$userColour
              ? { color: user.$userColour }
              : undefined;

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-none border-b px-3 py-2 text-left font-normal whitespace-normal"
            onClick={() =>
                openUserDialog({
                    userId: user.id,
                    title: user.displayName || user.username || undefined,
                    seedData: user
                })
            }
        >
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={user.displayName || user.id}
                    loading="lazy"
                    className="size-14 rounded-full object-cover"
                />
            ) : (
                <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full [&>svg]:size-5">
                    <UserIcon />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex max-w-full items-center gap-1.5">
                    <div className="truncate text-sm font-medium">
                        {user.displayName || ''}
                    </div>
                    <span
                        className={cn(
                            'shrink-0 text-xs font-normal',
                            user.$trustClass || 'text-muted-foreground'
                        )}
                        style={trustStyle}
                    >
                        {user.$trustLevel || ''}
                    </span>
                    {languages.map((entry) => (
                        <span
                            key={`${user.id}-${entry.key}-${entry.value}`}
                            className="shrink-0 text-sm leading-none"
                            title={entry.value || entry.key}
                        >
                            {languageFlagLabel(entry.key)}
                        </span>
                    ))}
                </div>
                {user.bio ? (
                    <div className="text-muted-foreground line-clamp-1 text-xs">
                        {user.bio}
                    </div>
                ) : null}
            </div>
        </Button>
    );
}

export function GroupRow({ group }) {
    const imageUrl = convertFileUrlToImageUrl(group.iconUrl);
    const groupCode =
        group.shortCode && group.discriminator
            ? `${group.shortCode}.${group.discriminator}`
            : group.shortCode || group.discriminator || null;

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 rounded-none border-b px-3 py-2 text-left font-normal whitespace-normal"
            onClick={() =>
                openGroupDialog({
                    groupId: group.id,
                    title: group.name || undefined,
                    seedData: group
                })
            }
        >
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={group.name}
                    loading="lazy"
                    className="size-14 rounded-lg object-cover"
                />
            ) : (
                <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-lg [&>svg]:size-5">
                    <UsersIcon />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex max-w-full items-center gap-1.5">
                    <div className="truncate text-sm font-medium">
                        {group.name}
                    </div>
                    <span className="shrink-0 text-xs font-normal">
                        ({group.memberCount ?? 0})
                    </span>
                    {groupCode ? (
                        <span className="text-muted-foreground shrink-0 font-mono text-xs">
                            {groupCode}
                        </span>
                    ) : null}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                    {group.description || ''}
                </div>
            </div>
        </Button>
    );
}
