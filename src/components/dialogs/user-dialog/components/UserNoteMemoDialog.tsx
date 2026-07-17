import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Textarea } from '@/ui/shadcn/textarea';

export type UserNoteMemoDialogProps = {
    open: boolean;
    targetLabel: string;
    editingCurrentUser: boolean;
    note: string;
    memo: string;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onNoteChange: (note: string) => void;
    onMemoChange: (memo: string) => void;
    onCancel: () => void;
    onSave: () => void;
};

export function UserNoteMemoDialog({
    open,
    targetLabel,
    editingCurrentUser,
    note,
    memo,
    saving,
    onOpenChange,
    onNoteChange,
    onMemoChange,
    onCancel,
    onSave
}: UserNoteMemoDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.note_memo.header')}
                    </DialogTitle>
                    {targetLabel ? (
                        <DialogDescription>{targetLabel}</DialogDescription>
                    ) : null}
                </DialogHeader>
                <FieldGroup>
                    {!editingCurrentUser ? (
                        <Field>
                            <FieldLabel htmlFor="user-note-memo-note">
                                {t('dialog.user.info.note')}
                            </FieldLabel>
                            <Textarea
                                id="user-note-memo-note"
                                value={note}
                                maxLength={256}
                                disabled={saving}
                                className="min-h-24 resize-y"
                                onChange={(event) =>
                                    onNoteChange(event.target.value)
                                }
                            />
                            <FieldDescription className="text-right text-xs">
                                {String(note || '').length}/256
                            </FieldDescription>
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel htmlFor="user-note-memo-memo">
                            {t('dialog.user.info.memo')}
                        </FieldLabel>
                        <Textarea
                            id="user-note-memo-memo"
                            value={memo}
                            disabled={saving}
                            className="min-h-32 resize-y"
                            onChange={(event) =>
                                onMemoChange(event.target.value)
                            }
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={onCancel}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button type="button" disabled={saving} onClick={onSave}>
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
