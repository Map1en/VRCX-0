import { CopyIcon, FolderDownIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { convertFileSrc } from '@/platform/tauri/assets';
import { commands, type ScreenshotShareFacts } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import {
    useScreenshotPrintOptionsStore,
    type ScreenshotPrintOptions,
    type ScreenshotPrintPeople,
    type ScreenshotPrintStyle
} from '@/state/screenshotPrintOptionsStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    renderScreenshotPrintCaption,
    type PrintContent
} from './screenshotPrintCaption';
import {
    copyScreenshotPrint,
    saveScreenshotPrints
} from './screenshotPrintService';

const NOTE_MAX_LENGTH = 60;
const PEOPLE_SEARCH_MIN = 8;
const PREVIEW_DELAY_MS = 150;
const STYLES: ScreenshotPrintStyle[] = ['modern', 'classic'];
const PEOPLE: ScreenshotPrintPeople[] = ['count', 'names', 'off'];

function isStyle(value: unknown): value is ScreenshotPrintStyle {
    return STYLES.some((style) => style === value);
}

function isPeople(value: unknown): value is ScreenshotPrintPeople {
    return PEOPLE.some((people) => people === value);
}

function PeoplePicker({
    names,
    selected,
    onChange
}: {
    names: string[];
    selected: string[];
    onChange(selected: string[]): void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const needle = query.trim().toLocaleLowerCase();
    const visible = needle
        ? names.filter((name) => name.toLocaleLowerCase().includes(needle))
        : names;

    function toggle(name: string, checked: boolean) {
        onChange(
            checked
                ? names.filter(
                      (item) => item === name || selected.includes(item)
                  )
                : selected.filter((item) => item !== name)
        );
    }

    return (
        <div className="grid gap-2 rounded-md border p-2">
            <div className="flex items-center gap-1">
                <span className="text-muted-foreground flex-1 text-xs">
                    {t('view.tools.screenshot_print.people_selected', {
                        count: selected.length,
                        total: names.length
                    })}
                </span>
                <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => onChange(names)}
                >
                    {t('view.tools.screenshot_print.people_all')}
                </Button>
                <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => onChange([])}
                >
                    {t('view.tools.screenshot_print.people_none')}
                </Button>
            </div>
            {names.length > PEOPLE_SEARCH_MIN ? (
                <Input
                    value={query}
                    placeholder={t('view.tools.screenshot_print.people_search')}
                    aria-label={t('view.tools.screenshot_print.people_search')}
                    onChange={(event) => setQuery(event.target.value)}
                />
            ) : null}
            <div className="grid max-h-48 gap-1.5 overflow-y-auto pr-1">
                {visible.map((name) => (
                    <label
                        key={name}
                        className="flex min-w-0 items-center gap-2 text-sm"
                    >
                        <Checkbox
                            checked={selected.includes(name)}
                            onCheckedChange={(checked) => toggle(name, checked)}
                        />
                        <span className="truncate">{name}</span>
                    </label>
                ))}
            </div>
            <span className="text-muted-foreground text-xs">
                {t('view.tools.screenshot_print.people_hint')}
            </span>
        </div>
    );
}

function PrintPreview({
    fact,
    options,
    content
}: {
    fact: ScreenshotShareFacts | null;
    options: ScreenshotPrintOptions;
    content: PrintContent;
}) {
    const [caption, setCaption] = useState('');

    useEffect(() => {
        if (!fact) {
            return;
        }
        let active = true;
        const timer = globalThis.setTimeout(() => {
            renderScreenshotPrintCaption(fact, options, content)
                .then((data) => {
                    if (active) {
                        setCaption(`data:image/png;base64,${data}`);
                    }
                })
                .catch((error: unknown) => {
                    console.warn('Print preview failed:', error);
                });
        }, PREVIEW_DELAY_MS);
        return () => {
            active = false;
            globalThis.clearTimeout(timer);
        };
    }, [fact, options, content]);

    return (
        <div className="relative aspect-[2048/1440] w-full overflow-hidden rounded-sm border bg-white">
            {fact ? (
                <img
                    src={convertFileSrc(fact.path, 'vrcx-0-img')}
                    alt=""
                    className="absolute top-[4.79%] left-[3.125%] h-[75%] w-[93.75%] object-contain"
                />
            ) : null}
            {caption ? (
                <img
                    src={caption}
                    alt=""
                    className="absolute bottom-0 left-0 h-[20.21%] w-full"
                />
            ) : null}
        </div>
    );
}

export function ScreenshotPrintDialog({
    open,
    paths,
    onOpenChange
}: {
    open: boolean;
    paths: string[];
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation();
    const saved = useScreenshotPrintOptionsStore((state) => state.options);
    const loadOptions = useScreenshotPrintOptionsStore((state) => state.load);
    const saveOptions = useScreenshotPrintOptionsStore((state) => state.save);
    const [options, setOptions] = useState<ScreenshotPrintOptions | null>(null);
    const [note, setNote] = useState('');
    const [facts, setFacts] = useState<ScreenshotShareFacts[]>([]);
    const [selectedPeople, setSelectedPeople] = useState<string[] | null>(null);
    const current = options ?? saved;
    const names = useMemo(
        () => [...new Set(facts.flatMap((fact) => fact.people))],
        [facts]
    );
    const content = useMemo<PrintContent>(
        () => ({ note, people: selectedPeople }),
        [note, selectedPeople]
    );

    useEffect(() => {
        loadOptions().catch((error: unknown) => {
            console.warn('Print options unavailable:', error);
        });
    }, [loadOptions]);

    useEffect(() => {
        let active = true;
        commands
            .appGetScreenshotShareFacts(paths)
            .then((result) => {
                if (active) {
                    setFacts(result);
                }
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error ? error.message : String(error)
                });
            });
        return () => {
            active = false;
        };
    }, [paths]);

    const styleItems = STYLES.map((style) => ({
        value: style,
        label: t(`view.tools.screenshot_print.style_${style}`)
    }));
    const peopleItems = PEOPLE.map((people) => ({
        value: people,
        label: t(`view.tools.screenshot_print.people_${people}`)
    }));

    function update(patch: Partial<ScreenshotPrintOptions>) {
        setOptions({ ...current, ...patch });
    }

    function finish(
        action: (options: ScreenshotPrintOptions) => Promise<void>
    ) {
        saveOptions(current);
        onOpenChange(false);
        void action(current);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {paths.length > 1
                            ? t(
                                  'view.tools.screenshot_print.dialog_title_many',
                                  {
                                      count: paths.length
                                  }
                              )
                            : t('view.tools.screenshot_print.dialog_title')}
                    </DialogTitle>
                </DialogHeader>
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
                    <PrintPreview
                        fact={facts[0] ?? null}
                        options={current}
                        content={content}
                    />
                    <div className="grid content-start gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="screenshot-print-style">
                                {t('view.tools.screenshot_print.style')}
                            </Label>
                            <Select
                                value={current.style}
                                items={styleItems}
                                onValueChange={(value) => {
                                    if (isStyle(value)) {
                                        update({ style: value });
                                    }
                                }}
                            >
                                <SelectTrigger
                                    id="screenshot-print-style"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {styleItems.map((item) => (
                                            <SelectItem
                                                key={item.value}
                                                value={item.value}
                                            >
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="screenshot-print-note">
                                {t('view.tools.screenshot_print.note')}
                            </Label>
                            <Input
                                id="screenshot-print-note"
                                value={note}
                                maxLength={NOTE_MAX_LENGTH}
                                placeholder={t(
                                    'view.tools.screenshot_print.note_placeholder'
                                )}
                                onChange={(event) =>
                                    setNote(event.target.value)
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="screenshot-print-people">
                                {t('view.tools.screenshot_print.people')}
                            </Label>
                            <Select
                                value={current.people}
                                items={peopleItems}
                                onValueChange={(value) => {
                                    if (isPeople(value)) {
                                        update({ people: value });
                                    }
                                }}
                            >
                                <SelectTrigger
                                    id="screenshot-print-people"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {peopleItems.map((item) => (
                                            <SelectItem
                                                key={item.value}
                                                value={item.value}
                                            >
                                                {item.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        {current.people === 'names' && names.length ? (
                            <PeoplePicker
                                names={names}
                                selected={selectedPeople ?? names}
                                onChange={setSelectedPeople}
                            />
                        ) : null}
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={current.playerCount}
                                onCheckedChange={(playerCount) =>
                                    update({ playerCount })
                                }
                            />
                            {t('view.tools.screenshot_print.player_count')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={current.stay}
                                onCheckedChange={(stay) => update({ stay })}
                            />
                            {t('view.tools.screenshot_print.stay')}
                        </label>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            finish((resolved) =>
                                saveScreenshotPrints(paths, resolved, content)
                            )
                        }
                    >
                        <FolderDownIcon data-icon="inline-start" />
                        {t('view.tools.screenshot_print.save')}
                    </Button>
                    {paths.length === 1 ? (
                        <Button
                            type="button"
                            onClick={() =>
                                finish((resolved) =>
                                    copyScreenshotPrint(
                                        paths[0],
                                        resolved,
                                        content
                                    )
                                )
                            }
                        >
                            <CopyIcon data-icon="inline-start" />
                            {t('view.tools.screenshot_print.copy')}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
