import {
    AppWindowIcon,
    FolderOpenIcon,
    MousePointerClickIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
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
import { publishToolsStatusUpdated } from '@/shared/constants/tools';
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
    FieldLabel
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
import { Separator } from '@/ui/shadcn/separator';
import { Switch } from '@/ui/shadcn/switch';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

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

export function AppLauncherDialog({
    open,
    onOpenChange
}: AppLauncherDialogProps) {
    const { t } = useTranslation();
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
                    setEditing(next.entries[0] ?? null);
                }
            })
            .catch((error) =>
                toast.error(
                    userFacingErrorMessage(
                        error,
                        t('dialog.app_launcher.toast.load_failed')
                    )
                )
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

    const updateSnapshot = (next: AppLauncherSnapshot) => {
        setSnapshot(next);
    };

    const saveEntries = async (
        nextEntries: AppLauncherEntry[]
    ): Promise<AppLauncherSnapshot | null> => {
        setSaving(true);
        try {
            const next = await appLauncherRepository.setEntries(nextEntries);
            updateSnapshot(next);
            publishToolsStatusUpdated();
            return next;
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.save_failed')
                )
            );
            return null;
        } finally {
            setSaving(false);
        }
    };

    const updateEnabled = async (enabled: boolean) => {
        setSaving(true);
        try {
            updateSnapshot(await appLauncherRepository.setEnabled(enabled));
            publishToolsStatusUpdated();
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.save_failed')
                )
            );
        } finally {
            setSaving(false);
        }
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
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.pick_failed')
                )
            );
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
            setEditing(applyPickedTarget(editing, picked));
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('dialog.app_launcher.toast.pick_failed')
                )
            );
        } finally {
            setSaving(false);
        }
    };

    const saveEditing = async () => {
        if (!editing) {
            return;
        }
        const normalized = normalizeEntry(editing);
        if (!normalized.name || !normalized.target) {
            toast.error(t('dialog.app_launcher.toast.name_target_required'));
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
        setEditing({ ...savedEntry, args: savedEntry.args ?? '' });
    };

    const deleteEntry = async (entryId: string) => {
        const next = await saveEntries(
            entries.filter((entry) => entry.id !== entryId)
        );
        if (next && editing?.id === entryId) {
            setEditing(next.entries[0] ?? null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[1180px]">
                <DialogHeader>
                    <DialogTitle>{t('dialog.app_launcher.header')}</DialogTitle>
                </DialogHeader>

                <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={snapshot?.enabled ?? false}
                            disabled={loading || saving}
                            onCheckedChange={updateEnabled}
                        />
                        <span className="text-sm font-medium">
                            {t('dialog.app_launcher.global_enabled')}
                        </span>
                    </div>
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

                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-3">
                    <ScrollArea className="app-data-table min-h-0 rounded-lg border">
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
                                            ? t('dialog.app_launcher.loading')
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
                                            {t('dialog.app_launcher.add_app')}
                                        </Button>
                                    </EmptyContent>
                                ) : null}
                            </Empty>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <DataTableHeaderRow>
                                        <DataTableHead>
                                            {t('dialog.app_launcher.name')}
                                        </DataTableHead>
                                        <DataTableHead className="w-24">
                                            {t('dialog.app_launcher.scope')}
                                        </DataTableHead>
                                        <DataTableHead>
                                            {t('dialog.app_launcher.target')}
                                        </DataTableHead>
                                        <DataTableHead className="w-44">
                                            {t('dialog.app_launcher.policy')}
                                        </DataTableHead>
                                        <DataTableHead className="w-16 text-right">
                                            {t('dialog.app_launcher.actions')}
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
                                                className={cn(
                                                    'cursor-pointer',
                                                    !entry.enabled &&
                                                        'opacity-60'
                                                )}
                                                data-state={
                                                    selected
                                                        ? 'selected'
                                                        : undefined
                                                }
                                                onClick={() =>
                                                    setEditing({
                                                        ...entry,
                                                        args: entry.args ?? ''
                                                    })
                                                }
                                            >
                                                <DataTableCell className="min-w-0">
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
                                                <DataTableCell>
                                                    {t(
                                                        `dialog.app_launcher.scope_${entry.scope}`
                                                    )}
                                                </DataTableCell>
                                                <DataTableCell className="max-w-80 truncate font-mono text-xs">
                                                    {shortTarget(entry)}
                                                </DataTableCell>
                                                <DataTableCell>
                                                    <div className="flex flex-col gap-1 text-xs">
                                                        <span>
                                                            {t(
                                                                `dialog.app_launcher.run_policy_${entry.runPolicy}`
                                                            )}
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                            {t(
                                                                `dialog.app_launcher.stop_policy_${entry.stopPolicy}`
                                                            )}
                                                            {entry.launchDelaySeconds
                                                                ? ` / ${entry.launchDelaySeconds}s`
                                                                : ''}
                                                        </span>
                                                    </div>
                                                </DataTableCell>
                                                <DataTableCell
                                                    className={cn(
                                                        DATA_TABLE_CONTROL_CELL_CLASS_NAME,
                                                        'text-right'
                                                    )}
                                                >
                                                    <div
                                                        role="presentation"
                                                        className="flex justify-end"
                                                        onClick={(event) =>
                                                            event.stopPropagation()
                                                        }
                                                        onKeyDown={(event) =>
                                                            event.stopPropagation()
                                                        }
                                                    >
                                                        <Button
                                                            type="button"
                                                            variant="destructive"
                                                            size="icon-sm"
                                                            disabled={saving}
                                                            aria-label={t(
                                                                'dialog.app_launcher.delete'
                                                            )}
                                                            onClick={() =>
                                                                deleteEntry(
                                                                    entry.id
                                                                )
                                                            }
                                                        >
                                                            <Trash2Icon />
                                                        </Button>
                                                    </div>
                                                </DataTableCell>
                                            </DataTableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </ScrollArea>

                    <EntryDetailsPanel
                        entry={editing}
                        saving={saving}
                        isWindows={hostPlatform === 'windows'}
                        run={
                            editing
                                ? activeRunForEntry(snapshot, editing.id)
                                : null
                        }
                        onChange={setEditing}
                        onClose={() => onOpenChange?.(false)}
                        onSave={saveEditing}
                        onBrowseTarget={browseEditingTarget}
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
    onChange,
    onClose,
    onSave,
    onBrowseTarget
}: {
    entry: AppLauncherEntry | null;
    saving: boolean;
    isWindows: boolean;
    run: AppLauncherRun | null;
    onChange: (entry: AppLauncherEntry) => void;
    onClose: () => void;
    onSave: () => void;
    onBrowseTarget: () => void;
}) {
    const { t } = useTranslation();

    if (!entry) {
        return (
            <div className="flex min-h-0 flex-col rounded-lg border">
                <div className="px-3 py-2 text-sm font-medium">
                    {t('dialog.app_launcher.details')}
                </div>
                <Separator />
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
    const stopPolicyLocked =
        entry.kind === 'steamApp' || Boolean(entry.runAsAdministrator);

    return (
        <div className="flex min-h-0 flex-col rounded-lg border">
            <div className="px-3 py-2 text-sm font-medium">
                {t('dialog.app_launcher.details')}
            </div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
                <FieldGroup className="gap-3 p-3">
                    <Field orientation="horizontal">
                        <FieldLabel>
                            {t('dialog.app_launcher.enabled')}
                        </FieldLabel>
                        <Switch
                            checked={entry.enabled}
                            disabled={saving}
                            onCheckedChange={(enabled) =>
                                onChange({
                                    ...entry,
                                    enabled
                                })
                            }
                        />
                    </Field>
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
                                        onChange({
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
                    <Field>
                        <FieldLabel>{t('dialog.app_launcher.name')}</FieldLabel>
                        <Input
                            value={entry.name}
                            onChange={(event) =>
                                onChange({
                                    ...entry,
                                    name: event.target.value
                                })
                            }
                        />
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
                        options={APP_LAUNCHER_SCOPES.map((value) => ({
                            value,
                            label: t(`dialog.app_launcher.scope_${value}`)
                        }))}
                        onValueChange={(scope) =>
                            onChange({
                                ...entry,
                                scope
                            })
                        }
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.run')}
                        value={entry.runPolicy}
                        options={APP_LAUNCHER_RUN_POLICIES.map((value) => ({
                            value,
                            label: t(
                                `dialog.app_launcher.run_policy_short_${value}`
                            )
                        }))}
                        onValueChange={(runPolicy) =>
                            onChange({
                                ...entry,
                                runPolicy
                            })
                        }
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.stop')}
                        value={
                            stopPolicyLocked ? 'keepRunning' : entry.stopPolicy
                        }
                        disabled={stopPolicyLocked}
                        options={APP_LAUNCHER_STOP_POLICIES.map((value) => ({
                            value,
                            label: t(
                                `dialog.app_launcher.stop_policy_short_${value}`
                            )
                        }))}
                        onValueChange={(stopPolicy) =>
                            onChange({
                                ...entry,
                                stopPolicy
                            })
                        }
                    />
                    <Field>
                        <FieldLabel>
                            {t('dialog.app_launcher.delay_seconds')}
                        </FieldLabel>
                        <NumberField
                            min={0}
                            max={MAX_LAUNCH_DELAY_SECONDS}
                            value={entry.launchDelaySeconds}
                            onValueChange={(value) =>
                                onChange({
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
                            <FieldLabel>
                                {t('dialog.app_launcher.args')}
                            </FieldLabel>
                            <Input
                                value={entry.args ?? ''}
                                onChange={(event) =>
                                    onChange({
                                        ...entry,
                                        args: event.target.value
                                    })
                                }
                            />
                        </Field>
                    ) : null}
                </FieldGroup>
            </ScrollArea>
            <Separator />
            <div className="flex justify-end gap-2 p-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={onClose}
                >
                    {t('dialog.app_launcher.close')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={onSave}
                >
                    {t('dialog.app_launcher.save')}
                </Button>
            </div>
        </div>
    );
}

function ToggleField<Value extends string>({
    label,
    value,
    options,
    disabled,
    onValueChange
}: {
    label: string;
    value: Value;
    options: ReadonlyArray<{ value: Value; label: string }>;
    disabled?: boolean;
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
                {options.map((option) => (
                    <ToggleGroupItem
                        key={option.value}
                        value={option.value}
                        className="flex-1"
                    >
                        {option.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </Field>
    );
}
