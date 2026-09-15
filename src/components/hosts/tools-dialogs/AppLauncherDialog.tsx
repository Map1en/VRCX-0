import {
    AppWindowIcon,
    FolderOpenIcon,
    MousePointerClickIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DataTableCell,
    DataTableHead,
    DataTableHeaderRow,
    DataTableRow
} from '@/components/data-table/DataTableView';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import type {
    AppLauncherEntry,
    AppLauncherEntryKind,
    AppLauncherPickedTarget,
    AppLauncherRun,
    AppLauncherSnapshot
} from '@/platform/tauri/bindings';
import appLauncherRepository from '@/repositories/appLauncherRepository';
import {
    getCurrentAppLauncherSnapshot,
    subscribeAppLauncherSnapshot
} from '@/services/appLauncherSnapshotService';
import { toast } from '@/services/toastService';
import { publishToolsStatusUpdated } from '@/shared/constants/tools';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldSeparator
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

const MAX_LAUNCH_DELAY_SECONDS = 4_294_967_295;
const EMPTY_APP_LAUNCHER_ENTRIES: AppLauncherEntry[] = [];
const APP_LAUNCHER_SCOPES: AppLauncherEntry['scope'][] = [
    'all',
    'desktop',
    'vr'
];
const APP_LAUNCHER_RUN_POLICIES: AppLauncherEntry['runPolicy'][] = [
    'always',
    'skipIfRunning'
];
const APP_LAUNCHER_STOP_POLICIES: AppLauncherEntry['stopPolicy'][] = [
    'keepRunning',
    'closeByVrcx'
];

type AppLauncherDialogProps = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
};

function createEntryId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultEntry(
    kind: AppLauncherEntryKind,
    patch: Partial<AppLauncherEntry> = {}
): AppLauncherEntry {
    return {
        id: createEntryId(),
        enabled: true,
        name: '',
        kind,
        scope: 'all',
        target: '',
        args: '',
        launchDelaySeconds: 0,
        runPolicy: 'always',
        stopPolicy: 'keepRunning',
        runAsAdministrator: false,
        processName: '',
        workingDirectory: null,
        ...patch
    };
}

function normalizeEntry(entry: AppLauncherEntry): AppLauncherEntry {
    const runAsAdministrator =
        entry.kind === 'localApp' && entry.runAsAdministrator;
    return {
        ...entry,
        name: entry.name.trim(),
        target: entry.target.trim(),
        args: entry.kind === 'localApp' ? (entry.args ?? '') : '',
        launchDelaySeconds: normalizeLaunchDelaySeconds(
            entry.launchDelaySeconds
        ),
        stopPolicy:
            entry.kind === 'steamApp' || runAsAdministrator
                ? 'keepRunning'
                : entry.stopPolicy,
        runAsAdministrator,
        processName: entry.processName?.trim() || null,
        workingDirectory:
            entry.kind === 'localApp'
                ? entry.workingDirectory?.trim() || null
                : null
    };
}

function normalizeLaunchDelaySeconds(value: string | number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.min(MAX_LAUNCH_DELAY_SECONDS, Math.max(0, Math.trunc(numeric)));
}

function shortTarget(entry: AppLauncherEntry): string {
    if (entry.kind === 'steamApp') {
        return entry.target ? `steam:${entry.target}` : '';
    }
    return entry.target;
}

function applyPickedTarget(
    entry: AppLauncherEntry,
    picked: AppLauncherPickedTarget
): AppLauncherEntry {
    return normalizeEntry({
        ...entry,
        name: picked.name,
        kind: picked.kind,
        target: picked.target,
        args:
            picked.kind === 'localApp' && entry.kind === 'localApp'
                ? (entry.args ?? '')
                : '',
        stopPolicy:
            picked.kind === 'steamApp' ? 'keepRunning' : entry.stopPolicy,
        runAsAdministrator:
            picked.kind === 'localApp' &&
            entry.kind === 'localApp' &&
            entry.runAsAdministrator,
        processName: picked.processName ?? '',
        workingDirectory:
            picked.kind === 'localApp' ? picked.workingDirectory : null
    });
}

function activeRunForEntry(
    snapshot: AppLauncherSnapshot | null,
    entryId: string
): AppLauncherRun | null {
    const runs = snapshot?.activeSession?.runs ?? [];
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        if (run?.entryId === entryId) {
            return run;
        }
    }
    return null;
}

function runErrorKey(run: AppLauncherRun): string | null {
    if (run.status !== 'failed') {
        return null;
    }
    if (run.osErrorCode === 740) {
        return 'dialog.app_launcher.run_error_elevation_required';
    }
    if (run.osErrorCode === 1223) {
        return 'dialog.app_launcher.run_error_elevation_cancelled';
    }
    return 'dialog.app_launcher.run_error_failed';
}

function entriesEqual(left: AppLauncherEntry, right: AppLauncherEntry) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function AppLauncherDialog({
    open,
    onOpenChange
}: AppLauncherDialogProps) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const [snapshot, setSnapshot] = useState<AppLauncherSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<AppLauncherEntry | null>(null);

    const entries = snapshot?.entries ?? EMPTY_APP_LAUNCHER_ENTRIES;
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        const unsubscribe = subscribeAppLauncherSnapshot((next) => {
            if (active) {
                setSnapshot(next);
            }
        });
        getCurrentAppLauncherSnapshot()
            .then((next) => {
                if (active) {
                    setSnapshot(next);
                    setEditing((current) => current ?? next.entries[0] ?? null);
                }
            })
            .catch((error) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t('dialog.app_launcher.toast.load_failed')
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
            unsubscribe();
        };
    }, [open, t]);

    useEffect(() => {
        if (!snapshot || !editing) {
            return;
        }
        if (!entries.some((entry) => entry.id === editing.id)) {
            setEditing(entries[0] ?? null);
        }
    }, [editing, entries, snapshot]);

    const saveEntries = async (
        nextEntries: AppLauncherEntry[]
    ): Promise<AppLauncherSnapshot | null> => {
        setSaving(true);
        try {
            const next = await appLauncherRepository.setEntries(nextEntries);
            setSnapshot(next);
            publishToolsStatusUpdated();
            return next;
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.save_failed')
                )
            });
            return null;
        } finally {
            setSaving(false);
        }
    };

    const updateEnabled = async (enabled: boolean) => {
        setSaving(true);
        try {
            setSnapshot(await appLauncherRepository.setEnabled(enabled));
            publishToolsStatusUpdated();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.save_failed')
                )
            });
        } finally {
            setSaving(false);
        }
    };

    const commitEntry = async (draft: AppLauncherEntry) => {
        const normalized = normalizeEntry(draft);
        const saved = entries.find((entry) => entry.id === normalized.id);
        if (!normalized.name || !normalized.target) {
            setEditing(draft);
            return;
        }
        if (saved && entriesEqual(saved, normalized)) {
            setEditing({ ...saved, args: saved.args ?? '' });
            return;
        }
        const next = await saveEntries(
            entries.map((entry) =>
                entry.id === normalized.id ? normalized : entry
            )
        );
        if (!next) {
            return;
        }
        const savedEntry =
            next.entries.find((entry) => entry.id === normalized.id) ??
            normalized;
        setEditing((current) =>
            current?.id === normalized.id
                ? { ...savedEntry, args: savedEntry.args ?? '' }
                : current
        );
    };

    const toggleEntryEnabled = async (
        entry: AppLauncherEntry,
        enabled: boolean
    ) => {
        setEditing((current) =>
            current?.id === entry.id ? { ...current, enabled } : current
        );
        await saveEntries(
            entries.map((item) =>
                item.id === entry.id ? { ...item, enabled } : item
            )
        );
    };

    const addApp = async () => {
        setSaving(true);
        try {
            const picked = await appLauncherRepository.pickTarget();
            if (!picked) {
                return;
            }
            const entry = normalizeEntry(
                createDefaultEntry(picked.kind, {
                    name: picked.name,
                    target: picked.target,
                    processName: picked.processName ?? ''
                })
            );
            const next = await saveEntries([...entries, entry]);
            if (!next) {
                return;
            }
            const savedEntry =
                next.entries.find((item) => item.id === entry.id) ?? entry;
            setEditing({ ...savedEntry, args: savedEntry.args ?? '' });
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.pick_failed')
                )
            });
        } finally {
            setSaving(false);
        }
    };

    const browseEditingTarget = async () => {
        if (!editing) {
            return;
        }
        setSaving(true);
        try {
            const picked = await appLauncherRepository.pickTarget();
            if (!picked) {
                return;
            }
            await commitEntry(applyPickedTarget(editing, picked));
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.pick_failed')
                )
            });
        } finally {
            setSaving(false);
        }
    };

    const removeEntry = async (entry: AppLauncherEntry) => {
        const result = await confirm({
            title: t('dialog.app_launcher.remove_app'),
            description: t('dialog.app_launcher.remove_confirm', {
                name: entry.name || shortTarget(entry)
            }),
            confirmText: t('dialog.app_launcher.remove_app'),
            cancelText: t('confirm.cancel_button'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        const next = await saveEntries(
            entries.filter((item) => item.id !== entry.id)
        );
        if (next && editing?.id === entry.id) {
            setEditing(next.entries[0] ?? null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[1180px]">
                <DialogHeader>
                    <DialogTitle>{t('dialog.app_launcher.header')}</DialogTitle>
                </DialogHeader>

                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-4">
                    <div className="flex min-h-0 flex-col gap-3">
                        <div className="flex shrink-0 flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2">
                                <Switch
                                    checked={snapshot?.enabled ?? false}
                                    disabled={loading || saving}
                                    onCheckedChange={updateEnabled}
                                />
                                <span className="text-sm font-medium">
                                    {t('dialog.app_launcher.global_enabled')}
                                </span>
                            </label>
                            <Button
                                type="button"
                                className="ml-auto"
                                variant="outline"
                                size="sm"
                                disabled={saving}
                                onClick={addApp}
                            >
                                <PlusIcon data-icon="inline-start" />
                                {t('dialog.app_launcher.add_app')}
                            </Button>
                        </div>

                        <ScrollArea className="app-data-table min-h-0 flex-1 rounded-lg border">
                            {entries.length === 0 ? (
                                <Empty className="min-h-[360px] border-0">
                                    <EmptyHeader>
                                        {!loading ? (
                                            <EmptyMedia variant="icon">
                                                <AppWindowIcon />
                                            </EmptyMedia>
                                        ) : null}
                                        <EmptyTitle>
                                            {loading
                                                ? t(
                                                      'dialog.app_launcher.loading'
                                                  )
                                                : t(
                                                      'empty_state.app_launcher_title'
                                                  )}
                                        </EmptyTitle>
                                        {!loading ? (
                                            <EmptyDescription>
                                                {t(
                                                    'empty_state.app_launcher_description'
                                                )}
                                            </EmptyDescription>
                                        ) : null}
                                    </EmptyHeader>
                                    {!loading ? (
                                        <EmptyContent>
                                            <Button
                                                type="button"
                                                variant="link"
                                                onClick={addApp}
                                            >
                                                {t(
                                                    'dialog.app_launcher.add_app'
                                                )}
                                            </Button>
                                        </EmptyContent>
                                    ) : null}
                                </Empty>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <DataTableHeaderRow>
                                            <DataTableHead className="w-12" />
                                            <DataTableHead>
                                                {t('dialog.app_launcher.name')}
                                            </DataTableHead>
                                            <DataTableHead className="w-24">
                                                {t('dialog.app_launcher.scope')}
                                            </DataTableHead>
                                            <DataTableHead>
                                                {t(
                                                    'dialog.app_launcher.target'
                                                )}
                                            </DataTableHead>
                                        </DataTableHeaderRow>
                                    </TableHeader>
                                    <TableBody>
                                        {entries.map((entry) => {
                                            const selected =
                                                editing?.id === entry.id;
                                            const run = activeRunForEntry(
                                                snapshot,
                                                entry.id
                                            );
                                            return (
                                                <DataTableRow
                                                    key={entry.id}
                                                    className="cursor-pointer"
                                                    data-state={
                                                        selected
                                                            ? 'selected'
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        setEditing({
                                                            ...entry,
                                                            args:
                                                                entry.args ?? ''
                                                        })
                                                    }
                                                >
                                                    <DataTableCell
                                                        onClick={(event) =>
                                                            event.stopPropagation()
                                                        }
                                                    >
                                                        <Switch
                                                            size="sm"
                                                            aria-label={t(
                                                                'dialog.app_launcher.enabled'
                                                            )}
                                                            checked={
                                                                entry.enabled
                                                            }
                                                            disabled={saving}
                                                            onCheckedChange={(
                                                                enabled
                                                            ) =>
                                                                toggleEntryEnabled(
                                                                    entry,
                                                                    enabled
                                                                )
                                                            }
                                                        />
                                                    </DataTableCell>
                                                    <DataTableCell
                                                        className={cn(
                                                            'min-w-0',
                                                            !entry.enabled &&
                                                                'text-muted-foreground'
                                                        )}
                                                    >
                                                        <div className="flex min-w-0 flex-col gap-0.5">
                                                            <span className="truncate font-medium">
                                                                {entry.name}
                                                            </span>
                                                            {run ? (
                                                                <span
                                                                    className={cn(
                                                                        'text-muted-foreground text-xs',
                                                                        run.status ===
                                                                            'failed' &&
                                                                            'text-destructive'
                                                                    )}
                                                                >
                                                                    {t(
                                                                        `dialog.app_launcher.run_status_${run.status}`
                                                                    )}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </DataTableCell>
                                                    <DataTableCell
                                                        className={cn(
                                                            !entry.enabled &&
                                                                'text-muted-foreground'
                                                        )}
                                                    >
                                                        {t(
                                                            `dialog.app_launcher.scope_${entry.scope}`
                                                        )}
                                                    </DataTableCell>
                                                    <DataTableCell className="text-muted-foreground max-w-96 truncate font-mono text-xs">
                                                        {shortTarget(entry)}
                                                    </DataTableCell>
                                                </DataTableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </ScrollArea>
                    </div>

                    <EntryDetailsPanel
                        entry={editing}
                        saving={saving}
                        isWindows={hostPlatform === 'windows'}
                        run={
                            editing
                                ? activeRunForEntry(snapshot, editing.id)
                                : null
                        }
                        onDraftChange={setEditing}
                        onCommit={commitEntry}
                        onBrowseTarget={browseEditingTarget}
                        onRemove={removeEntry}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

function EntryDetailsPanel({
    entry,
    saving,
    isWindows,
    run,
    onDraftChange,
    onCommit,
    onBrowseTarget,
    onRemove
}: {
    entry: AppLauncherEntry | null;
    saving: boolean;
    isWindows: boolean;
    run: AppLauncherRun | null;
    onDraftChange: (entry: AppLauncherEntry) => void;
    onCommit: (entry: AppLauncherEntry) => void;
    onBrowseTarget: () => void;
    onRemove: (entry: AppLauncherEntry) => void;
}) {
    const { t } = useTranslation();

    if (!entry) {
        return (
            <div className="flex min-h-0 flex-col border-l pl-4">
                <Empty className="min-h-[320px] border-0">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <MousePointerClickIcon />
                        </EmptyMedia>
                        <EmptyTitle>
                            {t('empty_state.app_launcher_selection_title')}
                        </EmptyTitle>
                        <EmptyDescription>
                            {t(
                                'empty_state.app_launcher_selection_description'
                            )}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </div>
        );
    }

    const errorKey = run ? runErrorKey(run) : null;
    const stopLockedKey =
        entry.kind === 'steamApp'
            ? 'dialog.app_launcher.stop_locked_steam'
            : entry.runAsAdministrator
              ? 'dialog.app_launcher.stop_locked_admin'
              : null;
    const nameMissing = !entry.name.trim();

    return (
        <div className="flex min-h-0 flex-col border-l pl-4">
            <div className="truncate pb-3 text-sm font-medium">
                {entry.name || shortTarget(entry)}
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <FieldGroup className="gap-4 pr-1">
                    {errorKey && run ? (
                        <Field>
                            <FieldError>
                                {t(errorKey, {
                                    code: run.osErrorCode ?? ''
                                })}
                            </FieldError>
                            {run.error ? (
                                <p className="text-muted-foreground font-mono text-xs break-all">
                                    {run.error}
                                </p>
                            ) : null}
                        </Field>
                    ) : null}
                    <Field data-invalid={nameMissing || undefined}>
                        <FieldLabel htmlFor="app-launcher-name">
                            {t('dialog.app_launcher.name')}
                        </FieldLabel>
                        <Input
                            id="app-launcher-name"
                            value={entry.name}
                            aria-invalid={nameMissing || undefined}
                            disabled={saving}
                            onChange={(event) =>
                                onDraftChange({
                                    ...entry,
                                    name: event.target.value
                                })
                            }
                            onBlur={() => onCommit(entry)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                        {nameMissing ? (
                            <FieldError>
                                {t('dialog.app_launcher.name_required')}
                            </FieldError>
                        ) : null}
                    </Field>
                    <Field>
                        <FieldLabel>
                            {entry.kind === 'steamApp'
                                ? t('dialog.app_launcher.steam_app_id')
                                : t('dialog.app_launcher.target')}
                        </FieldLabel>
                        <div className="flex gap-2">
                            <Input
                                className="min-w-0 font-mono text-xs"
                                value={entry.target}
                                readOnly
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                disabled={saving}
                                aria-label={t(
                                    'dialog.app_launcher.choose_target'
                                )}
                                onClick={onBrowseTarget}
                            >
                                <FolderOpenIcon />
                            </Button>
                        </div>
                    </Field>
                    <ToggleField
                        label={t('dialog.app_launcher.scope')}
                        value={entry.scope}
                        disabled={saving}
                        options={APP_LAUNCHER_SCOPES.map((value) => ({
                            value,
                            label: t(`dialog.app_launcher.scope_${value}`)
                        }))}
                        onValueChange={(scope) => onCommit({ ...entry, scope })}
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.run')}
                        value={entry.runPolicy}
                        disabled={saving}
                        options={APP_LAUNCHER_RUN_POLICIES.map((value) => ({
                            value,
                            label: t(
                                `dialog.app_launcher.run_policy_short_${value}`
                            )
                        }))}
                        onValueChange={(runPolicy) =>
                            onCommit({ ...entry, runPolicy })
                        }
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.stop')}
                        value={stopLockedKey ? 'keepRunning' : entry.stopPolicy}
                        disabled={saving || Boolean(stopLockedKey)}
                        description={stopLockedKey ? t(stopLockedKey) : null}
                        options={APP_LAUNCHER_STOP_POLICIES.map((value) => ({
                            value,
                            label: t(
                                `dialog.app_launcher.stop_policy_short_${value}`
                            )
                        }))}
                        onValueChange={(stopPolicy) =>
                            onCommit({ ...entry, stopPolicy })
                        }
                    />
                    {isWindows && entry.kind === 'localApp' ? (
                        <Field>
                            <div className="flex items-center gap-2">
                                <FieldLabel className="flex-1">
                                    {t(
                                        'dialog.app_launcher.run_as_administrator'
                                    )}
                                </FieldLabel>
                                <Switch
                                    aria-label={t(
                                        'dialog.app_launcher.run_as_administrator'
                                    )}
                                    checked={Boolean(entry.runAsAdministrator)}
                                    disabled={saving}
                                    onCheckedChange={(runAsAdministrator) =>
                                        onCommit({
                                            ...entry,
                                            runAsAdministrator,
                                            stopPolicy: runAsAdministrator
                                                ? 'keepRunning'
                                                : entry.stopPolicy
                                        })
                                    }
                                />
                            </div>
                            <FieldDescription>
                                {t(
                                    'dialog.app_launcher.run_as_administrator_description'
                                )}
                            </FieldDescription>
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel>
                            {t('dialog.app_launcher.delay_seconds')}
                        </FieldLabel>
                        <NumberField
                            min={0}
                            max={MAX_LAUNCH_DELAY_SECONDS}
                            value={entry.launchDelaySeconds}
                            disabled={saving}
                            onValueChange={(value) =>
                                onCommit({
                                    ...entry,
                                    launchDelaySeconds:
                                        normalizeLaunchDelaySeconds(value ?? 0)
                                })
                            }
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                    </Field>
                    {entry.kind === 'localApp' ? (
                        <Field>
                            <FieldLabel htmlFor="app-launcher-args">
                                {t('dialog.app_launcher.args')}
                            </FieldLabel>
                            <Input
                                id="app-launcher-args"
                                className="font-mono text-xs"
                                value={entry.args ?? ''}
                                disabled={saving}
                                onChange={(event) =>
                                    onDraftChange({
                                        ...entry,
                                        args: event.target.value
                                    })
                                }
                                onBlur={() => onCommit(entry)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                        </Field>
                    ) : null}
                    <FieldSeparator />
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={saving}
                        className="self-start"
                        onClick={() => onRemove(entry)}
                    >
                        <Trash2Icon data-icon="inline-start" />
                        {t('dialog.app_launcher.remove_app')}
                    </Button>
                </FieldGroup>
            </ScrollArea>
        </div>
    );
}

function ToggleField<Value extends string>({
    label,
    value,
    options,
    disabled,
    description,
    onValueChange
}: {
    label: string;
    value: Value;
    options: ReadonlyArray<{ value: Value; label: string }>;
    disabled?: boolean;
    description?: string | null;
    onValueChange: (value: Value) => void;
}) {
    return (
        <Field data-disabled={disabled || undefined}>
            <FieldLabel>{label}</FieldLabel>
            <ToggleGroup
                variant="outline"
                size="sm"
                value={value ? [value] : []}
                disabled={disabled}
                className="w-full"
                onValueChange={(next) => {
                    const selected = options.find(
                        (option) => option.value === next[0]
                    );
                    if (selected) {
                        onValueChange(selected.value);
                    }
                }}
            >
                {options.map((option, index) => (
                    <Fragment key={option.value}>
                        {index > 0 ? <ToggleGroupSeparator /> : null}
                        <ToggleGroupItem
                            value={option.value}
                            className="flex-1"
                        >
                            {option.label}
                        </ToggleGroupItem>
                    </Fragment>
                ))}
            </ToggleGroup>
            {description ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
        </Field>
    );
}
