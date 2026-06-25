import { FolderOpenIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import type {
    AppLauncherEntry,
    AppLauncherEntryKind,
    AppLauncherPickedTarget,
    AppLauncherSnapshot
} from '@/platform/tauri/bindings';
import appLauncherRepository from '@/repositories/appLauncherRepository';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Separator } from '@/ui/shadcn/separator';
import { Switch } from '@/ui/shadcn/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

const MAX_LAUNCH_DELAY_SECONDS = 4_294_967_295;

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
        processName: '',
        workingDirectory: null,
        ...patch
    };
}

function normalizeEntry(entry: AppLauncherEntry): AppLauncherEntry {
    return {
        ...entry,
        name: entry.name.trim(),
        target: entry.target.trim(),
        args: entry.kind === 'localApp' ? (entry.args ?? '') : '',
        launchDelaySeconds: normalizeLaunchDelaySeconds(
            entry.launchDelaySeconds
        ),
        stopPolicy:
            entry.kind === 'steamApp' ? 'keepRunning' : entry.stopPolicy,
        processName: entry.processName?.trim() || null,
        workingDirectory: null
    };
}

function normalizeLaunchDelaySeconds(value: unknown): number {
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
        processName: picked.processName ?? '',
        workingDirectory: null
    });
}

export function AppLauncherDialog({ open, onOpenChange }: any) {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<AppLauncherSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<AppLauncherEntry | null>(null);

    const entries = snapshot?.entries ?? [];
    const loadSnapshot = useCallback(
        (silent = false) => {
            if (!silent) {
                setLoading(true);
            }
            return appLauncherRepository
                .snapshot()
                .then((next) => {
                    setSnapshot(next);
                })
                .catch((error) => {
                    if (!silent) {
                        toast.error(
                            userFacingErrorMessage(
                                error,
                                t('dialog.app_launcher.toast.load_failed')
                            )
                        );
                    }
                })
                .finally(() => {
                    if (!silent) {
                        setLoading(false);
                    }
                });
        },
        [t]
    );

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        appLauncherRepository
            .snapshot()
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
        };
    }, [open, t]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const interval = window.setInterval(() => {
            loadSnapshot(true);
        }, 2000);
        return () => window.clearInterval(interval);
    }, [loadSnapshot, open]);

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
                            checked={Boolean(snapshot?.enabled)}
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
                    <ScrollArea className="min-h-0 rounded-lg border">
                        {entries.length === 0 ? (
                            <Empty className="min-h-[360px] border-0">
                                <EmptyHeader>
                                    <EmptyTitle>
                                        {loading
                                            ? t('dialog.app_launcher.loading')
                                            : t('dialog.app_launcher.empty')}
                                    </EmptyTitle>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            {t('dialog.app_launcher.name')}
                                        </TableHead>
                                        <TableHead className="w-24">
                                            {t('dialog.app_launcher.scope')}
                                        </TableHead>
                                        <TableHead>
                                            {t('dialog.app_launcher.target')}
                                        </TableHead>
                                        <TableHead className="w-44">
                                            {t('dialog.app_launcher.policy')}
                                        </TableHead>
                                        <TableHead className="w-16 text-right">
                                            {t('dialog.app_launcher.actions')}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {entries.map((entry) => {
                                        const selected =
                                            editing?.id === entry.id;
                                        return (
                                            <TableRow
                                                key={entry.id}
                                                className={cn(
                                                    'cursor-pointer',
                                                    selected && 'bg-muted/50',
                                                    !entry.enabled &&
                                                        'opacity-60'
                                                )}
                                                onClick={() =>
                                                    setEditing({
                                                        ...entry,
                                                        args: entry.args ?? ''
                                                    })
                                                }
                                            >
                                                <TableCell className="min-w-0">
                                                    <span className="truncate font-medium">
                                                        {entry.name}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    {t(
                                                        `dialog.app_launcher.scope_${entry.scope}`
                                                    )}
                                                </TableCell>
                                                <TableCell className="max-w-80 truncate font-mono text-xs">
                                                    {shortTarget(entry)}
                                                </TableCell>
                                                <TableCell>
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
                                                </TableCell>
                                                <TableCell>
                                                    <div
                                                        className="flex justify-end"
                                                        onClick={(event) =>
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
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </ScrollArea>

                    <EntryDetailsPanel
                        entry={editing}
                        saving={saving}
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
    onChange,
    onClose,
    onSave,
    onBrowseTarget
}: {
    entry: AppLauncherEntry | null;
    saving: boolean;
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
                        <EmptyTitle>
                            {t('dialog.app_launcher.no_selection')}
                        </EmptyTitle>
                    </EmptyHeader>
                </Empty>
            </div>
        );
    }

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
                        options={['all', 'desktop', 'vr'].map((value) => ({
                            value,
                            label: t(`dialog.app_launcher.scope_${value}`)
                        }))}
                        onValueChange={(scope) =>
                            onChange({
                                ...entry,
                                scope: scope as AppLauncherEntry['scope']
                            })
                        }
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.run')}
                        value={entry.runPolicy}
                        options={['always', 'skipIfRunning'].map((value) => ({
                            value,
                            label: t(
                                `dialog.app_launcher.run_policy_short_${value}`
                            )
                        }))}
                        onValueChange={(runPolicy) =>
                            onChange({
                                ...entry,
                                runPolicy:
                                    runPolicy as AppLauncherEntry['runPolicy']
                            })
                        }
                    />
                    <ToggleField
                        label={t('dialog.app_launcher.stop')}
                        value={
                            entry.kind === 'steamApp'
                                ? 'keepRunning'
                                : entry.stopPolicy
                        }
                        disabled={entry.kind === 'steamApp'}
                        options={['keepRunning', 'closeByVrcx'].map(
                            (value) => ({
                                value,
                                label: t(
                                    `dialog.app_launcher.stop_policy_short_${value}`
                                )
                            })
                        )}
                        onValueChange={(stopPolicy) =>
                            onChange({
                                ...entry,
                                stopPolicy:
                                    stopPolicy as AppLauncherEntry['stopPolicy']
                            })
                        }
                    />
                    <Field>
                        <FieldLabel>
                            {t('dialog.app_launcher.delay_seconds')}
                        </FieldLabel>
                        <Input
                            type="number"
                            min={0}
                            max={MAX_LAUNCH_DELAY_SECONDS}
                            value={entry.launchDelaySeconds}
                            onChange={(event) =>
                                onChange({
                                    ...entry,
                                    launchDelaySeconds:
                                        normalizeLaunchDelaySeconds(
                                            event.target.value
                                        )
                                })
                            }
                        />
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

function ToggleField({
    label,
    value,
    options,
    disabled,
    onValueChange
}: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    disabled?: boolean;
    onValueChange: (value: string) => void;
}) {
    return (
        <Field data-disabled={disabled || undefined}>
            <FieldLabel>{label}</FieldLabel>
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={value}
                disabled={disabled}
                className="w-full"
                onValueChange={(next) => {
                    if (next) {
                        onValueChange(next);
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
