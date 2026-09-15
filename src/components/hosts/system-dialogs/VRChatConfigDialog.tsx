import {
    ExternalLinkIcon,
    FolderOpenIcon,
    RefreshCwIcon,
    SaveIcon,
    SparklesIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import {
    openExternalLink,
    openFolderSelectorDialog,
    readVrchatConfigFileSafe,
    vrchatCacheLocationWouldChange,
    writeVrchatConfigFile,
    writeVrchatConfigFileWithCacheCleanup
} from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { links } from '@/shared/constants/link';
import {
    VRChatCameraResolutions,
    VRChatScreenshotResolutions,
    VRCHAT_MIN_CACHE_SIZE_GB,
    type VRChatResolution
} from '@/shared/constants/settings';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSeparator,
    FieldSet
} from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    applyResolution,
    getConfigFieldValue,
    getResolutionKey,
    normalizeVrchatConfigForSave,
    parseVrchatConfig,
    type VrchatConfig
} from './vrchatConfigModel';

function ConfigNumberField({
    id,
    label,
    value,
    placeholder,
    min,
    onValueChange
}: {
    id: string;
    label: string;
    value: string | number;
    placeholder: string;
    min?: number;
    onValueChange: (value: string) => void;
}) {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <NumberField
                id={id}
                min={min}
                allowOutOfRange
                value={value === '' ? null : Number(value)}
                onValueChange={(next) =>
                    onValueChange(next === null ? '' : String(next))
                }
            >
                <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput placeholder={placeholder} />
                    <NumberFieldIncrement />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    );
}

function ConfigPathField({
    id,
    label,
    value,
    placeholder,
    browseLabel,
    onValueChange,
    onBrowse
}: {
    id: string;
    label: string;
    value: string | number;
    placeholder: string;
    browseLabel: string;
    onValueChange: (value: string) => void;
    onBrowse: () => void;
}) {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <InputGroup>
                <InputGroupInput
                    id={id}
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onValueChange(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton type="button" onClick={onBrowse}>
                        <FolderOpenIcon data-icon="inline-start" />
                        {browseLabel}
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
        </Field>
    );
}

function ResolutionSelect({
    label,
    value,
    rows,
    onValueChange
}: {
    label: string;
    value: string;
    rows: VRChatResolution[];
    onValueChange: (value: string | null) => void;
}) {
    return (
        <Field>
            <FieldLabel>{label}</FieldLabel>
            <Select
                value={value}
                onValueChange={onValueChange}
                items={rows.map((row) => ({
                    value: getResolutionKey(row),
                    label: row.name
                }))}
            >
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {rows.map((row) => (
                            <SelectItem
                                key={row.name}
                                value={getResolutionKey(row)}
                            >
                                {row.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </Field>
    );
}

export function VRChatConfigDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const loadRequestRef = useRef(0);
    const [config, setConfig] = useState<VrchatConfig>({
        picture_output_split_by_date: true
    });
    const [cacheSize, setCacheSize] = useState('');
    const [cacheSizeBytes, setCacheSizeBytes] = useState(0);
    const [loading, setLoading] = useState(false);

    async function refreshCacheSize() {
        const nextCacheSize = await assetBundleRepository
            .getCacheSize()
            .catch(() => 0);
        const cacheBytes = Number(nextCacheSize) || 0;
        setCacheSizeBytes(cacheBytes);
        setCacheSize(
            cacheBytes > 0
                ? `${(cacheBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
                : '0 GB'
        );
    }

    async function handleRefreshCacheSize() {
        setLoading(true);
        try {
            await refreshCacheSize();
        } finally {
            setLoading(false);
        }
    }

    async function loadConfig() {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        try {
            const [configJson] = await Promise.all([
                readVrchatConfigFileSafe(),
                refreshCacheSize()
            ]);
            if (requestId !== loadRequestRef.current) {
                return;
            }
            const parsed = parseVrchatConfig(configJson);
            setConfig({
                picture_output_split_by_date: true,
                ...parsed
            });
        } catch (error) {
            if (requestId !== loadRequestRef.current) {
                return;
            }
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'host.system_dialogs.toast.failed_to_load_vrchat_configuration'
                    )
                )
            });
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }

    const loadConfigForOpen = useEffectEvent(loadConfig);

    useEffect(() => {
        if (open) {
            loadConfigForOpen();
        } else {
            loadRequestRef.current += 1;
        }
    }, [open]);

    async function openFolderBrowser(key: string) {
        const selected = await openFolderSelectorDialog(
            String(getConfigFieldValue(config, key))
        ).catch((error: unknown) => {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_select_folder')
                )
            });
            return '';
        });
        if (selected) {
            setConfig((current) => ({ ...current, [key]: selected }));
        }
    }

    async function handleSweepCache() {
        const configuredCacheSize = Number.parseInt(
            String(config.cache_size ?? ''),
            10
        );
        const maxSizeGb = Math.max(
            Number.isFinite(configuredCacheSize)
                ? configuredCacheSize
                : VRCHAT_MIN_CACHE_SIZE_GB,
            VRCHAT_MIN_CACHE_SIZE_GB
        );
        const maxSizeBytes = maxSizeGb * 1024 ** 3;
        if (cacheSizeBytes > maxSizeBytes && isGameRunning) {
            toast.add({
                type: 'error',
                title: t('dialog.config_json.close_vrchat_before_cleanup')
            });
            return;
        }
        setLoading(true);
        try {
            const removed =
                await assetBundleRepository.sweepCache(maxSizeBytes);
            toast.add({
                type: 'success',
                title: Array.isArray(removed)
                    ? t(
                          'host.system_dialogs.toast.removed_value_cache_entries',
                          { value: removed.length }
                      )
                    : t('message.cache.deleted')
            });
            await refreshCacheSize();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_sweep_asset_cache')
                )
            });
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteAllCache() {
        const result = await confirm({
            title: t('confirm.title'),
            description: t('confirm.clear_cache'),
            confirmText: t('dialog.config_json.delete_cache'),
            cancelText: t('dialog.config_json.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setLoading(true);
        try {
            await assetBundleRepository.deleteAllCache();
            toast.add({ type: 'success', title: t('message.cache.deleted') });
            await refreshCacheSize();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_delete_asset_cache')
                )
            });
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setLoading(true);
        try {
            const normalizedConfig = normalizeVrchatConfigForSave(config);
            const json = JSON.stringify(normalizedConfig, null, '\t');
            const cacheDirectoryChanged =
                await vrchatCacheLocationWouldChange(json);
            let cleanOldCache = false;

            if (cacheDirectoryChanged && cacheSizeBytes > 0) {
                const result = await confirm({
                    title: t('dialog.config_json.cache_location_changed'),
                    description: t(
                        'dialog.config_json.old_cache_cleanup_description',
                        { size: cacheSize }
                    ),
                    confirmText: t('dialog.config_json.clean_old_cache'),
                    alternativeText: t('dialog.config_json.keep_old_cache'),
                    cancelText: t('dialog.config_json.cancel'),
                    dismissible: false,
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
                if (result.reason === 'ok') {
                    if (isGameRunning) {
                        toast.add({
                            type: 'error',
                            title: t(
                                'dialog.config_json.close_vrchat_before_cleanup'
                            )
                        });
                        return;
                    }
                    cleanOldCache = true;
                }
            }

            let cleanupError: string | null = null;
            if (cleanOldCache) {
                cleanupError =
                    await writeVrchatConfigFileWithCacheCleanup(json);
            } else {
                await writeVrchatConfigFile(json);
            }
            toast.add({
                type: 'success',
                title: t('dialog.system.success.saved_vrchat_config')
            });
            if (cleanupError) {
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        cleanupError,
                        t(
                            'host.system_dialogs.toast.failed_to_delete_asset_cache'
                        )
                    )
                });
            }
            onOpenChange(false);
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'host.system_dialogs.toast.failed_to_save_vrchat_configuration'
                    )
                )
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.config_json.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.config_json.description1')}{' '}
                        {t('dialog.config_json.description2')}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto pr-1">
                    <FieldGroup className="gap-6">
                        <FieldSet>
                            <FieldLegend>
                                {t('dialog.config_json.section_cache')}
                            </FieldLegend>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <ConfigNumberField
                                    id="config-json-cache_size"
                                    label={t(
                                        'dialog.config_json.max_cache_size'
                                    )}
                                    min={VRCHAT_MIN_CACHE_SIZE_GB}
                                    placeholder={String(
                                        VRCHAT_MIN_CACHE_SIZE_GB
                                    )}
                                    value={getConfigFieldValue(
                                        config,
                                        'cache_size'
                                    )}
                                    onValueChange={(value) =>
                                        setConfig((current) => ({
                                            ...current,
                                            cache_size: value
                                        }))
                                    }
                                />
                                <ConfigNumberField
                                    id="config-json-cache_expiry_delay"
                                    label={t(
                                        'dialog.config_json.cache_expiry_delay'
                                    )}
                                    min={30}
                                    placeholder="30"
                                    value={getConfigFieldValue(
                                        config,
                                        'cache_expiry_delay'
                                    )}
                                    onValueChange={(value) =>
                                        setConfig((current) => ({
                                            ...current,
                                            cache_expiry_delay: value
                                        }))
                                    }
                                />
                            </div>
                            <ConfigPathField
                                id="config-json-cache_directory"
                                label={t('dialog.config_json.cache_directory')}
                                placeholder={
                                    '%AppData%\\..\\LocalLow\\VRChat\\VRChat'
                                }
                                browseLabel={t(
                                    'dialog.screenshot_metadata.browse'
                                )}
                                value={getConfigFieldValue(
                                    config,
                                    'cache_directory'
                                )}
                                onValueChange={(value) =>
                                    setConfig((current) => ({
                                        ...current,
                                        cache_directory: value
                                    }))
                                }
                                onBrowse={() =>
                                    openFolderBrowser('cache_directory')
                                }
                            />
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground text-sm">
                                        {t('dialog.config_json.cache_size')}
                                    </span>
                                    <span className="font-mono text-base tabular-nums">
                                        {cacheSize}
                                    </span>
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    disabled={loading}
                                                    aria-label={t(
                                                        'dialog.config_json.refresh'
                                                    )}
                                                    onClick={() => {
                                                        handleRefreshCacheSize();
                                                    }}
                                                >
                                                    <RefreshCwIcon
                                                        data-icon="icon"
                                                        className={cn(
                                                            loading &&
                                                                'animate-spin'
                                                        )}
                                                    />
                                                </Button>
                                            }
                                        />
                                        <TooltipContent>
                                            {t('dialog.config_json.refresh')}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                                <div className="ml-auto flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={loading}
                                        onClick={() => {
                                            handleSweepCache();
                                        }}
                                    >
                                        <SparklesIcon data-icon="inline-start" />
                                        {t('dialog.config_json.sweep_cache')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        disabled={loading}
                                        onClick={() => {
                                            handleDeleteAllCache();
                                        }}
                                    >
                                        <Trash2Icon data-icon="inline-start" />
                                        {t('dialog.config_json.delete_cache')}
                                    </Button>
                                </div>
                            </div>
                        </FieldSet>

                        <FieldSet>
                            <FieldLegend>
                                {t('dialog.config_json.section_pictures')}
                            </FieldLegend>
                            <ConfigPathField
                                id="config-json-picture_output_folder"
                                label={t(
                                    'dialog.config_json.picture_directory'
                                )}
                                placeholder={'%UserProfile%\\Pictures\\VRChat'}
                                browseLabel={t(
                                    'dialog.screenshot_metadata.browse'
                                )}
                                value={getConfigFieldValue(
                                    config,
                                    'picture_output_folder'
                                )}
                                onValueChange={(value) =>
                                    setConfig((current) => ({
                                        ...current,
                                        picture_output_folder: value
                                    }))
                                }
                                onBrowse={() =>
                                    openFolderBrowser('picture_output_folder')
                                }
                            />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <ResolutionSelect
                                    label={t(
                                        'dialog.config_json.screenshot_resolution'
                                    )}
                                    value={getResolutionKey({
                                        width: getConfigFieldValue(
                                            config,
                                            'screenshot_res_width'
                                        ),
                                        height: getConfigFieldValue(
                                            config,
                                            'screenshot_res_height'
                                        )
                                    })}
                                    rows={VRChatScreenshotResolutions}
                                    onValueChange={(value) =>
                                        setConfig((current) =>
                                            applyResolution(
                                                current,
                                                'screenshot_res',
                                                value
                                            )
                                        )
                                    }
                                />
                            </div>
                            <Field orientation="horizontal">
                                <Checkbox
                                    id="vrchat-config-picture-sort-by-date"
                                    checked={Boolean(
                                        config.picture_output_split_by_date
                                    )}
                                    onCheckedChange={(checked) =>
                                        setConfig((current) => ({
                                            ...current,
                                            picture_output_split_by_date:
                                                Boolean(checked)
                                        }))
                                    }
                                />
                                <FieldLabel htmlFor="vrchat-config-picture-sort-by-date">
                                    {t(
                                        'dialog.config_json.picture_sort_by_date'
                                    )}
                                </FieldLabel>
                            </Field>
                        </FieldSet>

                        <FieldSet>
                            <FieldLegend>
                                {t('dialog.config_json.section_camera')}
                            </FieldLegend>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <ConfigNumberField
                                    id="config-json-fpv_steadycam_fov"
                                    label={t(
                                        'dialog.config_json.fpv_steadycam_fov'
                                    )}
                                    placeholder="50"
                                    value={getConfigFieldValue(
                                        config,
                                        'fpv_steadycam_fov'
                                    )}
                                    onValueChange={(value) =>
                                        setConfig((current) => ({
                                            ...current,
                                            fpv_steadycam_fov: value
                                        }))
                                    }
                                />
                                <ResolutionSelect
                                    label={t(
                                        'dialog.config_json.camera_resolution'
                                    )}
                                    value={getResolutionKey({
                                        width: getConfigFieldValue(
                                            config,
                                            'camera_res_width'
                                        ),
                                        height: getConfigFieldValue(
                                            config,
                                            'camera_res_height'
                                        )
                                    })}
                                    rows={VRChatCameraResolutions}
                                    onValueChange={(value) =>
                                        setConfig((current) =>
                                            applyResolution(
                                                current,
                                                'camera_res',
                                                value
                                            )
                                        )
                                    }
                                />
                                <ResolutionSelect
                                    label={t(
                                        'dialog.config_json.spout_resolution'
                                    )}
                                    value={getResolutionKey({
                                        width: getConfigFieldValue(
                                            config,
                                            'camera_spout_res_width'
                                        ),
                                        height: getConfigFieldValue(
                                            config,
                                            'camera_spout_res_height'
                                        )
                                    })}
                                    rows={VRChatScreenshotResolutions}
                                    onValueChange={(value) =>
                                        setConfig((current) =>
                                            applyResolution(
                                                current,
                                                'camera_spout_res',
                                                value
                                            )
                                        )
                                    }
                                />
                            </div>
                        </FieldSet>

                        <FieldSeparator />

                        <Field orientation="horizontal">
                            <Checkbox
                                id="vrchat-config-disable-rich-presence"
                                checked={Boolean(config.disableRichPresence)}
                                onCheckedChange={(checked) =>
                                    setConfig((current) => ({
                                        ...current,
                                        disableRichPresence: Boolean(checked)
                                    }))
                                }
                            />
                            <FieldLabel htmlFor="vrchat-config-disable-rich-presence">
                                {t(
                                    'dialog.config_json.disable_discord_presence'
                                )}
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground sm:mr-auto"
                        onClick={() => {
                            openExternalLink(links.vrchatDocsConfigurationFile);
                        }}
                    >
                        <ExternalLinkIcon data-icon="inline-start" />
                        {t('dialog.config_json.vrchat_docs')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.config_json.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                            handleSave();
                        }}
                    >
                        <SaveIcon data-icon="inline-start" />
                        {t('dialog.config_json.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
