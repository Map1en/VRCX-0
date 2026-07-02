import {
    ChevronDownIcon,
    FileTextIcon,
    FolderOpenIcon,
    RefreshCwIcon,
    SquareIcon,
    WrenchIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { languageCodes } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import {
    loadLocalCommunityThemePreview,
    startLocalCommunityThemePreviewWatch,
    stopLocalCommunityThemePreview,
    stopLocalCommunityThemePreviewWatch
} from '@/services/communityThemeService';
import {
    detectLangFromPath,
    isI18nWatchActive,
    loadI18nFromFile,
    startI18nWatch,
    stopI18nWatch
} from '@/services/i18nDevService';
import { isDevKitBuild } from '@/shared/buildLabel';
import { useCommunityThemeStore } from '@/state/communityThemeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

const STORAGE_THEME_PATH = 'devkit:theme:folderPath';
const STORAGE_I18N_PATH = 'devkit:i18n:filePath';
const STORAGE_I18N_LANG = 'devkit:i18n:targetLang';

export function DevKitPanel() {
    if (!isDevKitBuild()) {
        return null;
    }
    return <DevKitPanelInner />;
}

function DevKitPanelInner() {
    const [open, setOpen] = useState(false);
    const [themeOpen, setThemeOpen] = useState(true);
    const [i18nOpen, setI18nOpen] = useState(true);

    const localPreview = useCommunityThemeStore((s) => s.localPreview);
    const localPreviewWatch = useCommunityThemeStore(
        (s) => s.localPreviewWatch
    );
    const [themeFolderPath, setThemeFolderPath] = useState(() => {
        const stored = localStorage.getItem(STORAGE_THEME_PATH);
        if (stored) return stored;
        const s = useCommunityThemeStore.getState();
        return (
            s.localPreview?.folderPath || s.localPreviewWatch.folderPath || ''
        );
    });
    const [themeLoading, setThemeLoading] = useState(false);
    const [themeError, setThemeError] = useState<string | null>(null);

    const [i18nFilePath, setI18nFilePath] = useState(
        () => localStorage.getItem(STORAGE_I18N_PATH) || ''
    );
    const [i18nTargetLang, setI18nTargetLang] = useState(() => {
        const stored = localStorage.getItem(STORAGE_I18N_LANG) ?? '';
        return languageCodes.includes(stored) ? stored : 'en';
    });
    const [i18nWatchEnabled, setI18nWatchEnabled] = useState(() =>
        isI18nWatchActive()
    );
    const [i18nStatus, setI18nStatus] = useState<string | null>(null);
    const [i18nError, setI18nError] = useState<string | null>(null);

    useEffect(() => {
        const next = localPreview?.folderPath || localPreviewWatch.folderPath;
        if (next) setThemeFolderPath(next);
    }, [localPreview?.folderPath, localPreviewWatch.folderPath]);

    useEffect(() => {
        if (themeFolderPath)
            localStorage.setItem(STORAGE_THEME_PATH, themeFolderPath);
    }, [themeFolderPath]);

    useEffect(() => {
        if (i18nFilePath) localStorage.setItem(STORAGE_I18N_PATH, i18nFilePath);
    }, [i18nFilePath]);

    useEffect(() => {
        localStorage.setItem(STORAGE_I18N_LANG, i18nTargetLang);
    }, [i18nTargetLang]);

    async function doLoadTheme(path: string = themeFolderPath) {
        const p = path.trim();
        if (!p) return;
        setThemeLoading(true);
        setThemeError(null);
        try {
            await loadLocalCommunityThemePreview(p);
            if (localPreviewWatch.enabled) {
                startLocalCommunityThemePreviewWatch(p);
            }
        } catch (err) {
            setThemeError(userFacingErrorMessage(err));
        } finally {
            setThemeLoading(false);
        }
    }

    async function pickThemeFolder() {
        try {
            const folder = await commands.appOpenFolderSelectorDialog(
                themeFolderPath || null
            );
            if (!folder) return;
            setThemeFolderPath(folder);
            await doLoadTheme(folder);
        } catch (err) {
            setThemeError(userFacingErrorMessage(err));
        }
    }

    function toggleThemeWatch() {
        if (localPreviewWatch.enabled) {
            stopLocalCommunityThemePreviewWatch();
        } else if (themeFolderPath.trim()) {
            startLocalCommunityThemePreviewWatch(themeFolderPath.trim());
        }
    }

    async function doLoadI18n(
        filePath: string = i18nFilePath,
        lang: string = i18nTargetLang
    ) {
        if (!filePath.trim()) return;
        setI18nError(null);
        try {
            await loadI18nFromFile(filePath, lang);
            setI18nStatus(`Loaded ${new Date().toLocaleTimeString()}`);
        } catch (err) {
            setI18nError(userFacingErrorMessage(err));
            setI18nStatus(null);
        }
    }

    async function pickI18nFile() {
        try {
            const filePath = await commands.appOpenFileSelectorDialog(
                i18nFilePath || null,
                '.json',
                'JSON Files (*.json)|*.json'
            );
            if (!filePath) return;
            const detected = detectLangFromPath(filePath);
            const lang = detected ?? i18nTargetLang;
            setI18nFilePath(filePath);
            if (detected) setI18nTargetLang(detected);
            await doLoadI18n(filePath, lang);
        } catch (err) {
            setI18nError(userFacingErrorMessage(err));
        }
    }

    function toggleI18nWatch() {
        if (i18nWatchEnabled) {
            stopI18nWatch();
            setI18nWatchEnabled(false);
        } else if (i18nFilePath.trim()) {
            startI18nWatch(i18nFilePath.trim(), i18nTargetLang, (result) => {
                if (result.error) {
                    setI18nError(result.error);
                } else {
                    setI18nError(null);
                    setI18nStatus(`Loaded ${result.loadedAt}`);
                }
            });
            setI18nWatchEnabled(true);
        }
    }

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="DevKit"
                className="bg-primary text-primary-foreground fixed right-4 bottom-4 z-50 flex h-8 w-8 items-center justify-center rounded-full opacity-40 shadow-lg transition-opacity hover:opacity-100"
            >
                <WrenchIcon className="h-4 w-4" />
            </button>
        );
    }

    return (
        <div className="bg-card text-card-foreground fixed right-4 bottom-4 z-50 w-80 overflow-hidden rounded-lg border shadow-xl">
            <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <WrenchIcon className="text-muted-foreground h-3.5 w-3.5" />
                    <span className="text-xs font-semibold">DevKit</span>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    <XIcon className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="flex max-h-[80vh] flex-col gap-2 overflow-y-auto p-2">
                {/* Theme section */}
                <Collapsible open={themeOpen} onOpenChange={setThemeOpen}>
                    <div className="rounded-md border px-2.5 py-2">
                        <CollapsibleTrigger className="flex w-full items-center justify-between">
                            <span className="text-xs font-medium">
                                Theme Dev
                            </span>
                            <ChevronDownIcon
                                className={cn(
                                    'h-3 w-3 opacity-60 transition-transform',
                                    themeOpen && 'rotate-180'
                                )}
                            />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="mt-2 flex flex-col gap-2">
                                <div className="bg-muted/30 border-input min-h-7 rounded border px-2 py-1 font-mono text-[10px] break-all">
                                    {themeFolderPath || 'No folder selected'}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={themeLoading}
                                        onClick={pickThemeFolder}
                                    >
                                        <FolderOpenIcon className="h-3 w-3" />
                                        Pick
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={
                                            themeLoading ||
                                            !themeFolderPath.trim()
                                        }
                                        onClick={() => doLoadTheme()}
                                    >
                                        <RefreshCwIcon className="h-3 w-3" />
                                        Reload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={
                                            localPreviewWatch.enabled
                                                ? 'default'
                                                : 'outline'
                                        }
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={!themeFolderPath.trim()}
                                        onClick={toggleThemeWatch}
                                    >
                                        <RefreshCwIcon className="h-3 w-3" />
                                        {localPreviewWatch.enabled
                                            ? 'Watching'
                                            : 'Watch'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={!localPreview}
                                        onClick={() =>
                                            void stopLocalCommunityThemePreview()
                                        }
                                    >
                                        <SquareIcon className="h-3 w-3" />
                                        Stop
                                    </Button>
                                </div>
                                {(localPreviewWatch.error ?? themeError) ? (
                                    <p className="text-destructive text-[10px]">
                                        {localPreviewWatch.error ?? themeError}
                                    </p>
                                ) : null}
                                {localPreview ? (
                                    <p className="text-muted-foreground text-[10px]">
                                        {localPreview.themeName}
                                        {localPreview.version
                                            ? ` v${localPreview.version}`
                                            : ''}{' '}
                                        · {localPreview.cssLength} chars
                                    </p>
                                ) : null}
                            </div>
                        </CollapsibleContent>
                    </div>
                </Collapsible>

                {/* i18n section */}
                <Collapsible open={i18nOpen} onOpenChange={setI18nOpen}>
                    <div className="rounded-md border px-2.5 py-2">
                        <CollapsibleTrigger className="flex w-full items-center justify-between">
                            <span className="text-xs font-medium">
                                i18n Dev
                            </span>
                            <ChevronDownIcon
                                className={cn(
                                    'h-3 w-3 opacity-60 transition-transform',
                                    i18nOpen && 'rotate-180'
                                )}
                            />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="mt-2 flex flex-col gap-2">
                                <div className="bg-muted/30 border-input min-h-7 rounded border px-2 py-1 font-mono text-[10px] break-all">
                                    {i18nFilePath || 'No file selected'}
                                </div>
                                <Select
                                    value={i18nTargetLang}
                                    onValueChange={setI18nTargetLang}
                                    disabled={i18nWatchEnabled}
                                >
                                    <SelectTrigger className="h-7 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {languageCodes.map((code) => (
                                            <SelectItem
                                                key={code}
                                                value={code}
                                                className="text-xs"
                                            >
                                                {code}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="flex flex-wrap gap-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        onClick={pickI18nFile}
                                    >
                                        <FileTextIcon className="h-3 w-3" />
                                        Pick
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={!i18nFilePath.trim()}
                                        onClick={() => doLoadI18n()}
                                    >
                                        <RefreshCwIcon className="h-3 w-3" />
                                        Reload
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={
                                            i18nWatchEnabled
                                                ? 'default'
                                                : 'outline'
                                        }
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={!i18nFilePath.trim()}
                                        onClick={toggleI18nWatch}
                                    >
                                        <RefreshCwIcon className="h-3 w-3" />
                                        {i18nWatchEnabled
                                            ? 'Watching'
                                            : 'Watch'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px]"
                                        disabled={!i18nWatchEnabled}
                                        onClick={toggleI18nWatch}
                                    >
                                        <SquareIcon className="h-3 w-3" />
                                        Stop
                                    </Button>
                                </div>
                                {i18nError ? (
                                    <p className="text-destructive text-[10px]">
                                        {i18nError}
                                    </p>
                                ) : i18nStatus ? (
                                    <p className="text-muted-foreground text-[10px]">
                                        {i18nStatus}
                                    </p>
                                ) : null}
                            </div>
                        </CollapsibleContent>
                    </div>
                </Collapsible>
            </div>
        </div>
    );
}
