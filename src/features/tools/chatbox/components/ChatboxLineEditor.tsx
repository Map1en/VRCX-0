import { BracesIcon, PaletteIcon, SparklesIcon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    ChatboxFormats,
    ChatboxMemoryFormat,
    ChatboxMemoryUnit,
    ChatboxPageLine,
    ChatboxProgressStyle,
    ChatboxTemperatureUnit
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
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
const TEMPERATURE_UNITS: ChatboxTemperatureUnit[] = ['celsius', 'fahrenheit'];
const TEMPERATURE_SYMBOLS: Record<ChatboxTemperatureUnit, string> = {
    celsius: '°C',
    fahrenheit: '°F'
};
const MEDIA_TEXT_VARIABLES = ['track', 'title', 'artist', 'album'];
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
                    maxChars={meta.limits.maxChars}
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
    maxChars,
    onChange
}: {
    formats: ChatboxFormats;
    used: Set<string>;
    maxDecimals: number;
    maxChars: number;
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
    if (MEDIA_TEXT_VARIABLES.some((variable) => used.has(variable))) {
        controls.push(
            <FormatCharLimit
                key="media-max-chars"
                label={label('media_max_chars')}
                placeholder={label('media_max_chars_unlimited')}
                value={formats.mediaMaxChars}
                max={maxChars}
                onChange={(mediaMaxChars) => onChange({ mediaMaxChars })}
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
            ...memoryControls({
                key: 'memory',
                label,
                decimals,
                format: formats.memory,
                decimalsValue: formats.memoryDecimals,
                unit: formats.memoryUnit,
                onFormat: (memory) => onChange({ memory }),
                onDecimals: (memoryDecimals) => onChange({ memoryDecimals }),
                onUnit: (memoryUnit) => onChange({ memoryUnit })
            })
        );
    }
    if (used.has('gpu')) {
        controls.push(
            <FormatSelect
                key="gpu"
                label={label('gpu_decimals')}
                value={String(formats.gpuDecimals)}
                options={decimals}
                optionLabel={(value) => value}
                onChange={(value) => onChange({ gpuDecimals: Number(value) })}
            />
        );
    }
    if (used.has('vram')) {
        controls.push(
            ...memoryControls({
                key: 'vram',
                label,
                decimals,
                format: formats.vram,
                decimalsValue: formats.vramDecimals,
                unit: formats.vramUnit,
                onFormat: (vram) => onChange({ vram }),
                onDecimals: (vramDecimals) => onChange({ vramDecimals }),
                onUnit: (vramUnit) => onChange({ vramUnit })
            })
        );
    }
    if (used.has('gputemp')) {
        controls.push(
            <FormatSelect
                key="temperature-unit"
                label={label('temperature_unit')}
                value={formats.temperatureUnit}
                options={TEMPERATURE_UNITS}
                optionLabel={(value) => TEMPERATURE_SYMBOLS[value]}
                onChange={(temperatureUnit) => onChange({ temperatureUnit })}
            />
        );
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

function memoryControls({
    key,
    label,
    decimals,
    format,
    decimalsValue,
    unit,
    onFormat,
    onDecimals,
    onUnit
}: {
    key: 'memory' | 'vram';
    label(key: string): string;
    decimals: string[];
    format: ChatboxMemoryFormat;
    decimalsValue: number;
    unit: ChatboxMemoryUnit;
    onFormat(format: ChatboxMemoryFormat): void;
    onDecimals(decimals: number): void;
    onUnit(unit: ChatboxMemoryUnit): void;
}) {
    const controls = [
        <FormatSelect
            key={key}
            label={label(key)}
            value={format}
            options={MEMORY_FORMATS}
            optionLabel={(value) => label(`memory_${value}`)}
            onChange={onFormat}
        />,
        <FormatSelect
            key={`${key}-decimals`}
            label={label(`${key}_decimals`)}
            value={String(decimalsValue)}
            options={decimals}
            optionLabel={(value) => value}
            onChange={(value) => onDecimals(Number(value))}
        />
    ];
    if (format !== 'percent') {
        controls.push(
            <FormatSelect
                key={`${key}-unit`}
                label={label('memory_unit')}
                value={unit}
                options={MEMORY_UNITS}
                optionLabel={(value) => value.toUpperCase()}
                onChange={onUnit}
            />
        );
    }
    return controls;
}

function FormatCharLimit({
    label,
    placeholder,
    value,
    max,
    onChange
}: {
    label: string;
    placeholder: string;
    value: number;
    max: number;
    onChange(value: number): void;
}) {
    const [draft, setDraft] = useSyncedDraft(value ? String(value) : '');

    function commit() {
        const parsed = Number.parseInt(draft, 10);
        const next =
            Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : 0;
        setDraft(next ? String(next) : '');
        if (next !== value) {
            onChange(next);
        }
    }

    return (
        <label className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
            {label}
            <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={draft}
                placeholder={placeholder}
                className="h-7 w-16 text-xs md:text-xs"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.currentTarget.blur();
                    }
                }}
            />
        </label>
    );
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
