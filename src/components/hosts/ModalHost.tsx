import { REGEXP_ONLY_DIGITS, REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp';
import { useTranslation } from 'react-i18next';

import { BoopEmojiDialog } from '@/components/dialogs/BoopEmojiDialog';
import { FullscreenImageViewer } from '@/components/media/FullscreenImageViewer';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
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

function matchesPromptPattern(pattern: any, value: any) {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(value ?? '');
}

function normalizeRecoveryCode(value: any) {
    return (value ?? '')
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, RECOVERY_CODE_LENGTH);
}

function getOtpInputValue(value: any, mode: any) {
    if (mode === 'otp') {
        return normalizeRecoveryCode(value);
    }

    return value ?? '';
}

function renderOtpSlots(count: any, offset: any = 0) {
    return Array.from({ length: count }, (_: any, index: any) => (
        <InputOTPSlot key={offset + index} index={offset + index} />
    ));
}

export function ModalHost() {
    const { t } = useTranslation();

    const alertDialog = useModalStore((state: any) => state.alertDialog);
    const promptDialog = useModalStore((state: any) => state.promptDialog);
    const boopDialog = useModalStore((state: any) => state.boopDialog);
    const otpDialog = useModalStore((state: any) => state.otpDialog);
    const imageDialog = useModalStore((state: any) => state.imageDialog);
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state: any) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
                state.auth.currentUserSnapshot?.tags?.includes?.(
                    'system_supporter'
                ) ||
                globalThis?.$debug?.debugVrcPlus
        )
    );
    const handleOk = useModalStore((state: any) => state.handleOk);
    const handleCancel = useModalStore((state: any) => state.handleCancel);
    const handleDismiss = useModalStore((state: any) => state.handleDismiss);
    const handlePromptOk = useModalStore((state: any) => state.handlePromptOk);
    const handlePromptCancel = useModalStore(
        (state: any) => state.handlePromptCancel
    );
    const handlePromptDismiss = useModalStore(
        (state: any) => state.handlePromptDismiss
    );
    const handleBoopOk = useModalStore((state: any) => state.handleBoopOk);
    const handleBoopDismiss = useModalStore(
        (state: any) => state.handleBoopDismiss
    );
    const handleOtpOk = useModalStore((state: any) => state.handleOtpOk);
    const handleOtpCancel = useModalStore((state: any) => state.handleOtpCancel);
    const handleOtpDismiss = useModalStore((state: any) => state.handleOtpDismiss);
    const closeImagePreview = useModalStore((state: any) => state.closeImagePreview);
    const updatePromptValue = useModalStore((state: any) => state.updatePromptValue);
    const updateOtpValue = useModalStore((state: any) => state.updateOtpValue);
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
                onOpenChange={(open: any) => {
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
                onOpenChange={(open: any) => {
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
                            onChange={(event: any) =>
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
                            onChange={(event: any) =>
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
            <BoopEmojiDialog
                open={boopDialog.open}
                endpoint={boopDialog.endpoint || currentEndpoint}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                targetLabel={boopDialog.targetLabel}
                onOpenChange={(open: any) => {
                    if (!open) {
                        handleBoopDismiss('');
                    }
                }}
                onSend={(emojiId: string) => handleBoopOk(emojiId)}
            />
            <Dialog
                open={otpDialog.open}
                onOpenChange={(open: any) => {
                    if (!open) {
                        handleOtpDismiss(otpDialog.value);
                    }
                }}
            >
                <DialogContent
                    onPointerDownOutside={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                >
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
                            onChange={(value: any) =>
                                updateOtpValue(
                                    getOtpInputValue(value, otpDialog.mode)
                                )
                            }
                            onComplete={(value: any) =>
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
