import {
    FolderOpenIcon,
    ImageIcon,
    ImageOffIcon,
    ImagesIcon,
    RefreshCwIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    backgroundImageRemoteProviders,
    chooseBackgroundImageFiles,
    chooseBackgroundImageFolder,
    refreshBackgroundImage,
    setBackgroundImageCustomRotationInterval,
    setBackgroundImageMode,
    setBackgroundImageProvider
} from '@/services/background-image/backgroundImageService';
import { formatDateFilter } from '@/lib/dateTime';
import { isBackgroundImageCustomSourceRotating } from '@/services/background-image/localSourceService';
import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageRotationInterval,
    BackgroundImageSnapshot
} from '@/services/background-image/types';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

function countKey(baseKey: string, count: number): string {
    return count === 1 ? baseKey : `${baseKey}_plural`;
}

function fileNameFromPath(path?: string): string {
    return String(path || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .pop() || String(path || '');
}

function formatResolvedAt(value: string): string {
    const formatted = formatDateFilter(value, 'long');
    return formatted === '-' ? value : formatted;
}

function resolveProviderName(providerId?: BackgroundImageProviderId): string {
    return (
        backgroundImageRemoteProviders.find(
            (provider) => provider.id === providerId
        )?.name || String(providerId || '')
    );
}

function CurrentBackgroundImageSummary({
    enabled,
    loading,
    mode,
    providerId,
    customSource,
    snapshot,
    onRefresh,
    t
}: {
    enabled: boolean;
    loading: boolean;
    mode: BackgroundImageMode;
    providerId: BackgroundImageProviderId;
    customSource: BackgroundImageCustomSource | null;
    snapshot: BackgroundImageSnapshot | null;
    onRefresh: () => void;
    t: (key: string, options?: any) => string;
}) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [snapshot?.imageUrl]);

    const providerName = resolveProviderName(snapshot?.providerId || providerId);
    const imageCount = snapshot?.imageCount || customSource?.paths.length || 0;
    const localPath =
        snapshot?.imagePath ||
        (customSource?.kind === 'folder'
            ? customSource.folderPath
            : customSource?.paths[0]);
    const title =
        snapshot?.mode === 'custom'
            ? snapshot.title || fileNameFromPath(snapshot.imagePath)
            : snapshot?.title;
    const sourceType =
        snapshot?.mode === 'daily' || mode === 'daily'
            ? providerName
            : customSource?.kind === 'folder'
              ? t('view.background_image.settings.source_type_folder')
              : imageCount > 1
                ? t('view.background_image.settings.source_type_files')
                : t('view.background_image.settings.source_type_file');

    return (
        <div className="border-border/70 bg-muted/20 flex min-w-0 flex-col gap-3 rounded-lg border p-2.5 sm:flex-row">
            <div className="bg-muted text-muted-foreground grid size-24 shrink-0 place-items-center overflow-hidden rounded-md border">
                {snapshot?.imageUrl && !imageFailed ? (
                    <img
                        src={snapshot.imageUrl}
                        alt={
                            title ||
                            t('view.background_image.settings.current_image')
                        }
                        className="size-full object-cover"
                        loading="lazy"
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <ImageOffIcon className="size-6 opacity-70" />
                )}
            </div>
            <div className="grid min-w-0 flex-1 gap-1 text-sm">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="truncate font-medium">
                            {title ||
                                t('view.background_image.settings.no_image')}
                        </div>
                        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                            {sourceType}
                        </span>
                    </div>
                    {enabled ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 self-start"
                            disabled={loading}
                            onClick={onRefresh}
                        >
                            <RefreshCwIcon data-icon="inline-start" />
                            {t('view.background_image.action.refresh')}
                        </Button>
                    ) : null}
                </div>
                {snapshot ? (
                    <>
                        <div className="text-muted-foreground truncate text-xs">
                            {snapshot.author} · {snapshot.license}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                            {snapshot.source}
                        </div>
                        {snapshot.mode === 'custom' && localPath ? (
                            <div
                                className="text-muted-foreground truncate font-mono text-xs"
                                title={localPath}
                            >
                                {localPath}
                            </div>
                        ) : null}
                        <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs">
                            {snapshot.imageCount ? (
                                <span>
                                    {t(
                                        countKey(
                                            'view.background_image.settings.image_count',
                                            snapshot.imageCount
                                        ),
                                        { count: snapshot.imageCount }
                                    )}
                                </span>
                            ) : null}
                            {snapshot.mode === 'custom' && customSource ? (
                                <span>
                                    {t('view.background_image.settings.rotation')}:{' '}
                                    {t(
                                        `view.background_image.rotation.${customSource.rotationInterval}`
                                    )}
                                </span>
                            ) : null}
                            <span>
                                {t('view.background_image.settings.resolved_at')}:{' '}
                                {formatResolvedAt(snapshot.resolvedAt)}
                            </span>
                        </div>
                    </>
                ) : (
                    <div className="text-muted-foreground text-xs">
                        {t('view.background_image.settings.no_image_description')}
                    </div>
                )}
            </div>
        </div>
    );
}

export function BackgroundImageSection() {
    const { t } = useTranslation();
    const mode = useBackgroundImageStore((state: any) => state.mode);
    const enabled = useBackgroundImageStore((state: any) => state.enabled);
    const providerId = useBackgroundImageStore(
        (state: any) => state.providerId
    );
    const customSource = useBackgroundImageStore(
        (state: any) => state.customSource
    );
    const snapshot = useBackgroundImageStore((state: any) => state.snapshot);
    const loading = useBackgroundImageStore((state: any) => state.loading);
    const showRotation = isBackgroundImageCustomSourceRotating(
        customSource,
        snapshot?.imageCount
    );

    async function updateMode(nextMode: BackgroundImageMode) {
        try {
            const updated = await setBackgroundImageMode(nextMode);
            if (updated) {
                toast.success(t('view.background_image.toast.enabled'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.failed')
            );
        }
    }

    async function updateProvider(nextProviderId: BackgroundImageProviderId) {
        try {
            await setBackgroundImageProvider(nextProviderId);
            if (enabled && mode === 'daily') {
                toast.success(t('view.background_image.toast.enabled'));
                return;
            }
            toast.success(t('common.settings_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.failed')
            );
        }
    }

    async function refreshBackground() {
        try {
            const refreshed = await refreshBackgroundImage();
            if (!refreshed) {
                return;
            }
            toast.success(t('view.background_image.toast.refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.failed')
            );
        }
    }

    async function selectFiles() {
        try {
            const selected = await chooseBackgroundImageFiles();
            if (selected) {
                toast.success(t('view.background_image.toast.enabled'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.no_images')
            );
        }
    }

    async function selectFolder() {
        try {
            const selected = await chooseBackgroundImageFolder();
            if (selected) {
                toast.success(t('view.background_image.toast.enabled'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.no_images')
            );
        }
    }

    async function updateRotationInterval(
        value: BackgroundImageRotationInterval
    ) {
        try {
            await setBackgroundImageCustomRotationInterval(value);
            toast.success(t('common.settings_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.background_image.toast.failed')
            );
        }
    }

    const sourceLabel =
        customSource?.kind === 'folder'
            ? customSource.folderPath
            : customSource?.paths?.length
              ? t(
                    countKey(
                        'view.background_image.settings.selected_files',
                        customSource.paths.length
                    ),
                    {
                        count: customSource.paths.length
                    }
                )
              : t('view.background_image.settings.no_custom_source');

    return (
        <Card>
            <CardContent className="flex flex-col gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="grid min-w-0 gap-1">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <ImageIcon data-icon="inline-start" />
                            {t('view.background_image.settings.header')}
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {t('view.background_image.settings.description')}
                        </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2">
                        <Select
                            value={mode === 'custom' ? 'custom' : 'daily'}
                            disabled={loading}
                            onValueChange={(value) =>
                                updateMode(value as BackgroundImageMode)
                            }
                        >
                            <SelectTrigger size="sm" className="min-w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="daily">
                                    {t('view.background_image.mode.daily')}
                                </SelectItem>
                                <SelectItem value="custom">
                                    {t('view.background_image.mode.custom')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {mode === 'daily' ? (
                            <Select
                                value={providerId}
                                disabled={loading}
                                onValueChange={(value) =>
                                    updateProvider(
                                        value as BackgroundImageProviderId
                                    )
                                }
                            >
                                <SelectTrigger size="sm" className="min-w-52">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {backgroundImageRemoteProviders.map(
                                        (provider) => (
                                            <SelectItem
                                                key={provider.id}
                                                value={provider.id}
                                            >
                                                {provider.name}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectContent>
                            </Select>
                        ) : null}
                    </div>
                </div>
                {providerId === 'nasa-apod-safe' && mode === 'daily' ? (
                    <p className="text-muted-foreground text-xs italic">
                        {t('view.background_image.settings.apod_note')}
                    </p>
                ) : null}
                {mode === 'custom' ? (
                    <div className="border-border/70 flex min-w-0 flex-col gap-3 border-t pt-3">
                        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                            <div className="grid min-w-0 gap-1">
                                <div className="text-sm font-medium">
                                    {t(
                                        'view.background_image.settings.custom_source'
                                    )}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                    {t(
                                        'view.background_image.settings.custom_source_description'
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    onClick={selectFiles}
                                >
                                    <ImagesIcon data-icon="inline-start" />
                                    {t(
                                        'view.background_image.action.select_images'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    onClick={selectFolder}
                                >
                                    <FolderOpenIcon data-icon="inline-start" />
                                    {t(
                                        'view.background_image.action.select_folder'
                                    )}
                                </Button>
                            </div>
                        </div>
                        <div className="text-muted-foreground flex min-w-0 flex-col gap-1 text-xs">
                            <span className="truncate" title={sourceLabel}>
                                {sourceLabel}
                            </span>
                            <span>
                                {t(
                                    'view.background_image.settings.folder_first_level_note'
                                )}
                            </span>
                        </div>
                        {showRotation ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">
                                    {t('view.background_image.settings.rotation')}
                                </span>
                                <Select
                                    value={
                                        customSource?.rotationInterval || 'daily'
                                    }
                                    disabled={loading}
                                    onValueChange={(value) =>
                                        updateRotationInterval(
                                            value as BackgroundImageRotationInterval
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="min-w-36"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="daily">
                                            {t(
                                                'view.background_image.rotation.daily'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="hourly">
                                            {t(
                                                'view.background_image.rotation.hourly'
                                            )}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                    </div>
                ) : null}
                <CurrentBackgroundImageSummary
                    enabled={enabled}
                    loading={loading}
                    mode={mode}
                    providerId={providerId}
                    customSource={customSource}
                    snapshot={enabled ? snapshot : null}
                    onRefresh={refreshBackground}
                    t={t}
                />
            </CardContent>
        </Card>
    );
}
