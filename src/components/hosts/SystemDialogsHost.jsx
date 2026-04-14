import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';
import { backend } from '@/platform/index.js';
import { useI18n } from '@/app/hooks/use-i18n.js';
import { configRepository } from '@/repositories/index.js';
import {
    VRChatCameraResolutions,
    VRChatScreenshotResolutions
} from '@/shared/constants/settings.js';
import {
    defaultBranchForVersion,
    downloadUpdateAndWait,
    fetchBranchReleases,
    formatReleaseDisplayVersion,
    sanitizeBranch
} from '@/services/updateService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useModalStore } from '@/state/modalStore.js';
import {
    confirmLegacyDatabaseMigration,
    skipLegacyDatabaseMigration
} from '@/services/databaseUpgradeService.js';
import {
    backupVrcRegistry,
    deleteVrcRegistryBackup,
    deleteVrcRegistryFolder,
    listVrcRegistryBackups,
    restoreVrcRegistryBackup,
    restoreVrcRegistryBackupFromFile,
    saveVrcRegistryBackupToFile
} from '@/services/registryBackupService.js';

function UpdaterDialog({ open, onOpenChange }) {
    const cancelTokenRef = useRef(null);
    const [branch, setBranch] = useState(() => defaultBranchForVersion(VERSION || ''));
    const [releases, setReleases] = useState([]);
    const [releaseVersion, setReleaseVersion] = useState('');
    const [pendingInstall, setPendingInstall] = useState(false);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [detail, setDetail] = useState('');
    const selectedRelease = useMemo(
        () => releases.find((release) => release.canonicalVersion === releaseVersion) || null,
        [releaseVersion, releases]
    );

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setDetail('Checking update state.');

        backend.app
            .CheckForUpdateExe()
            .then((hasPendingInstall) => {
                if (active) {
                    setPendingInstall(Boolean(hasPendingInstall));
                }
            })
            .catch(() => {});

        fetchBranchReleases(branch)
            .then((nextReleases) => {
                if (!active) {
                    return;
                }

                setReleases(nextReleases);
                setReleaseVersion((current) =>
                    nextReleases.some((release) => release.canonicalVersion === current)
                        ? current
                        : nextReleases[0]?.canonicalVersion || ''
                );
                setDetail(nextReleases.length ? '' : 'No downloadable releases found.');
            })
            .catch((error) => {
                if (active) {
                    setDetail(error instanceof Error ? error.message : String(error));
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [branch, open]);

    async function handleDownload() {
        if (!selectedRelease || downloading) {
            return;
        }

        const cancelToken = { cancelled: false };
        cancelTokenRef.current = cancelToken;
        setDownloading(true);
        setProgress(0);
        setDetail(`Downloading ${selectedRelease.displayName}.`);
        try {
            await downloadUpdateAndWait(selectedRelease, {
                onProgress: setProgress,
                isCancelled: () => cancelToken.cancelled
            });
            setPendingInstall(true);
            setDetail(`${selectedRelease.displayName} is ready to install.`);
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            if (cancelTokenRef.current === cancelToken) {
                cancelTokenRef.current = null;
            }
            setDownloading(false);
            setProgress(0);
        }
    }

    async function handleCancel() {
        if (cancelTokenRef.current) {
            cancelTokenRef.current.cancelled = true;
        }
        setDetail('Cancelling update download.');
        await backend.app.CancelUpdate().catch(() => {});
        setProgress(0);
    }

    function handleInstall() {
        void backend.app.RestartApplication(true);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>VRCX Update</DialogTitle>
                    <DialogDescription>
                        Current version {formatReleaseDisplayVersion(VERSION || '') || '-'}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <Tabs value={branch} onValueChange={(value) => setBranch(sanitizeBranch(value))}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="Stable">Stable</TabsTrigger>
                            <TabsTrigger value="Beta">Beta</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Select value={releaseVersion} onValueChange={setReleaseVersion} disabled={loading || downloading}>
                        <SelectTrigger>
                            <SelectValue placeholder={loading ? 'Loading releases' : 'Select release'} />
                        </SelectTrigger>
                        <SelectContent>
                            {releases.map((release) => (
                                <SelectItem key={release.canonicalVersion} value={release.canonicalVersion}>
                                    {release.displayName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {downloading ? (
                        <div className="space-y-2">
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {progress === 100 ? 'Checking hash.' : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {pendingInstall ? (
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
                            An update is downloaded and ready to install.
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-sm text-muted-foreground">{detail}</div>
                    ) : null}
                </div>
                <DialogFooter>
                    {downloading ? (
                        <Button type="button" variant="outline" onClick={() => void handleCancel()}>
                            Cancel
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        disabled={!selectedRelease || loading || downloading}
                        onClick={() => void handleDownload()}>
                        Download
                    </Button>
                    <Button type="button" disabled={downloading || !pendingInstall} onClick={handleInstall}>
                        Install And Restart
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function formatBackupLabel(backup) {
    const date = backup.date ? new Date(backup.date) : null;
    const dateLabel = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString()
        : 'Unknown date';
    return `${backup.name || 'Backup'} - ${dateLabel}`;
}

function RegistryBackupDialog({ open, onOpenChange }) {
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const [backups, setBackups] = useState([]);
    const [selectedKey, setSelectedKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState('');
    const [autoBackup, setAutoBackup] = useState(false);
    const [askRestore, setAskRestore] = useState(false);
    const selectedBackup = useMemo(
        () => backups.find((backup) => backup.key === selectedKey) || null,
        [backups, selectedKey]
    );

    async function refreshBackups() {
        setLoading(true);
        setDetail('');
        try {
            const [nextBackups, nextAutoBackup, nextAskRestore] = await Promise.all([
                listVrcRegistryBackups(),
                configRepository.getBool('vrcRegistryAutoBackup', false),
                configRepository.getBool('vrcRegistryAskRestore', false)
            ]);
            setBackups(nextBackups);
            setAutoBackup(Boolean(nextAutoBackup));
            setAskRestore(Boolean(nextAskRestore));
            setSelectedKey((current) =>
                nextBackups.some((backup) => backup.key === current)
                    ? current
                    : nextBackups[0]?.key || ''
            );
            if (nextBackups.length === 0) {
                setDetail('No VRChat registry backups are saved.');
            }
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleAutoBackupChange(value) {
        const nextValue = Boolean(value);
        setAutoBackup(nextValue);
        try {
            await configRepository.setBool('vrcRegistryAutoBackup', nextValue);
        } catch (error) {
            setAutoBackup(!nextValue);
            setDetail(error instanceof Error ? error.message : String(error));
        }
    }

    async function handleAskRestoreChange(value) {
        const nextValue = Boolean(value);
        setAskRestore(nextValue);
        try {
            await configRepository.setBool('vrcRegistryAskRestore', nextValue);
        } catch (error) {
            setAskRestore(!nextValue);
            setDetail(error instanceof Error ? error.message : String(error));
        }
    }

    useEffect(() => {
        if (open) {
            void refreshBackups();
        }
    }, [open]);

    async function handleCreateBackup() {
        const result = await prompt({
            title: t('prompt.backup_name.header'),
            description: t('prompt.backup_name.description'),
            inputValue: 'Backup',
            pattern: /\S+/,
            errorMessage: t('prompt.backup_name.input_error')
        });
        if (!result.ok) {
            return;
        }
        const backupName = String(result.value || '').trim();
        if (!backupName) {
            return;
        }
        setLoading(true);
        setDetail('Creating VRChat registry backup.');
        try {
            const nextBackups = await backupVrcRegistry(backupName);
            setBackups(nextBackups);
            setSelectedKey(nextBackups[nextBackups.length - 1]?.key || '');
            setDetail('Registry backup saved.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleRestoreBackup() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(`Restoring ${selectedBackup.name}.`);
        try {
            await restoreVrcRegistryBackup(selectedBackup.key);
            setDetail('Registry backup restored.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteBackup() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(`Deleting ${selectedBackup.name}.`);
        try {
            const nextBackups = await deleteVrcRegistryBackup(selectedBackup.key);
            setBackups(nextBackups);
            setSelectedKey(nextBackups[0]?.key || '');
            setDetail('Registry backup deleted.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveBackupToFile() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(`Saving ${selectedBackup.name}.`);
        try {
            const filePath = await saveVrcRegistryBackupToFile(selectedBackup.key);
            setDetail(filePath ? `Registry backup saved to ${filePath}.` : 'Save cancelled.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleRestoreFromFile() {
        setLoading(true);
        setDetail('Restoring registry backup from file.');
        try {
            const restored = await restoreVrcRegistryBackupFromFile();
            setDetail(restored ? 'Registry backup restored from file.' : 'Restore cancelled.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteRegistryFolder() {
        const result = await confirm({
            title: 'Delete VRChat registry',
            description: 'Delete the VRChat registry folder. This matches the old reset action and cannot be undone from here.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setLoading(true);
        setDetail('Deleting VRChat registry folder.');
        try {
            await deleteVrcRegistryFolder();
            setDetail('VRChat registry folder deleted.');
        } catch (error) {
            setDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>VRChat Registry Backup</DialogTitle>
                    <DialogDescription>
                        Create, restore, or remove saved VRChat registry backups.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2 rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                            <span>Auto backup</span>
                            <Switch checked={autoBackup} disabled={loading} onCheckedChange={(value) => void handleAutoBackupChange(value)} />
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <span>Ask to restore</span>
                            <Switch checked={askRestore} disabled={loading} onCheckedChange={(value) => void handleAskRestoreChange(value)} />
                        </div>
                    </div>
                    <Select
                        value={selectedKey}
                        onValueChange={setSelectedKey}
                        disabled={loading || backups.length === 0}>
                        <SelectTrigger>
                            <SelectValue placeholder={loading ? 'Loading backups' : 'Select backup'} />
                        </SelectTrigger>
                        <SelectContent>
                            {backups.map((backup) => (
                                <SelectItem key={backup.key} value={backup.key}>
                                    {formatBackupLabel(backup)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {selectedBackup ? (
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
                            <div>Name: {selectedBackup.name}</div>
                            <div>Date: {selectedBackup.date || 'Unknown'}</div>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-sm text-muted-foreground">{detail}</div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={loading} onClick={() => void refreshBackups()}>
                        Refresh
                    </Button>
                    <Button type="button" variant="outline" disabled={loading} onClick={() => void handleCreateBackup()}>
                        Create Backup
                    </Button>
                    <Button type="button" variant="outline" disabled={loading || !selectedBackup} onClick={() => void handleDeleteBackup()}>
                        Delete
                    </Button>
                    <Button type="button" variant="outline" disabled={loading || !selectedBackup} onClick={() => void handleSaveBackupToFile()}>
                        Save To File
                    </Button>
                    <Button type="button" variant="outline" disabled={loading} onClick={() => void handleRestoreFromFile()}>
                        Restore From File
                    </Button>
                    <Button type="button" variant="destructive" disabled={loading} onClick={() => void handleDeleteRegistryFolder()}>
                        Reset
                    </Button>
                    <Button type="button" disabled={loading || !selectedBackup} onClick={() => void handleRestoreBackup()}>
                        Restore
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function LaunchOptionsDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const [launchArguments, setLaunchArguments] = useState('');
    const [vrcLaunchPathOverride, setVrcLaunchPathOverride] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        Promise.all([
            configRepository.getString('launchArguments', ''),
            configRepository.getString('vrcLaunchPathOverride', '')
        ])
            .then(([nextLaunchArguments, nextLaunchPath]) => {
                if (!active) {
                    return;
                }
                const normalizedLaunchPath =
                    nextLaunchPath && nextLaunchPath !== 'null' ? nextLaunchPath : '';
                setLaunchArguments(nextLaunchArguments || '');
                setVrcLaunchPathOverride(normalizedLaunchPath);
                if (nextLaunchPath === 'null') {
                    void configRepository.setString('vrcLaunchPathOverride', '');
                }
            })
            .catch((error) => {
                toast.error(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [open]);

    async function handleSave() {
        const normalizedArguments = String(launchArguments).replace(/\s+/g, ' ').trim();
        if (
            vrcLaunchPathOverride &&
            vrcLaunchPathOverride.endsWith('.exe') &&
            !vrcLaunchPathOverride.endsWith('launch.exe')
        ) {
            toast.error(t('message.launch.invalid_path'));
            return;
        }

        setLoading(true);
        try {
            await Promise.all([
                configRepository.setString('launchArguments', normalizedArguments),
                configRepository.setString('vrcLaunchPathOverride', vrcLaunchPathOverride)
            ]);
            setLaunchArguments(normalizedArguments);
            toast.success('Updated launch options');
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.launch_options.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.launch_options.description')} {t('dialog.launch_options.example')}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                        <div>--fps=144</div>
                        <div>--enable-debug-gui</div>
                        <div>--enable-sdk-log-levels</div>
                        <div>--enable-udon-debug-logging</div>
                    </div>
                    <div className="space-y-2">
                        <Label>{t('dialog.launch_options.header')}</Label>
                        <Textarea
                            rows={3}
                            value={launchArguments}
                            placeholder="e.g. --fps=144 --enable-sdk-log-levels"
                            onChange={(event) => setLaunchArguments(event.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('dialog.launch_options.path_override')}</Label>
                        <Input
                            value={vrcLaunchPathOverride}
                            placeholder="C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe"
                            spellCheck={false}
                            onChange={(event) => setVrcLaunchPathOverride(event.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void backend.app.OpenLink('https://docs.vrchat.com/docs/launch-options')}>
                        {t('dialog.launch_options.vrchat_docs')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void backend.app.OpenLink('https://docs.unity3d.com/Manual/CommandLineArguments.html')}>
                        {t('dialog.launch_options.unity_manual')}
                    </Button>
                    <Button type="button" disabled={loading} onClick={() => void handleSave()}>
                        {t('dialog.launch_options.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

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

function VRChatConfigDialog({ open, onOpenChange }) {
    const { t } = useI18n();
    const confirm = useModalStore((state) => state.confirm);
    const [config, setConfig] = useState({ picture_output_split_by_date: true });
    const [cacheSize, setCacheSize] = useState('');
    const [loading, setLoading] = useState(false);

    const configFields = useMemo(
        () => [
            ['cache_size', t('dialog.config_json.max_cache_size'), '30', 'number'],
            ['cache_expiry_delay', t('dialog.config_json.cache_expiry_delay'), '30', 'number'],
            ['cache_directory', t('dialog.config_json.cache_directory'), '%AppData%\\..\\LocalLow\\VRChat\\VRChat', 'text'],
            ['picture_output_folder', t('dialog.config_json.picture_directory'), '%UserProfile%\\Pictures\\VRChat', 'text'],
            ['fpv_steadycam_fov', t('dialog.config_json.fpv_steadycam_fov'), '50', 'number']
        ],
        [t]
    );

    async function loadConfig() {
        setLoading(true);
        try {
            const [configJson, nextCacheSize] = await Promise.all([
                backend.app.ReadConfigFileSafe(),
                backend.assetBundle.GetCacheSize().catch(() => 0)
            ]);
            const parsed = configJson ? JSON.parse(configJson) : {};
            setConfig({
                picture_output_split_by_date: true,
                ...parsed
            });
            const cacheBytes = Number(nextCacheSize) || 0;
            setCacheSize(cacheBytes > 0 ? `${(cacheBytes / 1024 / 1024 / 1024).toFixed(2)} GB` : '0 GB');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (open) {
            void loadConfig();
        }
    }, [open]);

    async function openFolderBrowser(key) {
        const selected = await backend.app.OpenFolderSelectorDialog(config[key] || '').catch((error) => {
            toast.error(error instanceof Error ? error.message : String(error));
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
            toast.success(Array.isArray(removed) ? `Removed ${removed.length} cache entries.` : t('message.cache.deleted'));
            await loadConfig();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
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
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setLoading(true);
        try {
            const json = JSON.stringify(normalizeVrchatConfigForSave(config), null, '\t');
            await backend.app.WriteConfigFile(json);
            toast.success('Saved VRChat config.');
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
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
                        {t('dialog.config_json.description1')} {t('dialog.config_json.description2')}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                        <span>{t('dialog.config_json.cache_size')}: {cacheSize}</span>
                        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadConfig()}>
                            {t('dialog.config_json.refresh')}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void handleDeleteAllCache()}>
                            {t('dialog.config_json.delete_cache')}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void handleSweepCache()}>
                            {t('dialog.config_json.sweep_cache')}
                        </Button>
                    </div>

                    {configFields.map(([key, label, placeholder, type]) => (
                        <div key={key} className="space-y-2">
                            <Label>{label}</Label>
                            <div className="flex gap-2">
                                <Input
                                    type={type}
                                    value={config[key] ?? ''}
                                    placeholder={placeholder}
                                    onChange={(event) =>
                                        setConfig((current) => ({ ...current, [key]: event.target.value }))
                                    }
                                />
                                {key.endsWith('_directory') || key.endsWith('_folder') ? (
                                    <Button type="button" variant="outline" onClick={() => void openFolderBrowser(key)}>
                                        Browse
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    ))}

                    <div className="grid gap-4 md:grid-cols-3">
                        <ResolutionSelect
                            label={t('dialog.config_json.camera_resolution')}
                            value={getResolutionKey({ width: config.camera_res_width, height: config.camera_res_height })}
                            rows={VRChatCameraResolutions}
                            onValueChange={(value) => setConfig((current) => applyResolution(current, 'camera_res', value))}
                        />
                        <ResolutionSelect
                            label={t('dialog.config_json.spout_resolution')}
                            value={getResolutionKey({ width: config.camera_spout_res_width, height: config.camera_spout_res_height })}
                            rows={VRChatScreenshotResolutions}
                            onValueChange={(value) => setConfig((current) => applyResolution(current, 'camera_spout_res', value))}
                        />
                        <ResolutionSelect
                            label={t('dialog.config_json.screenshot_resolution')}
                            value={getResolutionKey({ width: config.screenshot_res_width, height: config.screenshot_res_height })}
                            rows={VRChatScreenshotResolutions}
                            onValueChange={(value) => setConfig((current) => applyResolution(current, 'screenshot_res', value))}
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={Boolean(config.picture_output_split_by_date)}
                            onCheckedChange={(checked) =>
                                setConfig((current) => ({ ...current, picture_output_split_by_date: Boolean(checked) }))
                            }
                        />
                        {t('dialog.config_json.picture_sort_by_date')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={Boolean(config.disableRichPresence)}
                            onCheckedChange={(checked) =>
                                setConfig((current) => ({ ...current, disableRichPresence: Boolean(checked) }))
                            }
                        />
                        {t('dialog.config_json.disable_discord_presence')}
                    </label>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void backend.app.OpenLink('https://docs.vrchat.com/docs/configuration-file')}>
                        {t('dialog.config_json.vrchat_docs')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('dialog.config_json.cancel')}
                    </Button>
                    <Button type="button" disabled={loading} onClick={() => void handleSave()}>
                        {t('dialog.config_json.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ResolutionSelect({ label, value, rows, onValueChange }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Select value={value} onValueChange={onValueChange}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {rows.map((row) => (
                        <SelectItem key={row.name} value={getResolutionKey(row)}>
                            {row.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

function getDatabaseUpgradeTitle(phase) {
    switch (phase) {
        case 'confirm-legacy-migration':
            return 'Legacy VRCX Migration';
        case 'running':
            return 'Database Upgrade Running';
        case 'restarting':
            return 'Restarting for Migration';
        case 'error':
            return 'Database Upgrade Failed';
        default:
            return 'Database Upgrade';
    }
}

export function SystemDialogsHost() {
    const systemHosts = useRuntimeStore((state) => state.systemHosts);
    const databaseUpgrade = useRuntimeStore((state) => state.databaseUpgrade);
    const setSystemHostOpen = useRuntimeStore((state) => state.setSystemHostOpen);
    const setDatabaseUpgradeState = useRuntimeStore((state) => state.setDatabaseUpgradeState);

    return (
        <>
            <UpdaterDialog
                open={Boolean(systemHosts.updaterOpen)}
                onOpenChange={(open) => setSystemHostOpen('updaterOpen', open)}
            />
            <RegistryBackupDialog
                open={Boolean(systemHosts.registryBackupOpen)}
                onOpenChange={(open) => setSystemHostOpen('registryBackupOpen', open)}
            />
            <LaunchOptionsDialog
                open={Boolean(systemHosts.launchOptionsOpen)}
                onOpenChange={(open) => setSystemHostOpen('launchOptionsOpen', open)}
            />
            <VRChatConfigDialog
                open={Boolean(systemHosts.vrchatConfigOpen)}
                onOpenChange={(open) => setSystemHostOpen('vrchatConfigOpen', open)}
            />
            <Dialog
                open={Boolean(databaseUpgrade.open || systemHosts.databaseUpgradeOpen)}
                onOpenChange={(open) => {
                    if (!open && databaseUpgrade.phase === 'running') {
                        return;
                    }
                    setDatabaseUpgradeState({ open });
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{getDatabaseUpgradeTitle(databaseUpgrade.phase)}</DialogTitle>
                        <DialogDescription>
                            {databaseUpgrade.detail || 'Local database migration status.'}
                        </DialogDescription>
                    </DialogHeader>
                    {databaseUpgrade.fromVersion || databaseUpgrade.toVersion ? (
                        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                            {`Version ${databaseUpgrade.fromVersion || 0} -> ${databaseUpgrade.toVersion || 0}`}
                        </div>
                    ) : null}
                    <DialogFooter>
                        {databaseUpgrade.phase === 'confirm-legacy-migration' ? (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        void skipLegacyDatabaseMigration();
                                    }}>
                                    Skip
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => {
                                        void confirmLegacyDatabaseMigration();
                                    }}>
                                    Migrate And Restart
                                </Button>
                            </>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={databaseUpgrade.phase === 'running'}
                                onClick={() => setDatabaseUpgradeState({ open: false })}>
                                Close
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
