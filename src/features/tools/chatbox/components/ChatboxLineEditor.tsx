import { BracesIcon, PaletteIcon, SparklesIcon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    ChatboxFormats,
    ChatboxMemoryFormat,
    ChatboxMemoryUnit,
    ChatboxPageLine,
    ChatboxProgressStyle
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    applyChatboxPreset,
    CHATBOX_VARIABLE_LABEL_KEYS,
    insertAtCursor,
    templateVariables,
    type ChatboxLineUpdate
} from '../chatboxConfig';
import { CHATBOX_SYMBOLS, type ChatboxPreset } from '../chatboxPresets';
import type { ChatboxEditorMeta } from '../useChatboxController';
import { useSyncedDraft } from '../useSyncedDraft';
import { ChatboxPresetMenuItems } from './ChatboxPresetMenuItems';

const MEMORY_FORMATS: ChatboxMemoryFormat[] = [
    'percent',
    'used',
    'usedOfTotal',
    'total'
];
const MEMORY_UNITS: ChatboxMemoryUnit[] = ['gb', 'mb'];
const PROGRESS_STYLES: ChatboxProgressStyle[] = ['line', 'blocks', 'dots'];
const PROGRESS_SAMPLES: Record<ChatboxProgressStyle, string> = {
    line: '━━━●─────',
    blocks: '▰▰▰▰▱▱▱▱',
    dots: '●●●●○○○○'
};

export function ChatboxLineEditor({
    line,
    meta,
    presetSamples,
    onUpdate
}: {
    line: ChatboxPageLine;
    meta: ChatboxEditorMeta;
    presetSamples: Record<string, string>;
    onUpdate(update: ChatboxLineUpdate): void;
}) {
    const { t } = useTranslation();
    const textarea = useRef<HTMLTextAreaElement>(null);
    const [draft, setDraft] = useSyncedDraft(line.template);
    const used = templateVariables(line.template, meta.variables);
    const renderPreset = (preset: ChatboxPreset) => preset.template(t);

    function commit(text: string) {
        if (text !== line.template) {
            onUpdate((current) => ({ ...current, template: text }));
        }
    }

    function insert(insertion: string) {
        const element = textarea.current;
        const start = element?.selectionStart ?? draft.length;
        const end = element?.selectionEnd ?? draft.length;
        const next = insertAtCursor(draft, insertion, start, end);
        setDraft(next.text);
        commit(next.text);
        requestAnimationFrame(() => {
            element?.focus();
            element?.setSelectionRange(next.cursor, next.cursor);
        });
    }

    function setFormats(update: Partial<ChatboxFormats>) {
        onUpdate((current) => ({
            ...current,
            formats: { ...current.formats, ...update }
        }));
    }

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Textarea
                ref={textarea}
                value={draft}
                rows={Math.min(Math.max(draft.split('\n').length, 1), 6)}
                maxLength={meta.limits.maxTemplateChars}
                placeholder={t(
                    'view.tools.chatbox.editor.template_placeholder'
                )}
                className="min-h-9 resize-none font-mono text-sm"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commit(draft)}
            />
            <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="xs" />}
                    >
                        <BracesIcon />
                        {t('view.tools.chatbox.editor.insert_variable')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="w-auto min-w-72"
                    >
                        {meta.variables.map((variable) => (
                            <DropdownMenuItem
                                key={variable}
                                className="gap-6 whitespace-nowrap"
                                onClick={() => insert(`{${variable}}`)}
                            >
                                <span className="flex-1">
                                    {t(CHATBOX_VARIABLE_LABEL_KEYS[variable])}
                                </span>
                                <code className="text-muted-foreground text-xs">
                                    {`{${variable}}`}
                                </code>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="xs" />}
                    >
                        <SparklesIcon />
                        {t('view.tools.chatbox.editor.insert_symbol')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-auto">
                        <div className="grid grid-cols-6 gap-1 p-1">
                            {CHATBOX_SYMBOLS.map((symbol) => (
                                <DropdownMenuItem
                                    key={symbol}
                                    className="min-w-9 justify-center whitespace-nowrap"
                                    onClick={() => insert(symbol)}
                                >
                                    {symbol}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="xs" />}
                    >
                        <PaletteIcon />
                        {t('view.tools.chatbox.editor.presets')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="w-auto min-w-64"
                    >
                        <ChatboxPresetMenuItems
                            samples={presetSamples}
                            onPick={(preset) =>
                                onUpdate((current) =>
                                    applyChatboxPreset(
                                        current,
                                        preset,
                                        renderPreset
                                    )
                                )
                            }
                        />
                    </DropdownMenuContent>
                </DropdownMenu>
                <FormatControls
                    formats={line.formats}
                    used={used}
                    maxDecimals={meta.limits.maxDecimals}
                    onChange={setFormats}
                />
            </div>
        </div>
    );
}

function FormatControls({
    formats,
    used,
    maxDecimals,
    onChange
}: {
    formats: ChatboxFormats;
    used: Set<string>;
    maxDecimals: number;
    onChange(update: Partial<ChatboxFormats>): void;
}) {
    const { t } = useTranslation();
    const decimals = Array.from({ length: maxDecimals + 1 }, (_, index) =>
        String(index)
    );
    const label = (key: string) => t(`view.tools.chatbox.formats.${key}`);
    const controls = [];

    if (used.has('time')) {
        controls.push(
            <FormatSwitch
                key="hour12"
                label={label('hour12')}
                checked={formats.hour12}
                onChange={(hour12) => onChange({ hour12 })}
            />
        );
    }
    if (used.has('time') || used.has('session')) {
        controls.push(
            <FormatSwitch
                key="seconds"
                label={label('show_seconds')}
                checked={formats.showSeconds}
                onChange={(showSeconds) => onChange({ showSeconds })}
            />
        );
    }
    if (used.has('cpu')) {
        controls.push(
            <FormatSelect
                key="cpu"
                label={label('cpu_decimals')}
                value={String(formats.cpuDecimals)}
                options={decimals}
                optionLabel={(value) => value}
                onChange={(value) => onChange({ cpuDecimals: Number(value) })}
            />
        );
    }
    if (used.has('memory')) {
        controls.push(
            <FormatSelect
                key="memory"
                label={label('memory')}
                value={formats.memory}
                options={MEMORY_FORMATS}
                optionLabel={(value) => label(`memory_${value}`)}
                onChange={(memory) => onChange({ memory })}
            />,
            <FormatSelect
                key="memory-decimals"
                label={label('memory_decimals')}
                value={String(formats.memoryDecimals)}
                options={decimals}
                optionLabel={(value) => value}
                onChange={(value) =>
                    onChange({ memoryDecimals: Number(value) })
                }
            />
        );
        if (formats.memory !== 'percent') {
            controls.push(
                <FormatSelect
                    key="memory-unit"
                    label={label('memory_unit')}
                    value={formats.memoryUnit}
                    options={MEMORY_UNITS}
                    optionLabel={(value) => value.toUpperCase()}
                    onChange={(memoryUnit) => onChange({ memoryUnit })}
                />
            );
        }
    }
    if (used.has('progress')) {
        controls.push(
            <FormatSelect
                key="progress"
                label={label('progress')}
                value={formats.progress}
                options={PROGRESS_STYLES}
                optionLabel={(value) => PROGRESS_SAMPLES[value]}
                onChange={(progress) => onChange({ progress })}
            />
        );
    }

    return controls.length ? (
        <div className="ml-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {controls}
        </div>
    ) : null;
}

function FormatSwitch({
    label,
    checked,
    onChange
}: {
    label: string;
    checked: boolean;
    onChange(checked: boolean): void;
}) {
    return (
        <label className="text-muted-foreground flex items-center gap-2 text-xs whitespace-nowrap">
            {label}
            <Switch size="sm" checked={checked} onCheckedChange={onChange} />
        </label>
    );
}

function FormatSelect<T extends string>({
    label,
    value,
    options,
    optionLabel,
    onChange
}: {
    label: string;
    value: T;
    options: T[];
    optionLabel(value: T): string;
    onChange(value: T): void;
}) {
    return (
        <label className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
            {label}
            <Select
                value={value}
                onValueChange={(next) => {
                    const match = options.find((option) => option === next);
                    if (match) {
                        onChange(match);
                    }
                }}
            >
                <SelectTrigger size="sm" className="h-7 min-w-16">
                    <SelectValue>{optionLabel(value)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="min-w-36">
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem
                                key={option}
                                value={option}
                                className="whitespace-nowrap"
                            >
                                {optionLabel(option)}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </label>
    );
}
