import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCompactDateTime } from '@/lib/dateTime';
import {
    commands,
    type ScreenshotShareFacts,
    type ScreenshotShareFields,
    type ScreenshotShareMessage
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useScreenshotShareStore } from '@/state/screenshotShareStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { buildScreenshotShareMessages } from './screenshotShareMessages';
import { ScreenshotShareOptions } from './ScreenshotShareOptions';
import {
    shareScreenshots,
    screenshotShareText
} from './screenshotShareService';

function MessagePreview({ message }: { message: ScreenshotShareMessage }) {
    const { t } = useTranslation();
    const embed = message.embed;
    return (
        <div className="bg-muted/40 grid gap-1 rounded-md border-l-4 border-l-indigo-400 px-3 py-2 text-xs">
            {embed?.title ? (
                <span className="text-sm font-semibold">{embed.title}</span>
            ) : null}
            {embed?.fields.map((field) => (
                <span key={field.name}>
                    <span className="font-medium">{field.name}</span>{' '}
                    <span className="text-muted-foreground">{field.value}</span>
                </span>
            ))}
            {embed?.timestamp ? (
                <span className="text-muted-foreground">
                    {formatCompactDateTime(embed.timestamp)}
                </span>
            ) : null}
            <span className="text-muted-foreground">
                {t('view.tools.screenshot_share.preview.images', {
                    count: message.paths.length
                })}
                {message.spoiler
                    ? ` · ${t('view.tools.screenshot_share.spoiler')}`
                    : ''}
            </span>
        </div>
    );
}

export function ScreenshotShareDialog({
    open,
    paths,
    initialTargetId,
    onOpenChange
}: {
    open: boolean;
    paths: string[];
    initialTargetId: string | null;
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation();
    const targets = useScreenshotShareStore((state) => state.targets);
    const save = useScreenshotShareStore((state) => state.save);
    const sending = useScreenshotShareStore((state) => state.sending);
    const validTargets = targets.filter((item) => !item.invalid);
    const [targetId, setTargetId] = useState<string | null>(initialTargetId);
    const target =
        validTargets.find((item) => item.id === targetId) ??
        validTargets[0] ??
        null;
    const [fields, setFields] = useState<ScreenshotShareFields | null>(
        target?.fields ?? null
    );
    const [remember, setRemember] = useState(false);
    const [facts, setFacts] = useState<ScreenshotShareFacts[] | null>(null);

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

    const effectiveFields = fields ?? target?.fields ?? null;
    const messages =
        facts && effectiveFields
            ? buildScreenshotShareMessages(
                  facts,
                  effectiveFields,
                  screenshotShareText()
              )
            : [];
    const targetItems = validTargets.map((item) => ({
        value: item.id,
        label: item.name
    }));

    async function send() {
        if (!target || !effectiveFields) {
            return;
        }
        onOpenChange(false);
        if (remember) {
            try {
                await save({
                    id: target.id,
                    name: target.name,
                    url: null,
                    fields: effectiveFields,
                    quick: target.quick
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error ? error.message : String(error)
                });
            }
        }
        await shareScreenshots({
            paths,
            targets: [target],
            fields: effectiveFields
        });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.tools.screenshot_share.dialog.title', {
                            count: paths.length
                        })}
                    </DialogTitle>
                </DialogHeader>
                <div className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="screenshot-share-dialog-target">
                            {t('view.tools.screenshot_share.dialog.target')}
                        </Label>
                        <Select
                            value={target?.id ?? null}
                            items={targetItems}
                            onValueChange={(value) => {
                                const next = validTargets.find(
                                    (item) => item.id === value
                                );
                                if (next) {
                                    setTargetId(next.id);
                                    setFields(next.fields);
                                }
                            }}
                        >
                            <SelectTrigger
                                id="screenshot-share-dialog-target"
                                className="w-full"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {targetItems.map((item) => (
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
                    {effectiveFields ? (
                        <ScreenshotShareOptions
                            idPrefix="screenshot-share-dialog"
                            value={effectiveFields}
                            onChange={setFields}
                        />
                    ) : null}
                    {messages.length ? (
                        <div className="grid gap-2">
                            <span className="text-sm font-medium">
                                {t(
                                    'view.tools.screenshot_share.preview.title',
                                    { count: messages.length }
                                )}
                            </span>
                            <div className="grid max-h-56 gap-2 overflow-y-auto">
                                {messages.map((message) => (
                                    <MessagePreview
                                        key={message.paths[0]}
                                        message={message}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={remember}
                            onCheckedChange={setRemember}
                        />
                        {t('view.tools.screenshot_share.dialog.remember')}
                    </label>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!target || !effectiveFields || sending}
                        onClick={() => void send()}
                    >
                        {t('view.tools.screenshot_share.dialog.send')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
