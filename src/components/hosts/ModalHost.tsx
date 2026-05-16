// @ts-nocheck
import { REGEXP_ONLY_DIGITS, REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp';
import { useTranslation } from 'react-i18next';

import { FullscreenImageViewer } from '@/components/media/FullscreenImageViewer';
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
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSeparator,
    InputOTPSlot
} from '@/ui/shadcn/input-otp';
import { Textarea } from '@/ui/shadcn/textarea';

const OTP_CODE_LENGTH = 6;
const RECOVERY_CODE_LENGTH = 8;

function matchesPromptPattern(pattern, value) {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(value ?? '');
}

function normalizeRecoveryCode(value) {
    return (value ?? '')
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, RECOVERY_CODE_LENGTH);
}

function getOtpInputValue(value, mode) {
    if (mode === 'otp') {
        return normalizeRecoveryCode(value);
    }

    return value ?? '';
}

function renderOtpSlots(count, offset = 0) {
    return Array.from({ length: count }, (_, index) => (
        <InputOTPSlot key={offset + index} index={offset + index} />
    ));
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
    const otpValue = getOtpInputValue(otpDialog.value, otpDialog.mode);
    const otpIsRecoveryCode = otpDialog.mode === 'otp';

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
                            placeholder={t(
                                'dialog.tools.label.prompt_value'
                            )}
                            className="min-h-32"
                        />
                    ) : (
                        <Input
                            type={promptDialog.inputType}
                            value={promptDialog.value}
                            onChange={(event) =>
                                updatePromptValue(event.target.value)
                            }
                            placeholder={t(
                                'dialog.tools.label.prompt_value'
                            )}
                        />
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                                handlePromptCancel(promptDialog.value)
                            }
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
                    <div className="flex justify-center">
                        <InputOTP
                            value={otpValue}
                            maxLength={
                                otpIsRecoveryCode
                                    ? RECOVERY_CODE_LENGTH
                                    : OTP_CODE_LENGTH
                            }
                            inputMode={otpIsRecoveryCode ? 'text' : 'numeric'}
                            pattern={
                                otpIsRecoveryCode
                                    ? REGEXP_ONLY_DIGITS_AND_CHARS
                                    : REGEXP_ONLY_DIGITS
                            }
                            autoFocus
                            pasteTransformer={
                                otpIsRecoveryCode
                                    ? normalizeRecoveryCode
                                    : undefined
                            }
                            onChange={(value) =>
                                updateOtpValue(
                                    getOtpInputValue(value, otpDialog.mode)
                                )
                            }
                            onComplete={(value) =>
                                handleOtpOk(
                                    getOtpInputValue(value, otpDialog.mode)
                                )
                            }
                        >
                            {otpIsRecoveryCode ? (
                                <>
                                    <InputOTPGroup>
                                        {renderOtpSlots(4)}
                                    </InputOTPGroup>
                                    <InputOTPSeparator />
                                    <InputOTPGroup>
                                        {renderOtpSlots(4, 4)}
                                    </InputOTPGroup>
                                </>
                            ) : (
                                <InputOTPGroup>
                                    {renderOtpSlots(OTP_CODE_LENGTH)}
                                </InputOTPGroup>
                            )}
                        </InputOTP>
                    </div>
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
