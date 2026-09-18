import { CheckIcon, ImageIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState,
    LoadingState,
    PageBackButton,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { TileShell } from '@/components/tile/TileShell';
import { cn } from '@/lib/utils';
import type { MediaFileTag } from '@/platform/tauri/bindings';
import mediaRepository from '@/repositories/mediaRepository';
import { toast } from '@/services/toastService';
import {
    TILE_CHECK,
    TILE_CHECK_ANCHOR
} from '@/shared/constants/selectableTile';
import {
    PROFILE_MEDIA_URL_FIELD,
    type ProfileMediaField
} from '@/shared/utils/currentUserMedia';
import { extractFileId } from '@/shared/utils/fileUtils';
import { Button } from '@/ui/shadcn/button';

import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';

type ProfileMediaFieldName = ProfileMediaField;
type MediaFile = Awaited<
    ReturnType<typeof mediaRepository.getFileList>
>['json'][number];

interface MediaSection {
    key: string;
    fieldName: ProfileMediaFieldName;
    fileTag: MediaFileTag;
    assetKey: string;
    titleKey: string;
    clearKey: string;
    useKey: string;
    cardClass: string;
}

const MEDIA_SECTIONS: MediaSection[] = [
    {
        key: 'banner',
        fieldName: 'banner',
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

function getLatestFileUrl(file: MediaFile) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const latestVersion = versions.at(-1);
    const versionFile =
        latestVersion?.file && typeof latestVersion.file === 'object'
            ? latestVersion.file
            : null;
    return versionFile && 'url' in versionFile
        ? String(versionFile.url || '')
        : '';
}

function getUsefulDisplayName(file: MediaFile) {
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
}: {
    file: MediaFile;
    section: MediaSection;
    currentFileId: string;
    disabled: boolean;
    mutatingKey: string;
    onUse: (fieldName: ProfileMediaFieldName, fileId: string) => void;
}) {
    const { t } = useTranslation();
    const imageUrl = getLatestFileUrl(file);
    const displayName = getUsefulDisplayName(file);
    const isCurrent = file.id === currentFileId;
    const isMutating =
        mutatingKey === `${section.fieldName}:${file.id}` ||
        mutatingKey === `${section.fieldName}:clear`;

    return (
        <TileShell
            selected={isCurrent}
            className={cn('shrink-0 p-0', section.cardClass)}
            render={
                <Button
                    type="button"
                    variant="ghost"
                    title={`${t(section.useKey)}: ${displayName || file.id}`}
                    disabled={disabled || isMutating || isCurrent}
                    onClick={() => onUse(section.fieldName, file.id)}
                />
            }
        >
            <div className="bg-muted text-muted-foreground flex size-full items-center justify-center overflow-hidden">
                {imageUrl ? (
                    <FadeInImage
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
                <span
                    role="img"
                    aria-label={t('dialog.gallery_icons.current')}
                    className={cn(TILE_CHECK, TILE_CHECK_ANCHOR)}
                >
                    <CheckIcon className="size-3" />
                </span>
            ) : null}
        </TileShell>
    );
}

function ProfileMediaSection({
    section,
    files,
    loading,
    profile,
    busy,
    mutatingKey,
    onUse,
    onClear
}: {
    section: MediaSection;
    files: MediaFile[];
    loading: boolean;
    profile: UserDialogProfileRecord;
    busy: boolean;
    mutatingKey: string;
    onUse: (fieldName: ProfileMediaFieldName, fileId: string) => void;
    onClear: (fieldName: ProfileMediaFieldName) => void;
}) {
    const { t } = useTranslation();
    const rawCurrentValue =
        profile?.[PROFILE_MEDIA_URL_FIELD[section.fieldName]];
    const currentValue =
        typeof rawCurrentValue === 'string' ? rawCurrentValue : '';
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
                    disabled={!currentValue || busy}
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
                            disabled={busy || Boolean(mutatingKey)}
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
                    description={t(
                        'dialog.user.profile_media.empty_description'
                    )}
                />
            )}
        </div>
    );
}

export function UserDialogProfileMediaPanel({
    profile,
    actionStatus,
    onBack,
    onSetProfileMediaField
}: {
    profile: UserDialogProfileRecord;
    actionStatus: string;
    onBack: () => void;
    onSetProfileMediaField: (
        fieldName: ProfileMediaFieldName,
        fileId: string
    ) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const [filesBySection, setFilesBySection] = useState<
        Record<
            string,
            Awaited<ReturnType<typeof mediaRepository.getFileList>>['json']
        >
    >({
        gallery: [],
        icons: []
    });
    const [loadingBySection, setLoadingBySection] = useState<
        Record<string, boolean>
    >({});
    const [mutatingKey, setMutatingKey] = useState('');
    const busy = actionStatus !== 'idle';

    const refreshSection = useCallback(
        async (section: MediaSection) => {
            setLoadingBySection((current) => ({
                ...current,
                [section.assetKey]: true
            }));
            try {
                const { json } = await mediaRepository.getFileList({
                    n: 100,
                    tag: section.fileTag
                });
                setFilesBySection((current) => ({
                    ...current,
                    [section.assetKey]: Array.isArray(json)
                        ? [...json].reverse()
                        : []
                }));
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_load_value', {
                                  value: section.fileTag
                              })
                });
            } finally {
                setLoadingBySection((current) => ({
                    ...current,
                    [section.assetKey]: false
                }));
            }
        },
        [t]
    );

    useEffect(() => {
        for (const section of MEDIA_SECTIONS) {
            refreshSection(section);
        }
    }, [profile?.id, refreshSection]);

    async function applyProfileMedia(
        fieldName: ProfileMediaFieldName,
        fileId: string
    ) {
        const key = `${fieldName}:${fileId}`;
        setMutatingKey(key);
        try {
            await onSetProfileMediaField(fieldName, fileId);
        } finally {
            setMutatingKey((current) => (current === key ? '' : current));
        }
    }

    async function clearProfileMedia(fieldName: ProfileMediaFieldName) {
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
                            busy={busy}
                            mutatingKey={mutatingKey}
                            onUse={(fieldName, fileId) => {
                                applyProfileMedia(fieldName, fileId);
                            }}
                            onClear={(fieldName) => {
                                clearProfileMedia(fieldName);
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
