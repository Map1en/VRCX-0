import { useTranslation } from 'react-i18next';
import { FullscreenImageViewer } from '@/components/media/FullscreenImageViewer.jsx';
import { useModalStore } from '@/state/modalStore.js';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
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
import { Textarea } from '@/ui/shadcn/textarea';

function matchesPromptPattern(pattern, value) {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(value ?? '');
}

export function ModalHost() {
    const { t } = useTranslation();

    const alertDialog = useModalStore((state) => state.alertDialog);
    const promptDialog = useModalStore((state) => state.promptDialog);
    const otpDialog = useModalStore((state) => state.otpDialog);
    const imageDialog = useModalStore((state) => state.imageDialog);
    const handleOk = useModalStore((state) => state.handleOk);
    const handleCancel = useModalStore((state) => state.handleCancel);
    const handleDismiss = useModalStore((state) => state.handleDismiss);
    const handlePromptOk = useModalStore((state) => state.handlePromptOk);
    const handlePromptCancel = useModalStore(
        (state) => state.handlePromptCancel
    );
    const handlePromptDismiss = useModalStore(
        (state) => state.handlePromptDismiss
    );
    const handleOtpOk = useModalStore((state) => state.handleOtpOk);
    const handleOtpCancel = useModalStore((state) => state.handleOtpCancel);
    const handleOtpDismiss = useModalStore((state) => state.handleOtpDismiss);
    const closeImagePreview = useModalStore((state) => state.closeImagePreview);
    const updatePromptValue = useModalStore((state) => state.updatePromptValue);
    const updateOtpValue = useModalStore((state) => state.updateOtpValue);
    const promptValueIsValid = matchesPromptPattern(
        promptDialog.inputPattern,
        promptDialog.value
    );

    return (
        <>
            <AlertDialog
                open={alertDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        handleDismiss();
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{alertDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {alertDialog.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {alertDialog.mode === 'confirm' ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCancel}
                            >
                                {alertDialog.cancelText}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant={
                                alertDialog.destructive
                                    ? 'destructive'
                                    : 'default'
                            }
                            onClick={handleOk}
                        >
                            {alertDialog.confirmText}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Dialog
                open={promptDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        handlePromptDismiss(promptDialog.value);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{promptDialog.title}</DialogTitle>
                        <DialogDescription>
                            {promptDialog.description}
                        </DialogDescription>
                    </DialogHeader>
                    {promptDialog.multiline ? (
                        <Textarea
                            value={promptDialog.value}
                            onChange={(event) =>
                                updatePromptValue(event.target.value)
                            }
                            placeholder={t('dialog.tools.generated.prompt_value')}
                            className="min-h-32"
                        />
                    ) : (
                        <Input
                            type={promptDialog.inputType}
                            value={promptDialog.value}
                            onChange={(event) =>
                                updatePromptValue(event.target.value)
                            }
                            placeholder={t('dialog.tools.generated.prompt_value')}
                        />
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handlePromptCancel(promptDialog.value)}
                        >
                            {promptDialog.cancelText}
                        </Button>
                        <Button
                            type="button"
                            disabled={!promptValueIsValid}
                            onClick={() => handlePromptOk(promptDialog.value)}
                        >
                            {promptDialog.confirmText}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={otpDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        handleOtpDismiss(otpDialog.value);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{otpDialog.title}</DialogTitle>
                        <DialogDescription>
                            {otpDialog.description}
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={otpDialog.value}
                        onChange={(event) => updateOtpValue(event.target.value)}
                        placeholder={
                            otpDialog.mode === 'emailOtp' ? 'Email OTP' : 'OTP'
                        }
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOtpCancel(otpDialog.value)}
                        >
                            {otpDialog.cancelText}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => handleOtpOk(otpDialog.value)}
                        >
                            {otpDialog.confirmText}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <FullscreenImageViewer
                open={imageDialog.open}
                url={imageDialog.url}
                title={imageDialog.title}
                fileName={imageDialog.fileName}
                sourcePath={imageDialog.sourcePath}
                onClose={closeImagePreview}
            />
        </>
    );
}
