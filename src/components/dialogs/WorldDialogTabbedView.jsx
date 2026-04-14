import { useEffect, useState } from 'react';
import {
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    FlagIcon,
    GlobeIcon,
    HeartIcon,
    HomeIcon,
    ImageIcon,
    LineChartIcon,
    LoaderCircleIcon,
    MessageSquareIcon,
    MonitorIcon,
    PencilIcon,
    PlayIcon,
    RefreshCwIcon,
    Share2Icon,
    SmartphoneIcon,
    Trash2Icon,
    UploadIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl, copyTextToClipboard, openExternalLink, userImage } from '@/lib/entityMedia.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { instanceRepository, playerListRepository, userProfileRepository } from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/location.js';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityBlank,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { PreviousInstancesTableDialog } from './PreviousInstancesTableDialog.jsx';

function Section({ label, value, mono = false, children }) {
    return (
        <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
            {children || <div className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>{value || '—'}</div>}
        </div>
    );
}

function PlatformBadge({ name, fileSize = '' }) {
    const normalized = String(name || '').toLowerCase();
    const Icon = normalized === 'pc' ? MonitorIcon : normalized === 'quest' ? SmartphoneIcon : null;
    return (
        <Badge variant="outline">
            {Icon ? <Icon className="mr-1 size-3.5" /> : null}
            {name}
            {fileSize ? <span className="ml-1 border-l pl-1">{fileSize}</span> : null}
        </Badge>
    );
}

function fileAnalysisSizeForPlatform(fileAnalysis, platform) {
    if (platform === 'PC') {
        return fileAnalysis?.standalonewindows?._fileSize || '';
    }
    if (platform === 'Quest' || platform === 'Android') {
        return fileAnalysis?.android?._fileSize || '';
    }
    if (platform === 'iOS') {
        return fileAnalysis?.ios?._fileSize || '';
    }
    return '';
}

function firstText(...values) {
    for (const value of values) {
        const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function normalizeInstanceUser(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        const userId = value.trim();
        return userId ? { id: userId, userId, displayName: userId } : null;
    }
    if (typeof value !== 'object') {
        return null;
    }
    const userId = firstText(value.id, value.userId, value.user_id, value.targetUserId, value.target_user_id);
    const displayName = firstText(value.displayName, value.display_name, value.username, value.name, userId);
    return {
        ...value,
        id: userId || value.id,
        userId: value.userId || userId,
        displayName
    };
}

function normalizeInstanceUsers(...sources) {
    const rows = [];
    const push = (value) => {
        if (!value) {
            return;
        }
        if (value instanceof Map) {
            for (const entry of value.values()) {
                push(entry);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                push(entry);
            }
            return;
        }
        if (typeof value === 'object' && !value.id && !value.userId && !value.user_id && !value.targetUserId && !value.target_user_id && !value.displayName && !value.display_name && !value.username && !value.name) {
            for (const entry of Object.values(value)) {
                push(entry);
            }
            return;
        }
        const row = normalizeInstanceUser(value);
        if (row) {
            rows.push(row);
        }
    };

    for (const source of sources) {
        push(source);
    }
    return rows;
}

function resolveInstanceRows(world) {
    if (!Array.isArray(world?.instances)) {
        return [];
    }

    return world.instances
        .map((entry) => {
            if (Array.isArray(entry)) {
                return {
                    id: String(entry[0] || '').trim(),
                    occupants: entry[1]
                };
            }
            if (entry && typeof entry === 'object') {
                return {
                    ...entry,
                    id: String(entry.id || entry.instanceId || '').trim(),
                    occupants: entry.occupants,
                    location: entry.location || entry.tag || (entry.id ? `${world.id}:${entry.id}` : ''),
                    users: normalizeInstanceUsers(
                        entry.users,
                        entry.players,
                        entry.playerList,
                        entry.userList,
                        entry.userIds,
                        entry.usersById,
                        entry.ref?.users,
                        entry.ref?.players
                    ),
                    creatorUserId: firstText(
                        entry.$location?.userId,
                        entry.$location?.user_id,
                        entry.$location?.ownerUserId,
                        entry.$location?.owner_user_id,
                        entry.$location?.ownerId,
                        entry.$location?.owner_id,
                        entry.$location?.creatorUserId,
                        entry.$location?.creator_user_id,
                        entry.ownerUserId,
                        entry.owner_user_id,
                        entry.userId,
                        entry.user_id,
                        entry.ownerId,
                        entry.owner_id,
                        entry.creatorUserId,
                        entry.creator_user_id,
                        entry.creatorId,
                        entry.creator_id,
                        entry.instanceOwnerId,
                        entry.instance_owner_id,
                        entry.ownerUser?.id,
                        entry.ownerUser?.userId,
                        entry.owner?.id,
                        entry.owner?.userId,
                        entry.creatorUser?.id,
                        entry.creatorUser?.userId,
                        entry.user?.id,
                        entry.user?.userId
                    ),
                    creatorUser: entry.$location?.ownerUser ||
                        entry.$location?.owner ||
                        entry.$location?.creatorUser ||
                        entry.$location?.user ||
                        entry.creatorUser ||
                        entry.creator_user ||
                        entry.ownerUser ||
                        entry.owner ||
                        entry.user ||
                        null
                };
            }
            return {
                id: String(entry || '').trim(),
                occupants: '',
                location: world?.id ? `${world.id}:${String(entry || '').trim()}` : String(entry || '').trim(),
                users: []
            };
        })
        .filter((entry) => entry.id);
}

function resolveLaunchLocation(world, instance) {
    if (typeof instance?.location === 'string' && instance.location.trim()) {
        return instance.location.trim();
    }
    const instanceId = String(instance?.id || instance?.instanceId || '').trim();
    if (instanceId.includes(':')) {
        return instanceId;
    }
    return world?.id && instanceId ? `${world.id}:${instanceId}` : '';
}

function sameInstanceLocation(world, instance, location) {
    const normalizedLocation = firstText(location);
    if (!normalizedLocation) {
        return false;
    }
    return sameLocationTag(resolveLaunchLocation(world, instance), normalizedLocation) ||
        sameLocationTag(firstText(instance?.location, instance?.tag), normalizedLocation);
}

function sameLocationTag(left, right) {
    const leftLocation = firstText(left);
    const rightLocation = firstText(right);
    if (!leftLocation || !rightLocation) {
        return false;
    }
    if (leftLocation === rightLocation) {
        return true;
    }
    const leftParsed = parseLocation(leftLocation);
    const rightParsed = parseLocation(rightLocation);
    return Boolean(
        leftParsed.worldId &&
            rightParsed.worldId &&
            leftParsed.worldId === rightParsed.worldId &&
            leftParsed.instanceId &&
            rightParsed.instanceId &&
            leftParsed.instanceId === rightParsed.instanceId
    );
}

function timestampFromValue(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    const text = firstText(value);
    if (!text) {
        return 0;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function instanceUserTravelingTimestamp(user) {
    if (firstText(user?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    return timestampFromValue(user?.$travelingToTime) ||
        timestampFromValue(user?.travelingToTime) ||
        timestampFromValue(user?.traveling_to_time);
}

function instanceUserSubtitle(user) {
    if (user?.$subtitle) {
        return user.$subtitle;
    }
    if (instanceUserTravelingTimestamp(user)) {
        return '';
    }
    const timestamp =
        timestampFromValue(user?.$location_at) ||
        timestampFromValue(user?.locationAt) ||
        timestampFromValue(user?.location_at) ||
        timestampFromValue(user?.joinedAt) ||
        timestampFromValue(user?.joined_at) ||
        timestampFromValue(user?.created_at) ||
        timestampFromValue(user?.createdAt);
    if (timestamp) {
        return timeToText(Date.now() - timestamp);
    }
    return firstText(user?.subtitle, user?.statusDescription, user?.status, user?.stateBucket, user?.state);
}

function InstanceUserTiles({ instance }) {
    const userMap = new Map();
    const pushUser = (user) => {
        const row = normalizeInstanceUser(user);
        if (!row) {
            return;
        }
        const key = firstText(row.id, row.userId, row.displayName);
        if (!key || userMap.has(key)) {
            return;
        }
        userMap.set(key, row);
    };

    if (instance?.creatorUserId) {
        pushUser({
            ...(instance.creatorUser || {}),
            id: instance.creatorUserId,
            userId: instance.creatorUser?.userId || instance.creatorUserId,
            displayName: firstText(instance.creatorUser?.displayName, instance.creatorUser?.username, instance.creatorUser?.name, instance.creatorUserId),
            $subtitle: 'Instance creator'
        });
    }
    for (const user of normalizeInstanceUsers(instance?.users, instance?.players, instance?.playerList, instance?.userList, instance?.userIds, instance?.usersById)) {
        pushUser(user);
    }
    const users = Array.from(userMap.values());
    if (!users.length) {
        return null;
    }
    return (
        <div className="mt-2 flex flex-wrap items-start">
            {users.map((user, index) => {
                const userId = firstText(user?.id, user?.userId, user?.user_id, user?.targetUserId, user?.target_user_id);
                const image = userImage(user, true);
                const dotClassName = userStatusDotClassName(user);
                const displayName = firstText(user?.displayName, user?.display_name, user?.username, user?.name, userId, 'User');
                const subtitle = instanceUserSubtitle(user);
                const travelingTimestamp = instanceUserTravelingTimestamp(user);
                return (
                    <button
                        key={`${userId || displayName || 'user'}:${index}`}
                        type="button"
                        className="box-border flex w-[167px] cursor-pointer items-center p-1.5 text-left text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50"
                        onClick={() => userId && openUserDialog({ userId, title: displayName || undefined, seedData: user })}>
                        <span className="relative mr-2.5 size-9 shrink-0">
                            {image ? (
                                <img src={image} alt="" className="size-9 rounded-full object-cover" />
                            ) : (
                                <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                                    <UserIcon className="size-4 text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? <span className={`absolute bottom-0 right-0 z-10 size-2.5 rounded-full border border-background ${dotClassName}`} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate font-medium leading-[18px]" style={user?.$userColour ? { color: user.$userColour } : undefined}>{displayName}</span>
                            {travelingTimestamp ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                    <LoaderCircleIcon className="mr-1 inline-block size-3 animate-spin" />
                                    {timeToText(Date.now() - travelingTimestamp)}
                                </span>
                            ) : subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function formatDate(value) {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

let lastWorldDialogTab = 'instances';

function resolveWorldDialogTab(tabs, preferred, fallback = 'instances') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

function authorWorldTags(tags = []) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .filter((tag) => String(tag).startsWith('author_tag_'))
        .map((tag) => String(tag).replace(/^author_tag_/, ''))
        .filter(Boolean);
}

const visibleWorldFeatureTags = [
    ['feature_avatar_scaling_disabled', 'dialog.world.tags.avatar_scaling_disabled', 'Avatar scaling disabled'],
    ['feature_focus_view_disabled', 'dialog.world.tags.focus_view_disabled', 'Focus view disabled'],
    ['feature_emoji_disabled', 'dialog.world.tags.emoji_disabled', 'Emoji disabled'],
    ['feature_stickers_disabled', 'dialog.world.tags.stickers_disabled', 'Stickers disabled'],
    ['feature_pedestals_disabled', 'dialog.world.tags.pedestals_disabled', 'Pedestals disabled'],
    ['feature_prints_disabled', 'dialog.world.tags.prints_disabled', 'Prints disabled'],
    ['feature_drones_disabled', 'dialog.world.tags.drones_disabled', 'Drones disabled'],
    ['feature_props_disabled', 'dialog.world.tags.props_disabled', 'Items disabled'],
    ['feature_third_person_view_disabled', 'dialog.world.tags.third_person_view_disabled', 'Third person disabled']
];

function visibleWorldTags(world, t) {
    const tags = Array.isArray(world?.tags) ? world.tags : [];
    const entries = [];
    const seen = new Set();
    const pushTag = (key, label) => {
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        entries.push({ key, label: label || key });
    };

    for (const [tag, localeKey, fallbackLabel] of visibleWorldFeatureTags) {
        if (!tags.includes(tag)) {
            continue;
        }
        const localized = t(localeKey);
        pushTag(tag, localized === localeKey ? fallbackLabel : localized);
    }

    if (tags.includes('debug_allowed')) {
        pushTag('debug_allowed', 'Debug allowed');
    }
    if (world?.unityPackageUrl || world?.unityPackage?.url) {
        pushTag('future_proofing', t('dialog.world.tags.future_proofing'));
    }
    for (const tag of tags) {
        if (String(tag).startsWith('content_')) {
            const localeKey = `dialog.world.tags.${tag}`;
            const localized = t(localeKey);
            pushTag(tag, localized === localeKey ? String(tag).replace(/^content_/, '') : localized);
        }
    }

    return entries;
}

export function WorldDialogTabbedView({
    world,
    memo,
    detail,
    imageUrl,
    actionStatus,
    normalizedWorldId,
    isInstanceLocation,
    worldDialogShortName = '',
    isHomeWorld,
    canUpdateHome,
    canManageWorld,
    onRefresh,
    onLaunch,
    onHome,
    onRename,
    onChangeDescription,
    onChangeCapacity,
    onChangeRecommendedCapacity,
    onChangePreview,
    onChangeTags,
    onChangeAllowedDomains,
    onChangeImage,
    onNewInstance,
    onNewInstanceSelfInvite,
    onPublication,
    onSaveMemo,
    onOpenCache,
    onDeleteCache,
    onDeletePersistentData,
    onDelete,
    previousInstances = [],
    onPreviousInstancesChange,
    hasPersistData = false
}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentGameLocation = useRuntimeStore((state) => state.gameState.currentLocation);
    const currentGameDestination = useRuntimeStore((state) => state.gameState.currentDestination);
    const [activeTab, setActiveTab] = useState(() => lastWorldDialogTab);
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [currentInstanceDetails, setCurrentInstanceDetails] = useState({
        location: '',
        instance: null,
        ownerUser: null,
        playerSnapshot: null
    });
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const instanceRows = resolveInstanceRows(world);
    const parsedCurrentInstanceLocation = isInstanceLocation ? parseLocation(normalizedWorldId) : null;
    const currentResolvedLocation = currentGameLocation === 'traveling'
        ? currentGameDestination
        : currentGameLocation;
    const currentInstanceDetailsForLocation = sameLocationTag(currentInstanceDetails.location, normalizedWorldId)
        ? currentInstanceDetails
        : { instance: null, ownerUser: null, playerSnapshot: null };
    const currentInstanceRow = parsedCurrentInstanceLocation?.worldId && parsedCurrentInstanceLocation?.instanceId
        ? {
            id: parsedCurrentInstanceLocation.instanceId,
            location: normalizedWorldId,
            shortName: parsedCurrentInstanceLocation.shortName || worldDialogShortName,
            occupants: currentInstanceDetailsForLocation.instance?.userCount ??
                currentInstanceDetailsForLocation.instance?.occupants ??
                currentInstanceDetailsForLocation.playerSnapshot?.context?.playerCount,
            playerCount: currentInstanceDetailsForLocation.instance?.userCount ??
                currentInstanceDetailsForLocation.instance?.occupants ??
                currentInstanceDetailsForLocation.playerSnapshot?.context?.playerCount,
            capacity: currentInstanceDetailsForLocation.instance?.capacity ??
                currentInstanceDetailsForLocation.instance?.world?.capacity ??
                world.capacity,
            users: normalizeInstanceUsers(
                currentInstanceDetailsForLocation.instance?.users,
                currentInstanceDetailsForLocation.instance?.players,
                currentInstanceDetailsForLocation.instance?.playerList,
                currentInstanceDetailsForLocation.instance?.userList,
                currentInstanceDetailsForLocation.instance?.userIds,
                currentInstanceDetailsForLocation.instance?.usersById,
                currentInstanceDetailsForLocation.playerSnapshot?.players
            ),
            ref: currentInstanceDetailsForLocation.instance || null,
            creatorUserId: firstText(
                parsedCurrentInstanceLocation.userId,
                currentInstanceDetailsForLocation.instance?.ownerId,
                currentInstanceDetailsForLocation.instance?.owner_id,
                currentInstanceDetailsForLocation.instance?.ownerUserId,
                currentInstanceDetailsForLocation.instance?.owner_user_id,
                currentInstanceDetailsForLocation.instance?.userId,
                currentInstanceDetailsForLocation.instance?.user_id,
                currentInstanceDetailsForLocation.instance?.creatorUserId,
                currentInstanceDetailsForLocation.instance?.creator_user_id,
                currentInstanceDetailsForLocation.instance?.ownerUser?.id,
                currentInstanceDetailsForLocation.instance?.ownerUser?.userId,
                currentInstanceDetailsForLocation.instance?.owner?.id,
                currentInstanceDetailsForLocation.instance?.owner?.userId,
                currentInstanceDetailsForLocation.instance?.creatorUser?.id,
                currentInstanceDetailsForLocation.instance?.creatorUser?.userId,
                currentInstanceDetailsForLocation.instance?.user?.id,
                currentInstanceDetailsForLocation.instance?.user?.userId
            ),
            creatorUser: currentInstanceDetailsForLocation.ownerUser ||
                currentInstanceDetailsForLocation.instance?.ownerUser ||
                currentInstanceDetailsForLocation.instance?.owner ||
                currentInstanceDetailsForLocation.instance?.creatorUser ||
                currentInstanceDetailsForLocation.instance?.user ||
                null
        }
        : null;
    const hasLiveCurrentInstanceDetails = Boolean(
        currentInstanceDetailsForLocation.instance ||
            currentInstanceDetailsForLocation.playerSnapshot ||
            currentInstanceDetailsForLocation.ownerUser
    );
    const displayInstanceRows = currentInstanceRow && hasLiveCurrentInstanceDetails
        ? instanceRows.some((instance) => sameInstanceLocation(world, instance, normalizedWorldId))
            ? instanceRows.map((instance) => sameInstanceLocation(world, instance, normalizedWorldId)
                ? {
                    ...instance,
                    ...currentInstanceRow,
                    shortName: firstText(currentInstanceRow.shortName, instance.shortName),
                    occupants: currentInstanceRow.occupants ?? instance.occupants,
                    playerCount: currentInstanceRow.playerCount ?? instance.playerCount ?? instance.occupants,
                    capacity: currentInstanceRow.capacity ?? instance.capacity,
                    users: currentInstanceRow.users.length ? currentInstanceRow.users : instance.users,
                    ref: currentInstanceRow.ref ?? instance.ref,
                    creatorUserId: firstText(currentInstanceRow.creatorUserId, instance.creatorUserId),
                    creatorUser: currentInstanceRow.creatorUser || instance.creatorUser
                }
                : instance)
            : [currentInstanceRow, ...instanceRows]
        : instanceRows;
    const tabs = [
        { value: 'instances', label: 'Instances' },
        { value: 'info', label: 'Info' },
        { value: 'json', label: 'JSON' }
    ];

    function changeTab(tab) {
        lastWorldDialogTab = resolveWorldDialogTab(tabs, tab);
        setActiveTab(lastWorldDialogTab);
    }

    useEffect(() => {
        if (!isInstanceLocation) {
            setCurrentInstanceDetails({
                location: '',
                instance: null,
                ownerUser: null,
                playerSnapshot: null
            });
            return undefined;
        }

        const parsedLocation = parseLocation(normalizedWorldId);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            setCurrentInstanceDetails({
                location: normalizedWorldId,
                instance: null,
                ownerUser: null,
                playerSnapshot: null
            });
            return undefined;
        }

        let active = true;
        const isCurrentLiveInstance = sameLocationTag(currentResolvedLocation, normalizedWorldId);
        Promise.all([
            instanceRepository.getInstance({
                worldId: parsedLocation.worldId,
                instanceId: parsedLocation.instanceId,
                endpoint: currentEndpoint
            }).then((response) => response.json).catch(() => null),
            isCurrentLiveInstance
                ? playerListRepository.getCurrentInstanceSnapshot({
                    currentUserId,
                    currentLocation: normalizedWorldId
                }).catch(() => null)
                : Promise.resolve(null)
        ])
            .then(async ([instance, playerSnapshot]) => {
                const ownerUserId = firstText(
                    parsedLocation.userId,
                    instance?.ownerUserId,
                    instance?.owner_user_id,
                    instance?.ownerId,
                    instance?.owner_id,
                    instance?.userId,
                    instance?.user_id,
                    instance?.creatorUserId,
                    instance?.creator_user_id,
                    instance?.ownerUser?.id,
                    instance?.ownerUser?.userId,
                    instance?.owner?.id,
                    instance?.owner?.userId,
                    instance?.creatorUser?.id,
                    instance?.creatorUser?.userId,
                    instance?.user?.id,
                    instance?.user?.userId
                );
                const ownerUserSeed = instance?.ownerUser || instance?.owner || instance?.creatorUser || instance?.user || null;
                const ownerUser = ownerUserSeed
                    ? ownerUserSeed
                    : ownerUserId
                        ? await userProfileRepository.getUserProfile({
                            userId: ownerUserId,
                            endpoint: currentEndpoint
                        }).catch(() => ({ id: ownerUserId, userId: ownerUserId, displayName: ownerUserId }))
                    : null;

                if (!active) {
                    return;
                }
                setCurrentInstanceDetails({
                    location: normalizedWorldId,
                    instance,
                    ownerUser,
                    playerSnapshot
                });
            })
            .catch(() => {
                if (active) {
                    setCurrentInstanceDetails({
                        location: normalizedWorldId,
                        instance: null,
                        ownerUser: null,
                        playerSnapshot: null
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentResolvedLocation, currentUserId, isInstanceLocation, normalizedWorldId]);

    const worldUrl = world.id ? `https://vrchat.com/home/world/${world.id}` : '';
    const packageUrl = replaceVrcPackageUrl(world.unityPackageUrl || world.unityPackage?.url || '');
    const isPublished = Array.isArray(world.tags) && (world.tags.includes('system_approved') || world.tags.includes('system_labs'));
    const authorTags = authorWorldTags(world.tags);
    const visibleTags = visibleWorldTags(world, t);
    const platformRows = Array.isArray(world.platforms) ? world.platforms : [];
    const previewUrl = world.previewYoutubeId ? `https://www.youtube.com/watch?v=${world.previewYoutubeId}` : '';
    const lastVisitedInstance = previousInstances[0];
    const totalVisitTime = previousInstances.reduce((total, instance) => total + (Number(instance?.time) || 0), 0);
    const favoriteRate = Number(world.visits) > 0 && Number(world.favorites) > 0
        ? Math.round((Number(world.favorites) / Number(world.visits)) * 100)
        : 0;

    async function copyWorldText(text, label) {
        await copyTextToClipboard(text);
        toast.success(`${label} copied.`);
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={world.name || world.id || 'World'}
                imagePlaceholder={<GlobeIcon className="size-8 text-muted-foreground" />}
                onImageClick={imageUrl ? () => openImagePreview({ url: convertFileUrlToImageUrl(world.imageUrl || imageUrl, 1024), title: world.name || 'World' }) : null}
                titlePrefix={isHomeWorld ? <HomeIcon className="size-5 shrink-0" /> : null}
                title={world.name || 'World'}
                onTitleClick={world.name ? () => void copyWorldText(world.name, 'World name') : undefined}
                subtitle={world.authorName || ''}
                onSubtitleClick={world.authorId ? () => openUserDialog({ userId: world.authorId, title: world.authorName || undefined }) : undefined}
                description={world.description}
                detail={detail}
                badges={
                    <>
                        <Badge variant={world.releaseStatus === 'public' ? 'default' : 'outline'}>{world.isLabs ? 'Labs' : world.releaseStatus || 'Unknown'}</Badge>
                        {world.capacity > 0 ? <Badge variant="outline"><UsersIcon className="mr-1 size-3.5" />Capacity {world.capacity}</Badge> : null}
                        {world.occupants > 0 ? <Badge variant="outline"><UsersIcon className="mr-1 size-3.5" />Occupants {world.occupants}</Badge> : null}
                        {world.favorites > 0 ? <Badge variant="outline"><HeartIcon className="mr-1 size-3.5" />Favorites {world.favorites}</Badge> : null}
                        {world.$isCached ? (
                            <button type="button" onClick={onOpenCache}>
                                <Badge variant="outline">{world.$cacheSize ? `${world.$cacheSize} Cache` : 'Local cache'}</Badge>
                            </button>
                        ) : null}
                        {platformRows.map((platform) => (
                            <PlatformBadge
                                key={platform}
                                name={platform}
                                fileSize={fileAnalysisSizeForPlatform(world.fileAnalysis, platform)}
                            />
                        ))}
                        {visibleTags.map((tag) => (
                            <Badge key={tag.key} variant="outline">{tag.label}</Badge>
                        ))}
                    </>
                }
                actions={
                    <>
                        {world.$isCached ? (
                            <Button type="button" size="icon-lg" variant="outline" className="rounded-full" disabled={actionStatus === 'cache'} onClick={onDeleteCache}>
                                <Trash2Icon className="size-4" />
                            </Button>
                        ) : null}
                        <FavoriteActionMenu kind="world" entityId={world.id} entity={world} />
                        <EntityActionDropdown busy={actionStatus !== 'idle'}>
                            <EntityActionItem icon={RefreshCwIcon} disabled={actionStatus === 'refresh'} onSelect={onRefresh}>Refresh</EntityActionItem>
                            {worldUrl ? (
                                <>
                                    <EntityActionItem icon={Share2Icon} onSelect={() => void copyWorldText(worldUrl, 'World URL')}>Share / Copy URL</EntityActionItem>
                                    <EntityActionItem icon={ExternalLinkIcon} onSelect={() => openExternalLink(worldUrl)}>Open VRChat Page</EntityActionItem>
                                    <EntityActionItem icon={CopyIcon} onSelect={() => void copyWorldText(world.id, 'World ID')}>Copy World ID</EntityActionItem>
                                </>
                            ) : null}
                            {isInstanceLocation ? <EntityActionItem icon={PlayIcon} disabled={actionStatus === 'launching'} onSelect={onLaunch}>Launch Instance</EntityActionItem> : null}
                            <EntityActionSeparator />
                            <EntityActionItem icon={FlagIcon} disabled={actionStatus === 'new-instance'} onSelect={onNewInstance}>New Instance</EntityActionItem>
                            <EntityActionItem icon={MessageSquareIcon} disabled={actionStatus === 'new-instance'} onSelect={onNewInstanceSelfInvite}>New Instance and Self Invite</EntityActionItem>
                            <EntityActionItem icon={HomeIcon} disabled={!canUpdateHome || actionStatus === 'home'} onSelect={onHome}>{isHomeWorld ? 'Reset Home' : 'Make Home'}</EntityActionItem>
                            <EntityActionItem icon={LineChartIcon} disabled={!previousInstances.length} onSelect={() => setPreviousInstancesOpen(true)}>Previous Instances</EntityActionItem>
                            <EntityActionItem icon={UploadIcon} disabled={!hasPersistData || actionStatus === 'persistent-data'} onSelect={onDeletePersistentData}>Delete Persistent Data</EntityActionItem>
                            <EntityActionSeparator />
                            {canManageWorld ? (
                                <>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onRename}>Rename</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangeDescription}>Change Description</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangeCapacity}>Change Capacity</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangeRecommendedCapacity}>Change Recommended Capacity</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangePreview}>Change YouTube Preview</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangeTags}>Change Tags</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'save-world'} onSelect={onChangeAllowedDomains}>Change Allowed Domains</EntityActionItem>
                                    <EntityActionItem icon={ImageIcon} disabled={actionStatus === 'image-upload'} onSelect={onChangeImage}>Change Image</EntityActionItem>
                                    {packageUrl ? <EntityActionItem icon={DownloadIcon} onSelect={() => openExternalLink(packageUrl)}>Download Unity Package</EntityActionItem> : null}
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={EyeIcon} disabled={actionStatus === 'publish-world'} onSelect={() => onPublication(!isPublished)}>
                                        {isPublished ? 'Unpublish' : 'Publish to Labs'}
                                    </EntityActionItem>
                                    <EntityActionItem icon={Trash2Icon} destructive disabled={actionStatus === 'delete'} onSelect={onDelete}>Delete</EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs value={activeTab} onValueChange={changeTab} tabs={tabs}>
                <EntityDialogTabContent value="instances" className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="inline-flex items-center gap-1"><UserIcon className="size-4" />Public {world.publicOccupants ?? 0}</span>
                        <span className="inline-flex items-center gap-1"><UserIcon className="size-4" />Private {world.privateOccupants ?? 0}</span>
                        <span className="inline-flex items-center gap-1"><UsersIcon className="size-4" />Capacity {world.recommendedCapacity || '—'} / {world.capacity || '—'}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        {isInstanceLocation ? (
                            <Section label="Location">
                                <LocationWorld
                                    locationObject={normalizedWorldId}
                                    currentUserId={currentUserId}
                                    worldDialogShortName={worldDialogShortName}
                                    instanceOwner={currentInstanceRow?.creatorUserId || ''}
                                    instanceOwnerName={firstText(
                                        currentInstanceRow?.creatorUser?.displayName,
                                        currentInstanceRow?.creatorUser?.username,
                                        currentInstanceRow?.creatorUser?.name
                                    )}
                                    playerCount={currentInstanceRow?.playerCount ?? undefined}
                                    capacity={currentInstanceDetailsForLocation.instance?.capacity ?? undefined}
                                />
                            </Section>
                        ) : null}
                        <Section label="World ID" value={world.id} mono />
                        <Section label="Capacity" value={world.capacity ? String(world.capacity) : '—'} />
                        <Section label="Occupants" value={world.occupants ? String(world.occupants) : '—'} />
                    </div>
                    <div className="space-y-2">
                        {isInstanceLocation ? (
                            <Button type="button" disabled={actionStatus === 'launching'} onClick={onLaunch}>
                                <PlayIcon className="size-4" />
                                Launch Current Instance
                            </Button>
                        ) : null}
                        {displayInstanceRows.length ? (
                            displayInstanceRows.map((instance) => {
                                const location = resolveLaunchLocation(world, instance);
                                const shortName = instance.shortName || '';
                                const launchToken = instance.shortName || instance.secureName || '';
                                return (
                                    <div key={instance.id} className="rounded-md border px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <LocationWorld
                                                locationObject={{
                                                    ...(instance.ref || {}),
                                                    ...instance,
                                                    tag: location,
                                                    location,
                                                    shortName,
                                                    launchToken
                                                }}
                                                currentUserId={currentUserId}
                                                worldDialogShortName={worldDialogShortName}
                                                grouphint={instance.groupName || instance.group?.name || ''}
                                                instanceOwner={instance.creatorUserId || ''}
                                                instanceOwnerName={firstText(
                                                    instance.creatorUser?.displayName,
                                                    instance.creatorUser?.username,
                                                    instance.creatorUser?.name
                                                )}
                                                playerCount={instance.playerCount ?? instance.userCount ?? instance.occupants}
                                                capacity={instance.capacity ?? instance.ref?.capacity ?? undefined}
                                            />
                                            <InstanceActionBar
                                                location={location}
                                                launchLocation={location}
                                                inviteLocation={location}
                                                instanceLocation={location}
                                                shortName={launchToken}
                                                instance={instance}
                                                friendCount={Number(instance.friendCount) || undefined}
                                                playerCount={instance.playerCount ?? instance.userCount ?? instance.occupants}
                                                showHistory={Boolean(previousInstances.length)}
                                                historyTooltip="Previous instance history"
                                                onHistory={() => setPreviousInstancesOpen(true)}
                                            />
                                        </div>
                                        <InstanceUserTiles instance={instance} />
                                    </div>
                                );
                            })
                        ) : !isInstanceLocation ? <EntityBlank /> : null}
                    </div>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="info">
                    <EntityInfoGrid>
                        <EntityMemoTextarea label="Memo" value={memo} placeholder="Memo" onSave={onSaveMemo} />
                        <EntityInfoBlock label="World ID" value={world.id} mono full />
                        {previewUrl ? (
                            <EntityInfoBlock label="YouTube Preview" wide onClick={() => openExternalLink(previewUrl)}>
                                <span className="block truncate text-xs">{previewUrl}</span>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label="Author" onClick={world.authorId ? () => openUserDialog({ userId: world.authorId, title: world.authorName || undefined }) : undefined}>
                            <span className="block truncate text-xs">{world.authorName || '—'}</span>
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Players" value={world.occupants ? String(world.occupants) : '—'} />
                        <EntityInfoBlock label="Favorites" value={world.favorites ? `${world.favorites}${favoriteRate ? ` (${favoriteRate}%)` : ''}` : '—'} />
                        <EntityInfoBlock label="Visits" value={world.visits ? String(world.visits) : '—'} />
                        <EntityInfoBlock label="Capacity" value={`${world.recommendedCapacity || '—'} (${world.capacity || '—'})`} />
                        <EntityInfoBlock label="Created" value={formatDate(world.createdAt || world.created_at)} />
                        <EntityInfoBlock label="Last Updated" value={formatDate(world.updatedAt || world.updated_at)} />
                        {world.labsPublicationDate && world.labsPublicationDate !== 'none' ? (
                            <EntityInfoBlock label="Labs Publication Date" value={formatDate(world.labsPublicationDate)} />
                        ) : null}
                        <EntityInfoBlock label="Publication Date" value={formatDate(world.publicationDate)} />
                        <EntityInfoBlock label="Last Visited" value={formatDate(lastVisitedInstance?.created_at || lastVisitedInstance?.createdAt)} />
                        <EntityInfoBlock label="Visit Count" value={previousInstances.length ? String(previousInstances.length) : '—'} onClick={previousInstances.length ? () => setPreviousInstancesOpen(true) : undefined} />
                        <EntityInfoBlock label="Time Spent" value={totalVisitTime > 0 ? timeToText(totalVisitTime) : '—'} />
                        <EntityInfoBlock label="Version" value={world.version ? String(world.version) : '—'} />
                        <EntityInfoBlock label="Heat" value={world.heat ? String(world.heat) : '—'} />
                        <EntityInfoBlock label="Popularity" value={world.popularity ? String(world.popularity) : '—'} />
                        <EntityInfoBlock label="Persistent Data" value={hasPersistData ? 'Available' : '—'} />
                        <EntityInfoBlock label="Platform" full>
                            <span className="block whitespace-normal text-xs">{world.platforms?.join(', ') || '—'}</span>
                        </EntityInfoBlock>
                        {Array.isArray(world.urlList) && world.urlList.length ? (
                            <EntityInfoBlock label="Allowed Video Player Domains" full>
                                <div className="flex flex-wrap gap-1.5">
                                    {world.urlList.map((url) => <Badge key={url} variant="outline">{url}</Badge>)}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {authorTags.length ? (
                            <EntityInfoBlock label="Author Tags" full>
                                <div className="flex flex-wrap gap-1.5">
                                    {authorTags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json"><EntityRawJson value={{ world, memo, hasPersistData, fileAnalysis: world.fileAnalysis || {} }} /></EntityDialogTabContent>
            </EntityDialogTabs>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={`Previous Instances - ${world.name || 'World'}`}
                instances={previousInstances}
                variant="world"
                targetRef={world}
                onRowsChange={onPreviousInstancesChange}
            />
        </EntityDialogScaffold>
    );
}
