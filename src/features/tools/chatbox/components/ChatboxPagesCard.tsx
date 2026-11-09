import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type {
    ChatboxConfig,
    ChatboxLimits,
    ChatboxPage,
    ChatboxPageLine
} from '@/platform/tauri/bindings';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import {
    createChatboxLine,
    createChatboxPage,
    moveChatboxLine,
    moveChatboxPage,
    updateChatboxLine,
    updateChatboxPage,
    type ChatboxConfigUpdate,
    type ChatboxLineUpdate
} from '../chatboxConfig';
import type { ChatboxPreset } from '../chatboxPresets';
import type { ChatboxEditorMeta } from '../useChatboxController';
import { usePresetSamples } from '../usePresetSamples';
import { useSyncedDraft } from '../useSyncedDraft';
import { ChatboxLineEditor } from './ChatboxLineEditor';
import { ChatboxPresetMenuItems } from './ChatboxPresetMenuItems';

type PresetSamples = Record<string, string>;

function useSortSensors() {
    return useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );
}

function SortableRow({
    id,
    className,
    handleClassName,
    children
}: {
    id: string;
    className?: string;
    handleClassName: string;
    children(handle: ReactNode): ReactNode;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    const handle = (
        <span
            {...attributes}
            {...listeners}
            className={cn(
                'text-muted-foreground shrink-0 cursor-grab self-start',
                handleClassName
            )}
        >
            <GripVerticalIcon className="size-4" />
        </span>
    );

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn(className, isDragging && 'opacity-50')}
        >
            {children(handle)}
        </div>
    );
}

export function ChatboxPagesCard({
    config,
    meta,
    activePageId,
    onUpdate
}: {
    config: ChatboxConfig;
    meta: ChatboxEditorMeta;
    activePageId: string | null;
    onUpdate(update: ChatboxConfigUpdate): void;
}) {
    const { t } = useTranslation();
    const sensors = useSortSensors();
    const presetSamples = usePresetSamples(meta.defaultFormats);

    function handleDragEnd(event: DragEndEvent) {
        if (event.over) {
            onUpdate(
                moveChatboxPage(String(event.active.id), String(event.over.id))
            );
        }
    }

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>{t('view.tools.chatbox.pages.title')}</CardTitle>
                <CardDescription>
                    {t('view.tools.chatbox.pages.hint')}
                </CardDescription>
                <CardAction>
                    <label className="flex items-center gap-2 text-sm">
                        {t('view.tools.chatbox.pages.enabled')}
                        <Switch
                            checked={config.statusEnabled}
                            onCheckedChange={(statusEnabled) =>
                                onUpdate((current) => ({
                                    ...current,
                                    statusEnabled
                                }))
                            }
                        />
                    </label>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={config.pages.map((page) => page.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {config.pages.map((page, index) => (
                            <SortableRow
                                key={page.id}
                                id={page.id}
                                handleClassName="mt-1.5"
                                className={cn(
                                    'flex gap-2 rounded-lg border p-2',
                                    page.id === activePageId &&
                                        'border-foreground/30',
                                    !page.enabled && 'bg-muted/30'
                                )}
                            >
                                {(handle) => (
                                    <>
                                        {handle}
                                        <ChatboxPageBody
                                            page={page}
                                            index={index}
                                            meta={meta}
                                            presetSamples={presetSamples}
                                            onUpdate={onUpdate}
                                        />
                                    </>
                                )}
                            </SortableRow>
                        ))}
                    </SortableContext>
                </DndContext>
                {config.pages.length < meta.limits.maxPages ? (
                    <div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                onUpdate((current) => ({
                                    ...current,
                                    pages: [
                                        ...current.pages,
                                        createChatboxPage()
                                    ]
                                }))
                            }
                        >
                            <PlusIcon />
                            {t('view.tools.chatbox.pages.add_page')}
                        </Button>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}

function ChatboxPageBody({
    page,
    index,
    meta,
    presetSamples,
    onUpdate
}: {
    page: ChatboxPage;
    index: number;
    meta: ChatboxEditorMeta;
    presetSamples: PresetSamples;
    onUpdate(update: ChatboxConfigUpdate): void;
}) {
    const { t } = useTranslation();
    const sensors = useSortSensors();
    const renderPreset = (preset: ChatboxPreset) => preset.template(t);

    function addLine(preset: ChatboxPreset | null) {
        onUpdate(
            updateChatboxPage(page.id, (current) => ({
                ...current,
                lines: [
                    ...current.lines,
                    createChatboxLine(meta.defaultFormats, preset, renderPreset)
                ]
            }))
        );
    }

    function handleDragEnd(event: DragEndEvent) {
        if (event.over) {
            onUpdate(
                moveChatboxLine(
                    page.id,
                    String(event.active.id),
                    String(event.over.id)
                )
            );
        }
    }

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
                <Switch
                    size="sm"
                    checked={page.enabled}
                    aria-label={t('view.tools.chatbox.pages.page_enabled')}
                    onCheckedChange={(enabled) =>
                        onUpdate(
                            updateChatboxPage(page.id, (current) => ({
                                ...current,
                                enabled
                            }))
                        )
                    }
                />
                <span
                    className={cn(
                        'flex-1 text-sm font-medium',
                        !page.enabled && 'text-muted-foreground'
                    )}
                >
                    {t('view.tools.chatbox.pages.page', { index: index + 1 })}
                    {page.enabled
                        ? ''
                        : ` · ${t('view.tools.chatbox.pages.page_off')}`}
                </span>
                <SecondsInput
                    value={page.seconds}
                    limits={meta.limits}
                    onCommit={(seconds) =>
                        onUpdate(
                            updateChatboxPage(page.id, (current) => ({
                                ...current,
                                seconds
                            }))
                        )
                    }
                />
                <HintTooltip label={t('view.tools.chatbox.pages.remove_page')}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                            onUpdate((current) => ({
                                ...current,
                                pages: current.pages.filter(
                                    (candidate) => candidate.id !== page.id
                                )
                            }))
                        }
                    >
                        <Trash2Icon />
                    </Button>
                </HintTooltip>
            </div>
            {page.lines.length ? (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={page.lines.map((line) => line.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="flex flex-col gap-3">
                            {page.lines.map((line) => (
                                <SortableRow
                                    key={line.id}
                                    id={line.id}
                                    handleClassName="mt-[11px]"
                                    className="flex items-start gap-1"
                                >
                                    {(handle) => (
                                        <ChatboxLineRow
                                            handle={handle}
                                            line={line}
                                            meta={meta}
                                            presetSamples={presetSamples}
                                            onUpdate={(update) =>
                                                onUpdate(
                                                    updateChatboxLine(
                                                        page.id,
                                                        line.id,
                                                        update
                                                    )
                                                )
                                            }
                                        />
                                    )}
                                </SortableRow>
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            ) : (
                <p className="text-muted-foreground text-xs">
                    {t('view.tools.chatbox.pages.empty_page')}
                </p>
            )}
            {page.lines.length < meta.limits.maxLinesPerPage ? (
                <div>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={<Button variant="ghost" size="xs" />}
                        >
                            <PlusIcon />
                            {t('view.tools.chatbox.pages.add_line')}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-auto min-w-64"
                        >
                            <DropdownMenuItem onClick={() => addLine(null)}>
                                {t('view.tools.chatbox.pages.blank_line')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <ChatboxPresetMenuItems
                                samples={presetSamples}
                                onPick={addLine}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ) : null}
        </div>
    );
}

function ChatboxLineRow({
    handle,
    line,
    meta,
    presetSamples,
    onUpdate
}: {
    handle: ReactNode;
    line: ChatboxPageLine;
    meta: ChatboxEditorMeta;
    presetSamples: PresetSamples;
    onUpdate(update: ChatboxLineUpdate): void;
}) {
    const { t } = useTranslation();

    return (
        <>
            {handle}
            <ChatboxLineEditor
                line={line}
                meta={meta}
                presetSamples={presetSamples}
                onUpdate={onUpdate}
            />
            <HintTooltip label={t('view.tools.chatbox.pages.remove_line')}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-[5px]"
                    onClick={() => onUpdate(() => null)}
                >
                    <XIcon />
                </Button>
            </HintTooltip>
        </>
    );
}

function SecondsInput({
    value,
    limits,
    onCommit
}: {
    value: number;
    limits: ChatboxLimits;
    onCommit(seconds: number): void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useSyncedDraft(String(value));

    return (
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
            <Input
                type="number"
                min={limits.minPageSeconds}
                max={limits.maxPageSeconds}
                value={draft}
                className="h-7 w-16"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    const parsed = Number.parseInt(draft, 10);
                    const seconds = Number.isFinite(parsed)
                        ? Math.min(
                              Math.max(parsed, limits.minPageSeconds),
                              limits.maxPageSeconds
                          )
                        : value;
                    setDraft(String(seconds));
                    if (seconds !== value) {
                        onCommit(seconds);
                    }
                }}
            />
            {t('view.tools.chatbox.pages.seconds')}
        </label>
    );
}
