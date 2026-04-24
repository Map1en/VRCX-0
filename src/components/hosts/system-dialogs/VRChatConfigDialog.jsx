import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import {
    VRChatCameraResolutions,
    VRChatScreenshotResolutions
} from '@/shared/constants/settings.js';
import { useModalStore } from '@/state/modalStore.js';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

function getResolutionKey(row) {
    const width = Number(row?.width);
    const height = Number(row?.height);
    return width > 0 && height > 0 ? `${width}x${height}` : '__default__';
}

function applyResolution(config, keyPrefix, value) {
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

function normalizeVrchatConfigForSave(config) {
    const output = { ...config };
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

function ResolutionSelect({ label, value, rows, onValueChange }) {
    return (
        <Field>
            <FieldLabel>{label}</FieldLabel>
            <Select value={value} onValueChange={onValueChange}>
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

export function VRChatConfigDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const loadRequestRef = useRef(0);
    const [config, setConfig] = useState({
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
                backend.app.ReadConfigFileSafe(),
                backend.assetBundle.GetCacheSize().catch(() => 0)
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
                    t('host.system_dialogs.generated_toast.failed_to_load_vrchat_configuration')
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
            void loadConfig();
        } else {
            loadRequestRef.current += 1;
        }
    }, [open]);

    async function openFolderBrowser(key) {
        const selected = await backend.app
            .OpenFolderSelectorDialog(config[key] || '')
            .catch((error) => {
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t('host.system_dialogs.generated_toast.failed_to_select_folder')
                    )
                );
                return '';
            });
        if (selected) {
            setConfig((current) => ({ ...current, [key]: selected }));
        }
    }

    async function handleSweepCache() {
        setLoading(true);
        try {
            const removed = await backend.assetBundle.SweepCache();
            toast.success(
                Array.isArray(removed)
                    ? t(
                          'host.system_dialogs.generated_toast.removed_value_cache_entries',
                          { value: removed.length }
                      )
                    : t('message.cache.deleted')
            );
            await loadConfig();
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.generated_toast.failed_to_sweep_asset_cache')
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
            await backend.assetBundle.DeleteAllCache();
            toast.success(t('message.cache.deleted'));
            await loadConfig();
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.generated_toast.failed_to_delete_asset_cache')
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
            await backend.app.WriteConfigFile(json);
            toast.success(t('dialog.system.generated.saved_vrchat_config'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('host.system_dialogs.generated_toast.failed_to_save_vrchat_configuration')
                )
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('dialog.config_json.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.config_json.description1')}{' '}
                        {t('dialog.config_json.description2')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <div className="bg-muted/30 flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                        <span>
                            {t('dialog.config_json.cache_size')}: {cacheSize}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => void loadConfig()}
                        >
                            {t('dialog.config_json.refresh')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => void handleDeleteAllCache()}
                        >
                            {t('dialog.config_json.delete_cache')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => void handleSweepCache()}
                        >
                            {t('dialog.config_json.sweep_cache')}
                        </Button>
                    </div>

                    {configFields.map(([key, label, placeholder, type]) => (
                        <Field key={key}>
                            <FieldLabel htmlFor={`config-json-${key}`}>
                                {label}
                            </FieldLabel>
                            <div className="flex gap-2">
                                <Input
                                    id={`config-json-${key}`}
                                    type={type}
                                    value={config[key] ?? ''}
                                    placeholder={placeholder}
                                    onChange={(event) =>
                                        setConfig((current) => ({
                                            ...current,
                                            [key]: event.target.value
                                        }))
                                    }
                                />
                                {key.endsWith('_directory') ||
                                key.endsWith('_folder') ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() =>
                                            void openFolderBrowser(key)
                                        }
                                    >
                                        {t('dialog.screenshot_metadata.browse')}
                                    </Button>
                                ) : null}
                            </div>
                        </Field>
                    ))}

                    <div className="grid gap-4 md:grid-cols-3">
                        <ResolutionSelect
                            label={t('dialog.config_json.camera_resolution')}
                            value={getResolutionKey({
                                width: config.camera_res_width,
                                height: config.camera_res_height
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
                            label={t('dialog.config_json.spout_resolution')}
                            value={getResolutionKey({
                                width: config.camera_spout_res_width,
                                height: config.camera_spout_res_height
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
                        <ResolutionSelect
                            label={t(
                                'dialog.config_json.screenshot_resolution'
                            )}
                            value={getResolutionKey({
                                width: config.screenshot_res_width,
                                height: config.screenshot_res_height
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
                            {t('dialog.config_json.picture_sort_by_date')}
                        </FieldLabel>
                    </Field>
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
                            {t('dialog.config_json.disable_discord_presence')}
                        </FieldLabel>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            void backend.app.OpenLink(
                                'https://docs.vrchat.com/docs/configuration-file'
                            )
                        }
                    >
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
                        onClick={() => void handleSave()}
                    >
                        {t('dialog.config_json.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
