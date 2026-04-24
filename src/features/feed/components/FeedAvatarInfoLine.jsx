import { LockIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import avatarProfileRepository from '@/repositories/avatarProfileRepository.js';
import { avatarSearchProviderRepository, localFavoritesRepository } from '@/repositories/index.js';
import { openAvatarDialog, openUserDialog } from '@/services/dialogService.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { normalizeFeedId as normalizeId } from '../feedRows.js';

async function findAvatarByImageUrl({ imageUrl, avatarName }) {
    const fileId = extractFileId(imageUrl);
    const query = normalizeId(avatarName) || fileId;
    if (!fileId || query.length < 3) {
        return null;
    }

    const cachedAvatars = await localFavoritesRepository
        .getAvatarCache()
        .catch(() => []);
    const cachedMatch = cachedAvatars.find(
        (avatar) =>
            avatar?.id &&
            (extractFileId(avatar.imageUrl) === fileId ||
                extractFileId(avatar.thumbnailImageUrl) === fileId)
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
            (avatar) =>
                avatar?.id &&
                (extractFileId(avatar.imageUrl) === fileId ||
                    extractFileId(avatar.thumbnailImageUrl) === fileId)
        ) || null
    );
}

const avatarInfoLineCache = new Map();

function getAvatarInfoLineCacheKey(imageUrl, endpoint) {
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
} = {}) {
    return {
        avatarName: typeof avatarName === 'string' ? avatarName.trim() : '',
        ownerId: normalizeId(ownerId),
        status,
        cacheKey
    };
}

function isSameAvatarInfoLineState(left, right) {
    return (
        left?.avatarName === right?.avatarName &&
        left?.ownerId === right?.ownerId &&
        left?.status === right?.status &&
        left?.cacheKey === right?.cacheKey
    );
}

function setAvatarInfoLineState(setInfo, nextInfo) {
    setInfo((current) =>
        isSameAvatarInfoLineState(current, nextInfo) ? current : nextInfo
    );
}

function resolveInitialAvatarInfoLineState({
    avatarName,
    imageUrl,
    ownerId,
    endpoint
}) {
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

function avatarTagsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return !left?.length && !right?.length;
    }
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

export const AvatarInfoLine = memo(function AvatarInfoLine({
    avatarName,
    avatarTags,
    imageUrl,
    ownerId,
    userId
}) {
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
            .getAvatarNameFromImageUrl(imageUrl, { endpoint: currentEndpoint })
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

    async function openAvatarAuthorTarget() {
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
                        imageUrl,
                        { endpoint: currentEndpoint }
                    );
                nextOwnerId = normalizeId(nextInfo?.ownerId);
                nextAvatarName = nextInfo?.avatarName || nextAvatarName;
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.generated_toast.failed_to_resolve_avatar_author')
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
            toast.warning(t('view.feed.generated.avatar_author_unavailable'));
            return;
        }

        if (nextOwnerId === normalizedUserId) {
            toast.warning(t('view.feed.generated.avatar_is_private_or_not_found'));
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
                className="hover:text-primary h-auto w-fit justify-start p-0 text-left font-normal"
                disabled={!imageUrl}
                onClick={() => void openAvatarAuthorTarget()}
            >
                {label}
                {avatarType === 'own' ? (
                    <LockIcon data-icon="inline-end" />
                ) : null}
            </Button>
            {Array.isArray(avatarTags) && avatarTags.length ? (
                <div className="text-muted-foreground truncate text-xs">
                    {avatarTags
                        .map((tag) => String(tag).replace('content_', ''))
                        .join(', ')}
                </div>
            ) : null}
        </div>
    );
}, areAvatarInfoLinePropsEqual);

function areAvatarInfoLinePropsEqual(previousProps, nextProps) {
    return (
        previousProps.avatarName === nextProps.avatarName &&
        previousProps.imageUrl === nextProps.imageUrl &&
        previousProps.ownerId === nextProps.ownerId &&
        previousProps.userId === nextProps.userId &&
        avatarTagsEqual(previousProps.avatarTags, nextProps.avatarTags)
    );
}
