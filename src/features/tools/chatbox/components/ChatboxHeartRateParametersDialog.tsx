import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type HeartRateParameters } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
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

type Slot = keyof HeartRateParameters;
type Drafts = Record<Slot, string>;

const SLOTS: Slot[] = ['value', 'beat', 'connected', 'percent'];

function toDrafts(parameters: HeartRateParameters): Drafts {
    return {
        value: parameters.value.join(', '),
        beat: parameters.beat.join(', '),
        connected: parameters.connected.join(', '),
        percent: parameters.percent.join(', ')
    };
}

function toParameters(drafts: Drafts): HeartRateParameters {
    const names = (draft: string) =>
        draft
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== '');
    return {
        value: names(drafts.value),
        beat: names(drafts.beat),
        connected: names(drafts.connected),
        percent: names(drafts.percent)
    };
}

export function ChatboxHeartRateParametersDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
}) {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState<Drafts | null>(null);
    const [defaults, setDefaults] = useState<HeartRateParameters | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        let active = true;
        commands.appHeartRateParametersGet().then(
            (editor) => {
                if (active) {
                    setDrafts(toDrafts(editor.parameters));
                    setDefaults(editor.defaults);
                }
            },
            (error: unknown) =>
                console.warn('Failed to load heart rate parameters:', error)
        );
        return () => {
            active = false;
        };
    }, [open]);

    function save() {
        if (!drafts) {
            return;
        }
        setSaving(true);
        commands
            .appHeartRateParametersSet(toParameters(drafts))
            .then(
                () => onOpenChange(false),
                () =>
                    toast.add({
                        type: 'error',
                        title: t(
                            'view.tools.chatbox.heart_rate.parameters.save_failed'
                        )
                    })
            )
            .finally(() => setSaving(false));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.tools.chatbox.heart_rate.parameters.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.tools.chatbox.heart_rate.parameters.description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    {SLOTS.map((slot) => (
                        <label key={slot} className="flex flex-col gap-1">
                            <span className="text-sm">
                                {t(
                                    `view.tools.chatbox.heart_rate.parameters.${slot}`
                                )}
                            </span>
                            <Input
                                value={drafts?.[slot] ?? ''}
                                disabled={!drafts}
                                spellCheck={false}
                                onChange={(event) =>
                                    setDrafts((current) =>
                                        current
                                            ? {
                                                  ...current,
                                                  [slot]: event.target.value
                                              }
                                            : current
                                    )
                                }
                            />
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    `view.tools.chatbox.heart_rate.parameters.${slot}_hint`
                                )}
                            </span>
                        </label>
                    ))}
                    <p className="text-muted-foreground text-xs">
                        {t('view.tools.chatbox.heart_rate.parameters.vrcosc')}
                    </p>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        className="sm:mr-auto"
                        disabled={!defaults || saving}
                        onClick={() =>
                            defaults && setDrafts(toDrafts(defaults))
                        }
                    >
                        {t('common.actions.reset')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!drafts || saving}
                        onClick={save}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
