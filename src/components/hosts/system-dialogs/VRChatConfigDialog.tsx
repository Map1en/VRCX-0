import {
    ExternalLinkIcon,
    FolderOpenIcon,
    RefreshCwIcon,
    SaveIcon,
    SparklesIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import {
    openExternalLink,
    openFolderSelectorDialog,
    readVrchatConfigFileSafe,
    writeVrchatConfigFile
} from '@/services/shellIntegrationService';
import {
    VRChatCameraResolutions,
    VRChatScreenshotResolutions
} from '@/shared/constants/settings';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

function getResolutionKey(row: any) {
    const width = Number(row?.width);
    const height = Number(row?.height);
    return width > 0 && height > 0 ? `${width}x${height}` : '__default__';
}

function applyResolution(config: any, keyPrefix: any, value: any) {
    if (value === '__default__') {
        return {
            ...config,
            [`${keyPrefix}_width`]: '',
            [`${keyPrefix}_height`]: ''
        };
    }

    const [width, height] = value.split('x');
    return {
        ...config,
        [`${keyPrefix}_width`]: Number(width) || '',
        [`${keyPrefix}_height`]: Number(height) || ''
    };
}

function normalizeVrchatConfigForSave(config: any) {
    const output: any = { ...config };
    for (const key of Object.keys(output)) {
        if (key === 'picture_output_split_by_date') {
            if (output[key]) {
                delete output[key];
            }
        } else if (output[key] === '' || output[key] === false) {
            delete output[key];
        } else if (typeof output[key] === 'string') {
            const parsed = Number.parseInt(output[key], 10);
            if (!Number.isNaN(parsed)) {
                output[key] = parsed;
            }
        }
    }
    return output;
}

function ResolutionSelect({ label, value, rows, onValueChange }: any) {
    return (
        <Field>
            <FieldLabel>{label}</FieldLabel>
            <Select value={value} onValueChange={onValueChange}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {rows.map((row: any) => (
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

export function VRChatConfigDialog({ open, onOpenChange }: any) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const loadRequestRef = useRef(0);
    const [config, setConfig] = useState<any>({
        picture_output_split_by_date: true
    });
    const [cacheSize, setCacheSize] = useState('');
    const [loading, setLoading] = useState(false);

    const configFields = useMemo(
        () => [
            [
                'cache_size',
                t('dialog.config_json.max_cache_size'),
                '30',
                'number'
            ],
            [
                'cache_expiry_delay',
                t('dialog.config_json.cache_expiry_delay'),
                '30',
                'number'
            ],
            [
                'cache_directory',
                t('dialog.config_json.cache_directory'),
                '%AppData%\\..\\LocalLow\\VRChat\\VRChat',
                'text'
            ],
            [
                'picture_output_folder',
                t('dialog.config_json.picture_directory'),
                '%UserProfile%\\Pictures\\VRChat',
                'text'
            ],
            [
                'fpv_steadycam_fov',
                t('dialog.config_json.fpv_steadycam_fov'),
                '50',
                'number'
            ]
        ],
        [t]
    );

    async function loadConfig() {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        try {
            const [configJson, nextCacheSize] = await Promise.all([
                readVrchatConfigFileSafe(),
                assetBundleRepository.getCacheSize().catch(() => 0)
            ]);
            if (requestId !== loadRequestRef.current) {
                return;
            }
            const parsed = configJson ? JSON.parse(configJson) : {};
            setConfig({
                picture_output_split_by_date: true,
                ...parsed
            });
            const cacheBytes = Number(nextCacheSize) || 0;
            setCacheSize(
                cacheBytes > 0
                    ? `${(cacheBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
                    : '0 GB'
            );
        } catch (error) {
            if (requestId !== loadRequestRef.current) {
                return;
            }
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.system_dialogs.toast.failed_to_load_vrchat_configuration'
                    )
                )
            );
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            loadConfig();
        } else {
            loadRequestRef.current += 1;
        }
    }, [open]);

    async function openFolderBrowser(key: any) {
        const selected = await openFolderSelectorDialog(
            config[key] || ''
        ).catch((error: any) => {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_select_folder')
                )
            );
            return '';
        });
        if (selected) {
            setConfig((current: any) => ({ ...current, [key]: selected }));
        }
    }

    async function handleSweepCache() {
        setLoading(true);
        try {
            const removed = await assetBundleRepository.sweepCache();
            toast.success(
                Array.isArray(removed)
                    ? t(
                          'host.system_dialogs.toast.removed_value_cache_entries',
                          { value: removed.length }
                      )
                    : t('message.cache.deleted')
            );
            await loadConfig();
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_sweep_asset_cache')
                )
            );
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
            toast.success(t('message.cache.deleted'));
            await loadConfig();
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.toast.failed_to_delete_asset_cache')
                )
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setLoading(true);
        try {
            const json = JSON.stringify(
                normalizeVrchatConfigForSave(config),
                null,
                '\t'
            );
            await writeVrchatConfigFile(json);
            toast.success(t('dialog.system.success.saved_vrchat_config'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t(
                        'host.system_dialogs.toast.failed_to_save_vrchat_configuration'
                    )
                )
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[85vh] w-[calc(100%-2rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.config_json.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.config_json.description1')}{' '}
                        {t('dialog.config_json.description2')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)_18rem] lg:overflow-hidden lg:pr-0">
                    <div className="min-h-0 lg:overflow-y-auto lg:pr-1">
                        <FieldGroup>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {configFields.map(
                                    ([key, label, placeholder, type]: any) => {
                                        const isPathField =
                                            key.endsWith('_directory') ||
                                            key.endsWith('_folder');

                                        return (
                                            <Field
                                                key={key}
                                                className={cn(
                                                    isPathField &&
                                                        'md:col-span-2 xl:col-span-3'
                                                )}
                                            >
                                                <FieldLabel
                                                    htmlFor={`config-json-${key}`}
                                                >
                                                    {label}
                                                </FieldLabel>
                                                {isPathField ? (
                                                    <InputGroup>
                                                        <InputGroupInput
                                                            id={`config-json-${key}`}
                                                            type={type}
                                                            value={
                                                                config[key] ??
                                                                ''
                                                            }
                                                            placeholder={
                                                                placeholder
                                                            }
                                                            onChange={(
                                                                event: any
                                                            ) =>
                                                                setConfig(
                                                                    (
                                                                        current: any
                                                                    ) => ({
                                                                        ...current,
                                                                        [key]: event
                                                                            .target
                                                                            .value
                                                                    })
                                                                )
                                                            }
                                                        />
                                                        <InputGroupAddon align="inline-end">
                                                            <InputGroupButton
                                                                type="button"
                                                                onClick={() => {
                                                                    openFolderBrowser(
                                                                        key
                                                                    );
                                                                }}
                                                            >
                                                                <FolderOpenIcon data-icon="inline-start" />
                                                                {t(
                                                                    'dialog.screenshot_metadata.browse'
                                                                )}
                                                            </InputGroupButton>
                                                        </InputGroupAddon>
                                                    </InputGroup>
                                                ) : (
                                                    <Input
                                                        id={`config-json-${key}`}
                                                        type={type}
                                                        value={
                                                            config[key] ?? ''
                                                        }
                                                        placeholder={
                                                            placeholder
                                                        }
                                                        onChange={(
                                                            event: any
                                                        ) =>
                                                            setConfig(
                                                                (
                                                                    current: any
                                                                ) => ({
                                                                    ...current,
                                                                    [key]: event
                                                                        .target
                                                                        .value
                                                                })
                                                            )
                                                        }
                                                    />
                                                )}
                                            </Field>
                                        );
                                    }
                                )}
                            </div>

                            <div className="grid gap-4 md:grid-cols-3">
                                <ResolutionSelect
                                    label={t(
                                        'dialog.config_json.camera_resolution'
                                    )}
                                    value={getResolutionKey({
                                        width: config.camera_res_width,
                                        height: config.camera_res_height
                                    })}
                                    rows={VRChatCameraResolutions}
                                    onValueChange={(value: any) =>
                                        setConfig((current: any) =>
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
                                        width: config.camera_spout_res_width,
                                        height: config.camera_spout_res_height
                                    })}
                                    rows={VRChatScreenshotResolutions}
                                    onValueChange={(value: any) =>
                                        setConfig((current: any) =>
                                            applyResolution(
                                                current,
                                                'camera_spout_res',
                                                value
                                            )
                                        )
                                    }
                                />
                                <ResolutionSelect
                                    label={t(
                                        'dialog.config_json.screenshot_resolution'
                                    )}
                                    value={getResolutionKey({
                                        width: config.screenshot_res_width,
                                        height: config.screenshot_res_height
                                    })}
                                    rows={VRChatScreenshotResolutions}
                                    onValueChange={(value: any) =>
                                        setConfig((current: any) =>
                                            applyResolution(
                                                current,
                                                'screenshot_res',
                                                value
                                            )
                                        )
                                    }
                                />
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="vrchat-config-picture-sort-by-date"
                                        checked={Boolean(
                                            config.picture_output_split_by_date
                                        )}
                                        onCheckedChange={(checked: any) =>
                                            setConfig((current: any) => ({
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
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="vrchat-config-disable-rich-presence"
                                        checked={Boolean(
                                            config.disableRichPresence
                                        )}
                                        onCheckedChange={(checked: any) =>
                                            setConfig((current: any) => ({
                                                ...current,
                                                disableRichPresence:
                                                    Boolean(checked)
                                            }))
                                        }
                                    />
                                    <FieldLabel htmlFor="vrchat-config-disable-rich-presence">
                                        {t(
                                            'dialog.config_json.disable_discord_presence'
                                        )}
                                    </FieldLabel>
                                </Field>
                            </div>
                        </FieldGroup>
                    </div>
                    <div className="min-h-0 p-px lg:overflow-y-auto">
                        <Card size="sm">
                            <CardHeader>
                                <CardTitle>
                                    {t('dialog.config_json.cache_size')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                                <div className="bg-muted/30 rounded-lg border p-3">
                                    <div className="font-mono text-lg leading-none">
                                        {cacheSize}
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    className="justify-start"
                                    onClick={() => {
                                        loadConfig();
                                    }}
                                >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    {t('dialog.config_json.refresh')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    className="justify-start"
                                    onClick={() => {
                                        handleDeleteAllCache();
                                    }}
                                >
                                    <Trash2Icon data-icon="inline-start" />
                                    {t('dialog.config_json.delete_cache')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading}
                                    className="justify-start"
                                    onClick={() => {
                                        handleSweepCache();
                                    }}
                                >
                                    <SparklesIcon data-icon="inline-start" />
                                    {t('dialog.config_json.sweep_cache')}
                                </Button>
                            </CardContent>
                            <CardFooter className="flex-col items-stretch gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="justify-start"
                                    onClick={() => {
                                        openExternalLink(
                                            'https://docs.vrchat.com/docs/configuration-file'
                                        );
                                    }}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    {t('dialog.config_json.vrchat_docs')}
                                </Button>
                            </CardFooter>
                        </Card>
                    </div>
                </div>
                <DialogFooter>
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
