// @ts-nocheck
import { ImageIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    EmptyState,
    LoadingState,
    PageBackButton,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils.js';
import { mediaRepository } from '@/repositories/index.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

const MEDIA_SECTIONS = [
    {
        key: 'banner',
        fieldName: 'profilePicOverride',
        fileTag: 'gallery',
        assetKey: 'gallery',
        titleKey: 'dialog.user.profile_media.banner',
        clearKey: 'dialog.gallery_icons.clear_banner',
        useKey: 'dialog.gallery_icons.use_banner',
        cardClass: 'h-20 w-[6.667rem] sm:h-24 sm:w-32'
    },
    {
        key: 'profile-icon',
        fieldName: 'userIcon',
        fileTag: 'icon',
        assetKey: 'icons',
        titleKey: 'dialog.user.profile_media.profile_icon',
        clearKey: 'dialog.gallery_icons.clear_profile_icon',
        useKey: 'dialog.gallery_icons.use_profile_icon',
        cardClass: 'size-20 sm:size-24'
    }
];

function getLatestFileUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

function getUsefulDisplayName(file) {
    const displayName = String(file?.displayName || '').trim();
    const name = String(file?.name || '').trim();
    const id = String(file?.id || '').trim();
    const visibleName = displayName || name;

    if (
        !visibleName ||
        visibleName === id ||
        /^file_[\w-]+_blob$/i.test(visibleName)
    ) {
        return '';
    }

    return visibleName;
}

function ProfileMediaThumbnail({
    file,
    section,
    currentFileId,
    disabled,
    mutatingKey,
    onUse
}) {
    const { t } = useTranslation();
    const imageUrl = getLatestFileUrl(file);
    const displayName = getUsefulDisplayName(file);
    const isCurrent = file.id === currentFileId;
    const isMutating =
        mutatingKey === `${section.fieldName}:${file.id}` ||
        mutatingKey === `${section.fieldName}:clear`;

    return (
        <Button
            type="button"
            variant="ghost"
            className={cn(
                'relative min-w-0 overflow-hidden rounded-lg border p-0',
                'shrink-0',
                section.cardClass,
                isCurrent && 'ring-primary ring-2'
            )}
            title={`${t(section.useKey)}: ${displayName || file.id}`}
            disabled={disabled || isMutating || isCurrent}
            onClick={() => onUse(section.fieldName, file.id)}
        >
            <div
                className="bg-muted text-muted-foreground flex size-full items-center justify-center overflow-hidden"
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={displayName || file.id}
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <ImageIcon />
                )}
            </div>
            {isCurrent ? (
                <Badge
                    variant="secondary"
                    className="absolute top-1 left-1 bg-background/80"
                >
                    {t('dialog.gallery_icons.current')}
                </Badge>
            ) : null}
        </Button>
    );
}

function ProfileMediaSection({
    section,
    files,
    loading,
    profile,
    isVrcPlusSupporter,
    busy,
    mutatingKey,
    onUse,
    onClear
}) {
    const { t } = useTranslation();
    const currentValue = profile?.[section.fieldName] || '';
    const currentFileId = extractFileId(currentValue);

    return (
        <div className="bg-card/40 flex min-w-0 flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="font-heading text-base font-medium">
                        {t(section.titleKey)}
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start"
                    disabled={!isVrcPlusSupporter || !currentValue || busy}
                    onClick={() => onClear(section.fieldName)}
                >
                    <XIcon data-icon="inline-start" />
                    {t(section.clearKey)}
                </Button>
            </div>
            {loading ? (
                <LoadingState className="min-h-32" />
            ) : files.length ? (
                <div className="flex flex-wrap gap-2">
                    {files.map((file) => (
                        <ProfileMediaThumbnail
                            key={file.id}
                            file={file}
                            section={section}
                            currentFileId={currentFileId}
                            disabled={
                                !isVrcPlusSupporter ||
                                busy ||
                                Boolean(mutatingKey)
                            }
                            mutatingKey={mutatingKey}
                            onUse={onUse}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={ImageIcon}
                    className="min-h-32"
                    title={t('dialog.user.profile_media.empty_title')}
                    description={t('dialog.user.profile_media.empty_description')}
                />
            )}
        </div>
    );
}

export function UserDialogProfileMediaPanel({
    profile,
    endpoint,
    isVrcPlusSupporter,
    actionStatus,
    onBack,
    onSetProfileMediaField
}) {
    const { t } = useTranslation();
    const [filesBySection, setFilesBySection] = useState({
        gallery: [],
        icons: []
    });
    const [loadingBySection, setLoadingBySection] = useState({});
    const [mutatingKey, setMutatingKey] = useState('');
    const busy = actionStatus !== 'idle';

    async function refreshSection(section) {
        setLoadingBySection((current) => ({
            ...current,
            [section.assetKey]: true
        }));
        try {
            const { json } = await mediaRepository.getFileList(
                {
                    n: 100,
                    tag: section.fileTag
                },
                {
                    endpoint
                }
            );
            setFilesBySection((current) => ({
                ...current,
                [section.assetKey]: Array.isArray(json)
                    ? [...json].reverse()
                    : []
            }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.toast.failed_to_load_value', {
                          value: section.fileTag
                      })
            );
        } finally {
            setLoadingBySection((current) => ({
                ...current,
                [section.assetKey]: false
            }));
        }
    }

    useEffect(() => {
        for (const section of MEDIA_SECTIONS) {
            void refreshSection(section);
        }
    }, [endpoint, profile?.id]);

    async function useProfileMedia(fieldName, fileId) {
        const key = `${fieldName}:${fileId}`;
        setMutatingKey(key);
        try {
            await onSetProfileMediaField(fieldName, fileId);
        } finally {
            setMutatingKey((current) => (current === key ? '' : current));
        }
    }

    async function clearProfileMedia(fieldName) {
        const key = `${fieldName}:clear`;
        setMutatingKey(key);
        try {
            await onSetProfileMediaField(fieldName, '');
        } finally {
            setMutatingKey((current) => (current === key ? '' : current));
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <PageToolbar>
                <PageToolbarRow className="items-center">
                    <PageBackButton
                        label={t('common.actions.back')}
                        onClick={onBack}
                    />
                    <PageHeader className="min-w-0 p-0">
                        <PageTitle>
                            {t('dialog.user.actions.edit_profile_media')}
                        </PageTitle>
                    </PageHeader>
                </PageToolbarRow>
            </PageToolbar>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="flex flex-col gap-3">
                    {MEDIA_SECTIONS.map((section) => (
                        <ProfileMediaSection
                            key={section.key}
                            section={section}
                            files={filesBySection[section.assetKey] || []}
                            loading={loadingBySection[section.assetKey]}
                            profile={profile}
                            isVrcPlusSupporter={isVrcPlusSupporter}
                            busy={busy}
                            mutatingKey={mutatingKey}
                            onUse={(fieldName, fileId) =>
                                void useProfileMedia(fieldName, fileId)
                            }
                            onClear={(fieldName) =>
                                void clearProfileMedia(fieldName)
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
