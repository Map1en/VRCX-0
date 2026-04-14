import { useMemo } from 'react';

import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';

import { useModalStore } from '@/state/modalStore.js';

function matchesPromptPattern(pattern, value) {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(value ?? '');
}

export function ModalHost() {
    const alertDialog = useModalStore((state) => state.alertDialog);
    const promptDialog = useModalStore((state) => state.promptDialog);
    const otpDialog = useModalStore((state) => state.otpDialog);
    const imageDialog = useModalStore((state) => state.imageDialog);
    const handleOk = useModalStore((state) => state.handleOk);
    const handleCancel = useModalStore((state) => state.handleCancel);
    const handleDismiss = useModalStore((state) => state.handleDismiss);
    const handlePromptOk = useModalStore((state) => state.handlePromptOk);
    const handlePromptCancel = useModalStore((state) => state.handlePromptCancel);
    const handlePromptDismiss = useModalStore((state) => state.handlePromptDismiss);
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

    const promptFooter = useMemo(
        () => (
            <DialogFooter>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => handlePromptCancel(promptDialog.value)}>
                    {promptDialog.cancelText}
                </Button>
                <Button
                    type="button"
                    disabled={!promptValueIsValid}
                    onClick={() => handlePromptOk(promptDialog.value)}>
                    {promptDialog.confirmText}
                </Button>
            </DialogFooter>
        ),
        [
            handlePromptCancel,
            handlePromptOk,
            promptDialog.cancelText,
            promptDialog.confirmText,
            promptValueIsValid,
            promptDialog.value
        ]
    );

    return (
        <>
            <AlertDialog
                open={alertDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        handleDismiss();
                    }
                }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{alertDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>{alertDialog.description}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {alertDialog.mode === 'confirm' ? (
                            <Button type="button" variant="outline" onClick={handleCancel}>
                                {alertDialog.cancelText}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant={alertDialog.destructive ? 'destructive' : 'default'}
                            onClick={handleOk}>
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
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{promptDialog.title}</DialogTitle>
                        <DialogDescription>{promptDialog.description}</DialogDescription>
                    </DialogHeader>
                    {promptDialog.multiline ? (
                        <Textarea
                            value={promptDialog.value}
                            onChange={(event) => updatePromptValue(event.target.value)}
                            placeholder="Prompt value"
                            className="min-h-32"
                        />
                    ) : (
                        <Input
                            type={promptDialog.inputType}
                            value={promptDialog.value}
                            onChange={(event) => updatePromptValue(event.target.value)}
                            placeholder="Prompt value"
                        />
                    )}
                    {promptFooter}
                </DialogContent>
            </Dialog>

            <Dialog
                open={otpDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        handleOtpDismiss(otpDialog.value);
                    }
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{otpDialog.title}</DialogTitle>
                        <DialogDescription>{otpDialog.description}</DialogDescription>
                    </DialogHeader>
                    <Input
                        value={otpDialog.value}
                        onChange={(event) => updateOtpValue(event.target.value)}
                        placeholder={otpDialog.mode === 'emailOtp' ? 'Email OTP' : 'OTP'}
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOtpCancel(otpDialog.value)}>
                            {otpDialog.cancelText}
                        </Button>
                        <Button type="button" onClick={() => handleOtpOk(otpDialog.value)}>
                            {otpDialog.confirmText}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={imageDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        closeImagePreview();
                    }
                }}>
                <DialogContent className="gpu-sensitive-blur max-w-[90vw]">
                    <DialogHeader>
                        <DialogTitle>{imageDialog.title || 'Image Preview'}</DialogTitle>
                    </DialogHeader>
                    {imageDialog.url ? (
                        <img
                            src={imageDialog.url}
                            alt={imageDialog.title || ''}
                            className="max-h-[80vh] w-full object-contain"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    );
}
