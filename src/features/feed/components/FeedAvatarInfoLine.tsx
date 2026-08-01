import { LockIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import { openAvatarDialog, openUserDialog } from '@/services/dialogService';
import { extractFileId } from '@/shared/utils/fileUtils';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

import { normalizeFeedId as normalizeId } from '../feedRows';

type ResolvedAvatarRecord = Record<string, unknown> & {
    id?: string;
    name?: string;
};

type AvatarInfoLineStatus = 'idle' | 'loading' | 'ready' | 'error';

type AvatarInfoLineState = {
    avatarName: string;
    ownerId: string;
    status: AvatarInfoLineStatus;
    cacheKey: string;
};

type AvatarInfoLineStateInput = {
    avatarName?: unknown;
    ownerId?: unknown;
    status?: AvatarInfoLineStatus;
    cacheKey?: string;
};

type AvatarInfoLineProps = {
    avatarName?: unknown;
    avatarTags?: unknown;
    compact?: boolean;
    imageUrl?: unknown;
    ownerId?: unknown;
    showTags?: boolean;
    userId?: unknown;
};

function isAvatarRecord(value: unknown): value is ResolvedAvatarRecord {
    return Boolean(value) && typeof value === 'object';
}

function avatarMatchesFileId(
    avatar: unknown,
    fileId: string
): avatar is ResolvedAvatarRecord {
    if (!isAvatarRecord(avatar) || !avatar.id) {
        return false;
    }
    return (
        extractFileId(String(avatar.imageUrl ?? '')) === fileId ||
        extractFileId(String(avatar.thumbnailImageUrl ?? '')) === fileId
    );
}

async function findAvatarByImageUrl({
    imageUrl,
    avatarName
}: {
    imageUrl: unknown;
    avatarName: unknown;
}): Promise<ResolvedAvatarRecord | null> {
    const fileId = extractFileId(String(imageUrl ?? ''));
    const query = normalizeId(avatarName) || fileId;
    if (!fileId || query.length < 3) {
        return null;
    }

    const cachedAvatars = await favoritePersistenceRepository
        .getAvatarCache()
        .catch(() => []);
    const cachedMatch = cachedAvatars.find((avatar) =>
        avatarMatchesFileId(avatar, fileId)
    );
    if (cachedMatch) {
        return avatarProfileRepository.normalize(cachedMatch);
    }

    const config = await avatarSearchProviderRepository.getConfig();
    if (!config.enabled || !config.selectedProvider) {
        return null;
    }

    const response = await avatarSearchProviderRepository.search({
        provider: config.selectedProvider,
        query
    });

    return (
        response.avatars.find(
            (avatar: unknown): avatar is ResolvedAvatarRecord =>
                avatarMatchesFileId(avatar, fileId)
        ) ?? null
    );
}

const avatarInfoLineCache = new Map<string, AvatarInfoLineState>();

function getAvatarInfoLineCacheKey(
    imageUrl: unknown,
    endpoint: unknown
): string {
    const normalizedImageUrl = String(imageUrl || '').trim();
    if (!normalizedImageUrl) {
        return '';
    }
    return `${String(endpoint || '').trim()}\n${normalizedImageUrl}`;
}

function normalizeAvatarInfoLineState({
    avatarName = '',
    ownerId = '',
    status = 'idle',
    cacheKey = ''
}: AvatarInfoLineStateInput = {}): AvatarInfoLineState {
    return {
        avatarName: typeof avatarName === 'string' ? avatarName.trim() : '',
        ownerId: normalizeId(ownerId),
        status,
        cacheKey
    };
}

function isSameAvatarInfoLineState(
    left: AvatarInfoLineState | undefined,
    right: AvatarInfoLineState | undefined
): boolean {
    return (
        left?.avatarName === right?.avatarName &&
        left?.ownerId === right?.ownerId &&
        left?.status === right?.status &&
        left?.cacheKey === right?.cacheKey
    );
}

function setAvatarInfoLineState(
    setInfo: Dispatch<SetStateAction<AvatarInfoLineState>>,
    nextInfo: AvatarInfoLineState
): void {
    setInfo((current) =>
        isSameAvatarInfoLineState(current, nextInfo) ? current : nextInfo
    );
}

function resolveInitialAvatarInfoLineState({
    avatarName,
    imageUrl,
    ownerId,
    endpoint
}: {
    avatarName?: unknown;
    imageUrl?: unknown;
    ownerId?: unknown;
    endpoint?: unknown;
}): AvatarInfoLineState {
    const hintedName = typeof avatarName === 'string' ? avatarName.trim() : '';
    const hintedOwnerId = normalizeId(ownerId);
    const cacheKey = getAvatarInfoLineCacheKey(imageUrl, endpoint);

    if (!cacheKey) {
        return normalizeAvatarInfoLineState({
            avatarName: hintedName,
            ownerId: hintedOwnerId,
            status: 'idle'
        });
    }

    if (hintedName || hintedOwnerId) {
        const nextInfo = normalizeAvatarInfoLineState({
            avatarName: hintedName,
            ownerId: hintedOwnerId,
            status: 'ready',
            cacheKey
        });
        avatarInfoLineCache.set(cacheKey, nextInfo);
        return nextInfo;
    }

    const cachedInfo = avatarInfoLineCache.get(cacheKey);
    if (cachedInfo) {
        return cachedInfo;
    }

    return normalizeAvatarInfoLineState({
        status: 'loading',
        cacheKey
    });
}

function isEmptyAvatarTags(value: unknown): boolean {
    return !(value as { length?: unknown } | null | undefined)?.length;
}

function avatarTagsEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return isEmptyAvatarTags(left) && isEmptyAvatarTags(right);
    }
    if (left.length !== right.length) {
        return false;
    }
    return left.every(
        (value: unknown, index: number) => value === right[index]
    );
}

export const AvatarInfoLine = memo(function AvatarInfoLine({
    avatarName,
    avatarTags,
    compact = false,
    imageUrl,
    ownerId,
    showTags = true,
    userId
}: AvatarInfoLineProps) {
    const { t } = useTranslation();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const [info, setInfo] = useState(() =>
        resolveInitialAvatarInfoLineState({
            avatarName,
            imageUrl,
            ownerId,
            endpoint: currentEndpoint
        })
    );

    useEffect(() => {
        const hintedName =
            typeof avatarName === 'string' ? avatarName.trim() : '';
        const hintedOwnerId = normalizeId(ownerId);
        const cacheKey = getAvatarInfoLineCacheKey(imageUrl, currentEndpoint);

        if (!cacheKey) {
            setAvatarInfoLineState(setInfo, {
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'idle',
                cacheKey: ''
            });
            return undefined;
        }

        if (hintedName || hintedOwnerId) {
            const nextInfo = normalizeAvatarInfoLineState({
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'ready',
                cacheKey
            });
            avatarInfoLineCache.set(cacheKey, nextInfo);
            setAvatarInfoLineState(setInfo, nextInfo);
            return undefined;
        }

        const cachedInfo = avatarInfoLineCache.get(cacheKey);
        if (cachedInfo) {
            setAvatarInfoLineState(setInfo, cachedInfo);
            return undefined;
        }

        let active = true;
        setInfo((current) => {
            if (current.cacheKey === cacheKey && current.status === 'ready') {
                return current;
            }
            const nextInfo = normalizeAvatarInfoLineState({
                status: 'loading',
                cacheKey
            });
            return isSameAvatarInfoLineState(current, nextInfo)
                ? current
                : nextInfo;
        });

        avatarProfileRepository
            .getAvatarNameFromImageUrl(imageUrl)
            .then((nextInfo) => {
                if (!active) {
                    return;
                }

                const resolvedInfo = normalizeAvatarInfoLineState({
                    avatarName:
                        typeof nextInfo?.avatarName === 'string'
                            ? nextInfo.avatarName.trim()
                            : '',
                    ownerId: normalizeId(nextInfo?.ownerId),
                    status: 'ready',
                    cacheKey
                });
                avatarInfoLineCache.set(cacheKey, resolvedInfo);
                setAvatarInfoLineState(setInfo, resolvedInfo);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setAvatarInfoLineState(setInfo, {
                    avatarName: hintedName,
                    ownerId: hintedOwnerId,
                    status: 'error',
                    cacheKey
                });
            });

        return () => {
            active = false;
        };
    }, [avatarName, currentEndpoint, imageUrl, ownerId]);

    const normalizedOwnerId = normalizeId(info.ownerId);
    const normalizedUserId = normalizeId(userId);
    const avatarType =
        normalizedOwnerId && normalizedUserId
            ? normalizedOwnerId === normalizedUserId
                ? 'own'
                : 'public'
            : '';
    const label =
        info.status === 'loading'
            ? 'Resolving avatar info...'
            : info.avatarName || t('dialog.user.info.unknown_avatar');

    async function openAvatarAuthorTarget(): Promise<void> {
        if (!imageUrl) {
            return;
        }

        if (
            normalizedUserId &&
            normalizeId(currentUserSnapshot?.id) === normalizedUserId &&
            currentUserSnapshot?.currentAvatar
        ) {
            openAvatarDialog({
                avatarId: currentUserSnapshot.currentAvatar,
                title:
                    currentUserSnapshot.currentAvatarName ||
                    currentUserSnapshot.avatarName ||
                    info.avatarName ||
                    undefined
            });
            return;
        }

        let nextOwnerId = normalizedOwnerId;
        let nextAvatarName = info.avatarName;
        if (!nextOwnerId) {
            try {
                const nextInfo =
                    await avatarProfileRepository.getAvatarNameFromImageUrl(
                        imageUrl
                    );
                nextOwnerId = normalizeId(nextInfo?.ownerId);
                nextAvatarName = nextInfo?.avatarName || nextAvatarName;
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_resolve_avatar_author')
                );
                return;
            }
        }

        try {
            const avatar = await findAvatarByImageUrl({
                imageUrl,
                avatarName: nextAvatarName
            });
            if (avatar?.id) {
                openAvatarDialog({
                    avatarId: avatar.id,
                    title: avatar.name || nextAvatarName || undefined,
                    seedData: avatar
                });
                return;
            }
        } catch {
            // Fall back to the old author/private distinction when the remote avatar index is unavailable.
        }

        if (!nextOwnerId) {
            toast.warning(t('view.feed.error.avatar_author_unavailable'));
            return;
        }

        if (nextOwnerId === normalizedUserId) {
            toast.warning(t('view.feed.error.avatar_is_private_or_not_found'));
            return;
        }

        openUserDialog({
            userId: nextOwnerId,
            title: nextAvatarName || undefined
        });
    }

    return (
        <div className="flex flex-col gap-0.5">
            <Button
                type="button"
                variant="ghost"
                className={cn(
                    'text-muted-foreground hover:text-primary h-auto w-fit justify-start p-0 text-left font-normal',
                    compact && 'text-xs leading-snug'
                )}
                disabled={!imageUrl}
                onClick={() => {
                    openAvatarAuthorTarget();
                }}
            >
                {label}
                {avatarType === 'own' ? (
                    <LockIcon
                        data-icon="inline-end"
                        className={compact ? 'size-3' : undefined}
                    />
                ) : null}
            </Button>
            {showTags && Array.isArray(avatarTags) && avatarTags.length ? (
                <div className="text-muted-foreground truncate text-xs">
                    {avatarTags
                        .map((tag: unknown) =>
                            String(tag).replace('content_', '')
                        )
                        .join(', ')}
                </div>
            ) : null}
        </div>
    );
}, areAvatarInfoLinePropsEqual);

function areAvatarInfoLinePropsEqual(
    previousProps: Readonly<AvatarInfoLineProps>,
    nextProps: Readonly<AvatarInfoLineProps>
): boolean {
    return (
        previousProps.avatarName === nextProps.avatarName &&
        previousProps.compact === nextProps.compact &&
        previousProps.showTags === nextProps.showTags &&
        previousProps.imageUrl === nextProps.imageUrl &&
        previousProps.ownerId === nextProps.ownerId &&
        previousProps.userId === nextProps.userId &&
        avatarTagsEqual(previousProps.avatarTags, nextProps.avatarTags)
    );
}
