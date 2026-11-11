import {
    GlobeIcon,
    PersonStandingIcon,
    SearchXIcon,
    UserIcon,
    UsersRoundIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupCard } from '@/components/groups/GroupCard';
import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import type { AvatarProfileRecord } from '@/domain/entities/avatar';
import type { UserProfileRecord } from '@/domain/entities/user';
import type { WorldProfileRecord } from '@/domain/entities/world';
import type { FriendRecord } from '@/domain/friends/types';
import { cn } from '@/lib/utils';
import type { SearchGroupJson } from '@/repositories/vrchatSearchRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { getNameColour, userImage } from '@/services/entityMediaService';
import type { UserNameColourStyle } from '@/shared/utils/entityMedia';
import { replaceBioSymbols } from '@/shared/utils/string';
import {
    languageOptionLabel,
    type LanguageOption,
    normalizeProfileLanguageRows
} from '@/shared/utils/userLanguage';
import {
    Avatar,
    AvatarFallback,
    AvatarGroup,
    AvatarGroupCount,
    AvatarImage
} from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { SearchHotWorld } from '../searchHotWorlds';
import type { SearchActiveTab } from '../searchTypes';

const SEARCH_EMPTY_ICONS: Record<SearchActiveTab, LucideIcon> = {
    avatar: PersonStandingIcon,
    group: UsersRoundIcon,
    user: UserIcon,
    world: GlobeIcon
};

export function SearchEmptyState({
    kind,
    searched,
    avatarProviderConfigured = true,
    onClear,
    onConfigureAvatarProvider
}: {
    kind: SearchActiveTab;
    searched: boolean;
    avatarProviderConfigured?: boolean;
    onClear: () => void;
    onConfigureAvatarProvider?: () => void;
}) {
    const { t } = useTranslation();
    const EmptyIcon = searched ? SearchXIcon : SEARCH_EMPTY_ICONS[kind];
    const needsAvatarProvider = kind === 'avatar' && !avatarProviderConfigured;
    let titleKey = `empty_state.search_${kind}_title`;
    let descriptionKey = `empty_state.search_${kind}_description`;
    if (searched) {
        titleKey = 'empty_state.search_no_results';
        descriptionKey = 'empty_state.search_try_another';
    } else if (needsAvatarProvider) {
        descriptionKey = 'empty_state.search_avatar_provider_description';
    }

    return (
        <EmptyState
            variant="panel"
            icon={EmptyIcon}
            title={t(titleKey)}
            description={t(descriptionKey)}
        >
            {searched ? (
                <Button type="button" variant="link" onClick={onClear}>
                    {t('empty_state.clear_search')}
                </Button>
            ) : needsAvatarProvider && onConfigureAvatarProvider ? (
                <Button
                    type="button"
                    variant="link"
                    onClick={onConfigureAvatarProvider}
                >
                    {t('empty_state.set_up_avatar_search')}
                </Button>
            ) : null}
        </EmptyState>
    );
}

export function SearchLoadingState() {
    const { t } = useTranslation();

    return <LoadingState variant="panel" label={t('common.loading')} />;
}

function HotUserCount({
    count,
    className
}: {
    count: number;
    className?: string;
}) {
    const { i18n } = useTranslation();

    return (
        <span
            className={cn(
                'flex items-center gap-1.5 rounded-md bg-black/80 px-2 py-1 text-sm leading-none font-semibold text-white tabular-nums',
                className
            )}
        >
            <span className="size-2 rounded-full bg-[var(--status-online)]" />
            {count.toLocaleString(i18n.language)}
        </span>
    );
}

const HOT_FRIEND_AVATAR_LIMIT = 3;

function HotWorldFriends({ friends }: { friends: readonly FriendRecord[] }) {
    const { t } = useTranslation();
    if (friends.length === 0) {
        return null;
    }
    const shown = friends.slice(0, HOT_FRIEND_AVATAR_LIMIT);
    const hidden = friends.slice(shown.length);

    return (
        <AvatarGroup
            className="-space-x-1.5"
            aria-label={t('view.search.hot.friends_here', {
                count: friends.length
            })}
        >
            {shown.map((friend) => {
                const avatarUrl = userImage(friend, 64);
                return (
                    <Avatar
                        key={friend.id}
                        size="sm"
                        title={friend.displayName}
                    >
                        {avatarUrl ? (
                            <AvatarImage
                                src={avatarUrl}
                                alt=""
                                loading="lazy"
                            />
                        ) : null}
                        <AvatarFallback>
                            <UserIcon className="size-3" />
                        </AvatarFallback>
                    </Avatar>
                );
            })}
            {hidden.length > 0 ? (
                <AvatarGroupCount
                    className="text-xs tabular-nums"
                    title={hidden
                        .map((friend) => friend.displayName)
                        .join(', ')}
                >
                    +{hidden.length}
                </AvatarGroupCount>
            ) : null}
        </AvatarGroup>
    );
}

function SearchMediaCard({
    imageUrl,
    imageAlt,
    title,
    subtitle,
    userCount,
    overlay,
    FallbackIcon,
    onClick
}: {
    imageUrl?: string | null;
    imageAlt: string;
    title?: ReactNode;
    subtitle?: ReactNode;
    userCount?: number;
    overlay?: ReactNode;
    FallbackIcon: LucideIcon;
    onClick: () => void;
}) {
    const fallback = (
        <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-8">
            <FallbackIcon />
        </div>
    );

    return (
        <Button
            type="button"
            variant="outline"
            className="group/search-media h-auto w-full min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden p-0 text-left font-normal whitespace-normal"
            onClick={onClick}
        >
            <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt={imageAlt}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover/search-media:scale-[1.03]"
                        fallback={fallback}
                    />
                ) : (
                    fallback
                )}
                {userCount ? (
                    <HotUserCount
                        count={userCount}
                        className="absolute bottom-2 left-2"
                    />
                ) : null}
                {overlay ? (
                    <div className="absolute right-2 bottom-2">{overlay}</div>
                ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
                <span className="truncate text-sm font-semibold">
                    {title || ''}
                </span>
                <span className="text-muted-foreground min-h-4 truncate text-xs">
                    {subtitle || ''}
                </span>
            </div>
        </Button>
    );
}

function SearchEntityCard({
    imageUrl,
    imageAlt,
    FallbackIcon,
    title,
    titleStyle,
    titleMeta,
    meta,
    description,
    onClick
}: {
    imageUrl?: string | null;
    imageAlt: string;
    FallbackIcon: LucideIcon;
    title?: ReactNode;
    titleStyle?: CSSProperties;
    titleMeta?: ReactNode;
    meta?: ReactNode;
    description?: ReactNode;
    onClick: () => void;
}) {
    return (
        <Button
            type="button"
            variant="outline"
            className="h-auto w-full min-w-0 items-start justify-start gap-3 overflow-hidden p-3 text-left font-normal whitespace-normal"
            onClick={onClick}
        >
            <Avatar className="size-14 rounded-full after:rounded-full">
                {imageUrl ? (
                    <AvatarImage
                        src={imageUrl}
                        alt={imageAlt}
                        loading="lazy"
                        className="rounded-full"
                    />
                ) : null}
                <AvatarFallback className="rounded-full [&>svg]:size-5">
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

function TruncatedBadge({
    children,
    tooltip,
    className
}: {
    children: ReactNode;
    tooltip?: ReactNode;
    className?: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Badge
                        variant="outline"
                        className={cn(
                            'max-w-36 min-w-0 justify-start rounded-sm px-1.5',
                            className
                        )}
                    >
                        <span className="min-w-0 truncate">{children}</span>
                    </Badge>
                }
            />
            <TooltipContent className="max-w-72 break-words">
                {tooltip || children}
            </TooltipContent>
        </Tooltip>
    );
}

function UserLanguageBadges({
    user,
    languages
}: {
    user: UserProfileRecord;
    languages: LanguageOption[];
}) {
    const visibleLanguages = languages.slice(0, 2);
    const hiddenLanguages = languages.slice(visibleLanguages.length);
    const hiddenLabel = hiddenLanguages.map(languageOptionLabel).join(', ');

    return (
        <>
            {visibleLanguages.map((language) => {
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

export function AvatarCard({ avatar }: { avatar: AvatarProfileRecord }) {
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

function openWorld(world: WorldProfileRecord) {
    openWorldDialog({
        worldId: world.id,
        title: world.name || undefined,
        seedData: world
    });
}

export function WorldCard({
    world,
    userCount = Number(world.occupants) || 0,
    subtitle = world.authorName || '',
    overlay
}: {
    world: WorldProfileRecord;
    userCount?: number;
    subtitle?: ReactNode;
    overlay?: ReactNode;
}) {
    return (
        <SearchMediaCard
            imageUrl={world.thumbnailImageUrl}
            imageAlt={world.name || 'World'}
            title={world.name || ''}
            subtitle={subtitle}
            userCount={userCount}
            overlay={overlay}
            FallbackIcon={GlobeIcon}
            onClick={() => openWorld(world)}
        />
    );
}

function HotWorldSubtitle({
    entry,
    recentFriendCount
}: {
    entry: SearchHotWorld;
    recentFriendCount: number;
}) {
    const { t } = useTranslation();

    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
                {[
                    entry.world.authorName,
                    t('view.search.hot.rooms', { count: entry.instanceCount })
                ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
            {recentFriendCount > 0 ? (
                <span
                    className="max-w-[60%] shrink-0 truncate tabular-nums"
                    title={t('view.search.hot.friends_visited', {
                        count: recentFriendCount
                    })}
                >
                    {t('view.search.hot.friends_visited_short', {
                        count: recentFriendCount
                    })}
                </span>
            ) : null}
        </span>
    );
}

export function HotWorldCard({
    entry,
    friends,
    recentFriendCount
}: {
    entry: SearchHotWorld;
    friends: readonly FriendRecord[];
    recentFriendCount: number;
}) {
    return (
        <WorldCard
            world={entry.world}
            userCount={entry.userCount}
            subtitle={
                <HotWorldSubtitle
                    entry={entry}
                    recentFriendCount={recentFriendCount}
                />
            }
            overlay={<HotWorldFriends friends={friends} />}
        />
    );
}

export function HotWorldHero({
    entry,
    friends,
    recentFriendCount
}: {
    entry: SearchHotWorld;
    friends: readonly FriendRecord[];
    recentFriendCount: number;
}) {
    const { world } = entry;
    const imageUrl = world.imageUrl || world.thumbnailImageUrl;
    const fallback = (
        <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-10">
            <GlobeIcon />
        </div>
    );

    return (
        <Button
            type="button"
            variant="outline"
            className="group/search-media relative aspect-[21/9] h-auto max-h-80 w-full min-w-0 items-stretch justify-start overflow-hidden p-0 text-left font-normal whitespace-normal"
            onClick={() => openWorld(world)}
        >
            <div className="bg-muted absolute inset-0">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt={world.name || 'World'}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover/search-media:scale-[1.02]"
                        fallback={fallback}
                    />
                ) : (
                    fallback
                )}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pt-16 text-white">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-xl font-semibold">
                        {world.name || ''}
                    </span>
                    <span className="text-sm text-white/75">
                        <HotWorldSubtitle
                            entry={entry}
                            recentFriendCount={recentFriendCount}
                        />
                    </span>
                    {world.description ? (
                        <span className="line-clamp-2 text-xs leading-snug break-words text-white/70">
                            {world.description}
                        </span>
                    ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                    <HotWorldFriends friends={friends} />
                    <HotUserCount count={entry.userCount} />
                </div>
            </div>
        </Button>
    );
}

export function UserRow({
    user,
    randomUserColours,
    randomUserColourStyle,
    isDarkMode,
    languageOptionsMap
}: {
    user: UserProfileRecord;
    randomUserColours: boolean;
    randomUserColourStyle: UserNameColourStyle;
    isDarkMode: boolean;
    languageOptionsMap: ReadonlyMap<string, LanguageOption>;
}) {
    const imageUrl = userImage(user);
    const languages = normalizeProfileLanguageRows(user, languageOptionsMap);
    const trustStyle =
        randomUserColours && user?.id
            ? {
                  color: getNameColour(
                      user.id,
                      isDarkMode,
                      randomUserColourStyle
                  )
              }
            : user?.$userColour
              ? { color: user.$userColour }
              : undefined;

    return (
        <SearchEntityCard
            imageUrl={imageUrl}
            imageAlt={user.displayName || user.id || 'User'}
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
            description={replaceBioSymbols(user.bio)}
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

export function GroupRow({ group }: { group: SearchGroupJson }) {
    return (
        <GroupCard
            group={group}
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
