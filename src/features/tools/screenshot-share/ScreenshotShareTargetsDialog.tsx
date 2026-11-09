import {
    ExternalLinkIcon,
    PlusIcon,
    SquarePenIcon,
    StarIcon,
    Trash2Icon,
    Undo2Icon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCompactDateTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import {
    commands,
    type ScreenshotShareFields,
    type ScreenshotShareRecord,
    type ScreenshotShareTarget
} from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useScreenshotShareStore } from '@/state/screenshotShareStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { ScreenshotShareOptions } from './ScreenshotShareOptions';
import { screenshotShareErrorText } from './screenshotShareService';

const DEFAULT_SCREENSHOT_SHARE_FIELDS: ScreenshotShareFields = {
    world: true,
    time: true,
    playerCount: true,
    people: false,
    stay: false,
    spoiler: false,
    metadata: false,
    compression: 'high',
    print: false
};

type TargetDraft = {
    id: string | null;
    name: string;
    url: string;
    fields: ScreenshotShareFields;
    quick: boolean;
};

function newDraft(isFirst: boolean): TargetDraft {
    return {
        id: null,
        name: '',
        url: '',
        fields: DEFAULT_SCREENSHOT_SHARE_FIELDS,
        quick: isFirst
    };
}

function draftFromTarget(target: ScreenshotShareTarget): TargetDraft {
    return {
        id: target.id,
        name: target.name,
        url: '',
        fields: target.fields,
        quick: target.quick
    };
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return screenshotShareErrorText(message);
}

function TargetRow({
    target,
    onToggleQuick,
    onEdit,
    onDelete
}: {
    target: ScreenshotShareTarget;
    onToggleQuick(): void;
    onEdit(): void;
    onDelete(): void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
            <HintTooltip label={t('view.tools.screenshot_share.targets.quick')}>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-pressed={target.quick}
                    onClick={onToggleQuick}
                >
                    <StarIcon
                        className={cn(
                            target.quick && 'fill-current text-amber-400'
                        )}
                    />
                </Button>
            </HintTooltip>
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium">
                    {target.name}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {target.urlHint}
                </span>
                {target.invalid ? (
                    <Badge variant="destructive">
                        {t('view.tools.screenshot_share.targets.invalid')}
                    </Badge>
                ) : null}
            </div>
            <HintTooltip label={t('view.tools.screenshot_share.targets.edit')}>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={onEdit}
                >
                    <SquarePenIcon />
                </Button>
            </HintTooltip>
            <HintTooltip label={t('common.actions.delete')}>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={onDelete}
                >
                    <Trash2Icon />
                </Button>
            </HintTooltip>
        </div>
    );
}

function HistoryList() {
    const { t } = useTranslation();
    const [records, setRecords] = useState<ScreenshotShareRecord[] | null>(
        null
    );
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void commands.appGetScreenshotShareHistory().then((history) => {
            if (active) {
                setRecords(history);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    async function retract(record: ScreenshotShareRecord) {
        setBusyId(record.id);
        try {
            await commands.appDeleteScreenshotShareRecord(record.id);
            setRecords(
                (current) =>
                    current?.filter((item) => item.id !== record.id) ?? null
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('view.tools.screenshot_share.undo_failed', {
                    reason: errorMessage(error)
                })
            });
        } finally {
            setBusyId(null);
        }
    }

    if (!records) {
        return null;
    }
    if (!records.length) {
        return (
            <div className="text-muted-foreground rounded-md border border-dashed px-3 py-8 text-center text-sm">
                {t('view.tools.screenshot_share.history.empty')}
            </div>
        );
    }
    return (
        <div className="grid max-h-[50vh] gap-1.5 overflow-y-auto">
            {records.map((record) => (
                <div
                    key={record.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
                >
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">
                            {record.targetName}
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {t('view.tools.screenshot_share.history.summary', {
                                date: formatCompactDateTime(record.sentAt),
                                count: record.fileNames.length
                            })}
                        </span>
                    </div>
                    {record.messageUrl ? (
                        <HintTooltip
                            label={t(
                                'view.tools.screenshot_share.history.open'
                            )}
                        >
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => {
                                    if (record.messageUrl) {
                                        void openExternalLink(
                                            record.messageUrl
                                        );
                                    }
                                }}
                            >
                                <ExternalLinkIcon />
                            </Button>
                        </HintTooltip>
                    ) : null}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId !== null}
                        onClick={() => void retract(record)}
                    >
                        <Undo2Icon data-icon="inline-start" />
                        {t('view.tools.screenshot_share.history.retract')}
                    </Button>
                </div>
            ))}
        </div>
    );
}

export function ScreenshotShareTargetsDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation();
    const targets = useScreenshotShareStore((state) => state.targets);
    const save = useScreenshotShareStore((state) => state.save);
    const remove = useScreenshotShareStore((state) => state.remove);
    const [tab, setTab] = useState<'targets' | 'history'>('targets');
    const [draft, setDraft] = useState<TargetDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function openDraft(next: TargetDraft) {
        setError(null);
        setDraft(next);
    }

    async function submit() {
        if (!draft) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await save({
                id: draft.id,
                name: draft.name.trim(),
                url: draft.url.trim() || null,
                fields: draft.fields,
                quick: draft.quick
            });
            setDraft(null);
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSaving(false);
        }
    }

    async function toggleQuick(target: ScreenshotShareTarget) {
        try {
            await save({
                id: target.id,
                name: target.name,
                url: null,
                fields: target.fields,
                quick: !target.quick
            });
        } catch (saveError) {
            toast.add({ type: 'error', title: errorMessage(saveError) });
        }
    }

    async function deleteTarget(target: ScreenshotShareTarget) {
        try {
            await remove(target.id);
        } catch (deleteError) {
            toast.add({ type: 'error', title: errorMessage(deleteError) });
        }
    }

    const canSave =
        Boolean(draft?.name.trim()) && Boolean(draft?.id || draft?.url.trim());

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    setDraft(null);
                }
                onOpenChange(next);
            }}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {draft
                            ? t(
                                  draft.id
                                      ? 'view.tools.screenshot_share.targets.edit_title'
                                      : 'view.tools.screenshot_share.targets.add_title'
                              )
                            : t('view.tools.screenshot_share.targets.title')}
                    </DialogTitle>
                    {draft ? null : (
                        <DialogDescription>
                            {t(
                                'view.tools.screenshot_share.targets.description'
                            )}
                        </DialogDescription>
                    )}
                </DialogHeader>

                {draft ? (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="screenshot-share-target-name">
                                {t('view.tools.screenshot_share.targets.name')}
                            </Label>
                            <Input
                                id="screenshot-share-target-name"
                                value={draft.name}
                                placeholder={t(
                                    'view.tools.screenshot_share.targets.name_placeholder'
                                )}
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        name: event.target.value
                                    })
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="screenshot-share-target-url">
                                {t('view.tools.screenshot_share.targets.url')}
                            </Label>
                            <Input
                                id="screenshot-share-target-url"
                                type="password"
                                autoComplete="off"
                                value={draft.url}
                                placeholder={
                                    draft.id
                                        ? t(
                                              'view.tools.screenshot_share.targets.url_keep'
                                          )
                                        : 'https://discord.com/api/webhooks/...'
                                }
                                onChange={(event) =>
                                    setDraft({
                                        ...draft,
                                        url: event.target.value
                                    })
                                }
                            />
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    'view.tools.screenshot_share.targets.url_hint'
                                )}
                            </span>
                        </div>
                        <ScreenshotShareOptions
                            idPrefix="screenshot-share-target"
                            value={draft.fields}
                            disabled={saving}
                            onChange={(fields) =>
                                setDraft({ ...draft, fields })
                            }
                        />
                        <label className="flex items-start gap-3 text-sm">
                            <span className="flex flex-1 flex-col gap-0.5">
                                {t('view.tools.screenshot_share.targets.quick')}
                                <span className="text-muted-foreground text-xs">
                                    {t(
                                        'view.tools.screenshot_share.targets.quick_hint'
                                    )}
                                </span>
                            </span>
                            <Switch
                                checked={draft.quick}
                                onCheckedChange={(quick) =>
                                    setDraft({ ...draft, quick })
                                }
                            />
                        </label>
                        {error ? (
                            <span className="text-destructive text-xs">
                                {error}
                            </span>
                        ) : null}
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={saving}
                                onClick={() => setDraft(null)}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                type="button"
                                disabled={saving || !canSave}
                                onClick={() => void submit()}
                            >
                                {t('common.actions.save')}
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <Tabs
                        value={tab}
                        onValueChange={(value) => {
                            if (value === 'targets' || value === 'history') {
                                setTab(value);
                            }
                        }}
                        className="grid gap-3"
                    >
                        <TabsList>
                            <TabsTrigger value="targets">
                                {t(
                                    'view.tools.screenshot_share.targets.tab_targets'
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="history">
                                {t(
                                    'view.tools.screenshot_share.targets.tab_history'
                                )}
                            </TabsTrigger>
                        </TabsList>
                        {tab === 'history' ? (
                            <HistoryList />
                        ) : targets.length ? (
                            <div className="grid gap-2">
                                {targets.map((target) => (
                                    <TargetRow
                                        key={target.id}
                                        target={target}
                                        onToggleQuick={() =>
                                            void toggleQuick(target)
                                        }
                                        onEdit={() =>
                                            openDraft(draftFromTarget(target))
                                        }
                                        onDelete={() =>
                                            void deleteTarget(target)
                                        }
                                    />
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="justify-self-start"
                                    onClick={() => openDraft(newDraft(false))}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t(
                                        'view.tools.screenshot_share.targets.add'
                                    )}
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-8 text-center">
                                <span className="text-muted-foreground text-sm">
                                    {t(
                                        'view.tools.screenshot_share.targets.empty'
                                    )}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openDraft(newDraft(true))}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t(
                                        'view.tools.screenshot_share.targets.add'
                                    )}
                                </Button>
                            </div>
                        )}
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}
