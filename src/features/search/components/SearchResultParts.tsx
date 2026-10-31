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
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

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

const searchMediaTextStyle: CSSProperties = {
    textShadow: '0 1px 2px rgb(0 0 0 / 0.9), 0 0 10px rgb(0 0 0 / 0.65)'
};

function SearchMediaCard({
    imageUrl,
    imageAlt,
    title,
    subtitle,
    FallbackIcon,
    onClick
}: {
    imageUrl?: string | null;
    imageAlt: string;
    title?: ReactNode;
    subtitle?: ReactNode;
    FallbackIcon: LucideIcon;
    onClick: () => void;
}) {
    return (
        <Button
            type="button"
            variant="outline"
            className="group/search-media h-auto w-full min-w-0 flex-col items-stretch justify-start overflow-hidden p-0 text-left font-normal whitespace-normal"
            onClick={onClick}
        >
            <div className="bg-muted relative aspect-[16/10] w-full overflow-hidden">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt={imageAlt}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        fallback={
                            <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-8">
                                <FallbackIcon />
                            </div>
                        }
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

export function WorldCard({ world }: { world: WorldProfileRecord }) {
    const occupants = Number(world.occupants) || 0;
    const subtitle = occupants
        ? `${world.authorName || ''} (${occupants})`
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
