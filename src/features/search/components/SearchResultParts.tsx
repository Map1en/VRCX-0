import {
    GlobeIcon,
    PersonStandingIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    getNameColour,
    userImage
} from '@/services/entityMediaService';
import {
    languageOptionLabel,
    normalizeProfileLanguageRows
} from '@/shared/utils/userLanguage';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function SearchEmptyState() {
    const { t } = useTranslation();

    return <EmptyState title={t('common.no_data')} className="min-h-56" />;
}

export function SearchLoadingState() {
    const { t } = useTranslation();

    return <LoadingState label={t('common.loading')} className="min-h-56" />;
}

const searchMediaTextStyle: any = {
    textShadow: '0 1px 2px rgb(0 0 0 / 0.9), 0 0 10px rgb(0 0 0 / 0.65)'
};

function SearchMediaCard({
    imageUrl,
    imageAlt,
    title,
    subtitle,
    FallbackIcon,
    onClick
}: any) {
    return (
        <Button
            type="button"
            variant="outline"
            className="group/search-media h-auto w-full min-w-0 flex-col items-stretch justify-start overflow-hidden p-0 text-left font-normal whitespace-normal"
            onClick={onClick}
        >
            <div className="bg-muted relative aspect-[16/10] w-full overflow-hidden">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={imageAlt}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover/search-media:scale-[1.02] group-focus-visible/search-media:scale-[1.02]"
                    />
                ) : (
                    <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-8">
                        <FallbackIcon />
                    </div>
                )}
                <div className="absolute right-0 bottom-0 left-0 flex min-w-0 flex-col gap-1 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-3 pt-10 pb-3">
                    <span
                        className="block truncate text-sm font-semibold text-white"
                        style={searchMediaTextStyle}
                    >
                        {title || ''}
                    </span>
                    <span
                        className="block min-h-4 truncate text-xs font-medium text-white/75"
                        style={searchMediaTextStyle}
                    >
                        {subtitle || ''}
                    </span>
                </div>
            </div>
        </Button>
    );
}

function SearchEntityCard({
    imageUrl,
    imageAlt,
    imageShape = 'user',
    FallbackIcon,
    title,
    titleStyle,
    titleMeta,
    meta,
    description,
    onClick
}: any) {
    const imageClassName =
        imageShape === 'group' ? 'rounded-lg' : 'rounded-full';
    const frameClassName =
        imageShape === 'group' ? 'after:rounded-lg' : 'after:rounded-full';

    return (
        <Button
            type="button"
            variant="outline"
            className="h-auto w-full min-w-0 items-start justify-start gap-3 overflow-hidden p-3 text-left font-normal whitespace-normal"
            onClick={onClick}
        >
            <Avatar className={cn('size-14', imageClassName, frameClassName)}>
                {imageUrl ? (
                    <AvatarImage
                        src={imageUrl}
                        alt={imageAlt}
                        loading="lazy"
                        className={imageClassName}
                    />
                ) : null}
                <AvatarFallback
                    className={cn(imageClassName, '[&>svg]:size-5')}
                >
                    <FallbackIcon aria-hidden="true" />
                </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                <span className="flex max-w-full min-w-0 items-center gap-1.5">
                    <span
                        className="min-w-0 truncate text-sm font-semibold"
                        style={titleStyle}
                    >
                        {title || ''}
                    </span>
                    {titleMeta}
                </span>
                {meta ? (
                    <span className="flex max-w-full min-w-0 flex-wrap items-center gap-1 overflow-hidden">
                        {meta}
                    </span>
                ) : null}
                {description ? (
                    <span className="text-muted-foreground line-clamp-2 text-xs leading-snug break-words">
                        {description}
                    </span>
                ) : null}
            </span>
        </Button>
    );
}

function TruncatedBadge({ children, tooltip, className }: any) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge
                    variant="outline"
                    className={cn(
                        'max-w-36 min-w-0 justify-start rounded-sm px-1.5',
                        className
                    )}
                >
                    <span className="min-w-0 truncate">{children}</span>
                </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 break-words">
                {tooltip || children}
            </TooltipContent>
        </Tooltip>
    );
}

function UserLanguageBadges({ user, languages }: any) {
    const visibleLanguages = languages.slice(0, 2);
    const hiddenLanguages = languages.slice(visibleLanguages.length);
    const hiddenLabel = hiddenLanguages.map(languageOptionLabel).join(', ');

    return (
        <>
            {visibleLanguages.map((language: any) => {
                const label = languageOptionLabel(language);
                return (
                    <TruncatedBadge
                        key={`${user.id}:${language.key}:${language.value}`}
                        tooltip={label}
                    >
                        {label}
                    </TruncatedBadge>
                );
            })}
            {hiddenLanguages.length ? (
                <TruncatedBadge
                    className="max-w-none shrink-0"
                    tooltip={hiddenLabel}
                >
                    +{hiddenLanguages.length}
                </TruncatedBadge>
            ) : null}
        </>
    );
}

export function AvatarCard({ avatar }: any) {
    const imageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;

    return (
        <SearchMediaCard
            imageUrl={imageUrl}
            imageAlt={avatar.name || 'Avatar'}
            title={avatar.name || ''}
            subtitle={avatar.authorName || ''}
            FallbackIcon={PersonStandingIcon}
            onClick={() =>
                openAvatarDialog({
                    avatarId: avatar.id,
                    title: avatar.name || undefined,
                    seedData: avatar
                })
            }
        />
    );
}

export function WorldCard({ world }: any) {
    const subtitle = world.occupants
        ? `${world.authorName || ''} (${world.occupants})`
        : world.authorName || '';

    return (
        <SearchMediaCard
            imageUrl={world.thumbnailImageUrl}
            imageAlt={world.name || 'World'}
            title={world.name || ''}
            subtitle={subtitle}
            FallbackIcon={GlobeIcon}
            onClick={() =>
                openWorldDialog({
                    worldId: world.id,
                    title: world.name || undefined,
                    seedData: world
                })
            }
        />
    );
}

export function UserRow({
    user,
    randomUserColours,
    isDarkMode,
    languageOptionsMap
}: any) {
    const imageUrl = userImage(user, true);
    const languages = normalizeProfileLanguageRows(user, languageOptionsMap);
    const trustStyle =
        randomUserColours && user?.id
            ? { color: getNameColour(user.id, isDarkMode) }
            : user?.$userColour
              ? { color: user.$userColour }
              : undefined;

    return (
        <SearchEntityCard
            imageUrl={imageUrl}
            imageAlt={user.displayName || user.id || 'User'}
            imageShape="user"
            FallbackIcon={UserIcon}
            title={user.displayName || ''}
            titleMeta={
                user.$trustLevel ? (
                    <span
                        className={cn(
                            'shrink-0 text-xs font-medium',
                            user.$trustClass || 'text-muted-foreground'
                        )}
                        style={trustStyle}
                    >
                        {user.$trustLevel}
                    </span>
                ) : null
            }
            meta={
                languages.length ? (
                    <UserLanguageBadges user={user} languages={languages} />
                ) : null
            }
            description={user.bio || ''}
            onClick={() =>
                openUserDialog({
                    userId: user.id,
                    title: user.displayName || user.username || undefined,
                    seedData: user
                })
            }
        />
    );
}

export function GroupRow({ group }: any) {
    const imageUrl = convertFileUrlToImageUrl(group.iconUrl);
    const groupCode =
        group.shortCode && group.discriminator
            ? `${group.shortCode}.${group.discriminator}`
            : group.shortCode || group.discriminator || null;

    return (
        <SearchEntityCard
            imageUrl={imageUrl}
            imageAlt={group.name || 'Group'}
            imageShape="group"
            FallbackIcon={UsersIcon}
            title={group.name || ''}
            titleMeta={
                <Badge
                    variant="secondary"
                    className="shrink-0 rounded-sm px-1.5 tabular-nums"
                >
                    <UsersIcon data-icon="inline-start" />
                    {group.memberCount ?? 0}
                </Badge>
            }
            meta={
                groupCode ? (
                    <TruncatedBadge
                        className="max-w-full font-mono"
                        tooltip={groupCode}
                    >
                        {groupCode}
                    </TruncatedBadge>
                ) : null
            }
            description={group.description || ''}
            onClick={() =>
                openGroupDialog({
                    groupId: group.id,
                    title: group.name || undefined,
                    seedData: group
                })
            }
        />
    );
}
