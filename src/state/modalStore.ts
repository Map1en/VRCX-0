import { create } from 'zustand';

type AlertMode = 'alert' | 'confirm';
type OtpMode = 'totp' | 'emailOtp' | 'otp';
type ModalResult = {
    ok: boolean;
    reason: string;
    value?: unknown;
};
type ModalResolver = (result: ModalResult) => void;
type AlertDialogState = {
    open: boolean;
    mode: AlertMode;
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
    dismissible: boolean;
    destructive: boolean;
};
type PromptDialogState = {
    open: boolean;
    title: string;
    description: string;
    value: unknown;
    confirmText: string;
    cancelText: string;
    dismissible: boolean;
    inputType: string;
    inputPattern: RegExp | null;
    multiline: boolean;
};
type OtpDialogState = {
    open: boolean;
    title: string;
    description: string;
    value: unknown;
    mode: OtpMode;
    confirmText: string;
    cancelText: string;
    dismissible: boolean;
};
type ImageDialogState = {
    open: boolean;
    url: string;
    title: string;
    fileName: string;
    sourcePath: string;
};
type BoopDialogState = {
    open: boolean;
    endpoint: string;
    targetLabel: string;
    dismissible: boolean;
};
type AlertDialogOptions = Partial<AlertDialogState>;
type PromptDialogOptions = Partial<PromptDialogState> & {
    inputValue?: string;
    pattern?: RegExp | null;
};
type OtpDialogOptions = Partial<OtpDialogState>;
type ImageDialogOptions = Partial<ImageDialogState>;
type BoopDialogOptions = Partial<BoopDialogState>;
type ModalStore = {
    alertDialog: AlertDialogState;
    promptDialog: PromptDialogState;
    otpDialog: OtpDialogState;
    imageDialog: ImageDialogState;
    boopDialog: BoopDialogState;
    alert(options?: AlertDialogOptions): Promise<ModalResult>;
    confirm(options?: AlertDialogOptions): Promise<ModalResult>;
    prompt(options?: PromptDialogOptions): Promise<ModalResult>;
    boopPrompt(options?: BoopDialogOptions): Promise<ModalResult>;
    otpPrompt(options?: OtpDialogOptions): Promise<ModalResult>;
    openAlert(options?: AlertDialogOptions): Promise<ModalResult>;
    openPrompt(options?: PromptDialogOptions): Promise<ModalResult>;
    openOtp(options?: OtpDialogOptions): Promise<ModalResult>;
    openImagePreview(options?: ImageDialogOptions): void;
    updatePromptValue(value: unknown): void;
    updateOtpValue(value: unknown): void;
    handleOk(): void;
    handleCancel(): void;
    handleDismiss(): void;
    handlePromptOk(value?: unknown): void;
    handlePromptCancel(value?: unknown): void;
    handlePromptDismiss(value?: unknown): void;
    handleBoopOk(value?: unknown): void;
    handleBoopCancel(value?: unknown): void;
    handleBoopDismiss(value?: unknown): void;
    handleOtpOk(value?: unknown): void;
    handleOtpCancel(value?: unknown): void;
    handleOtpDismiss(value?: unknown): void;
    closeAlert(): void;
    closePrompt(): void;
    closeBoop(): void;
    closeOtp(): void;
    closeImagePreview(): void;
    resetModalState(): void;
};

const createAlertDialogState = (): AlertDialogState => ({
    open: false,
    mode: 'alert',
    title: '',
    description: '',
    confirmText: 'OK',
    cancelText: 'Cancel',
    dismissible: true,
    destructive: false
});

const createPromptDialogState = (): PromptDialogState => ({
    open: false,
    title: '',
    description: '',
    value: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    dismissible: true,
    inputType: 'text',
    inputPattern: null,
    multiline: false
});

const createOtpDialogState = (): OtpDialogState => ({
    open: false,
    title: '',
    description: '',
    value: '',
    mode: 'totp',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    dismissible: true
});

const createImageDialogState = (): ImageDialogState => ({
    open: false,
    url: '',
    title: '',
    fileName: '',
    sourcePath: ''
});

const createBoopDialogState = (): BoopDialogState => ({
    open: false,
    endpoint: '',
    targetLabel: '',
    dismissible: true
});

function createResult(
    ok: boolean,
    reason: string,
    value?: unknown
): ModalResult {
    return {
        ok,
        reason,
        value
    };
}

function matchesPromptPattern(pattern: unknown, value: unknown): boolean {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(String(value ?? ''));
}

export const useModalStore = create<ModalStore>((set: any, get: any) => {
    let pendingAlert: ModalResolver | null = null;
    let pendingPrompt: ModalResolver | null = null;
    let pendingBoop: ModalResolver | null = null;
    let pendingOtp: ModalResolver | null = null;

    function resolveAlert(result: ModalResult) {
        const resolver = pendingAlert;
        pendingAlert = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolvePrompt(result: ModalResult) {
        const resolver = pendingPrompt;
        pendingPrompt = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolveBoop(result: ModalResult) {
        const resolver = pendingBoop;
        pendingBoop = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolveOtp(result: ModalResult) {
        const resolver = pendingOtp;
        pendingOtp = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function openBaseAlert(mode: AlertMode, options: AlertDialogOptions = {}) {
        if (pendingAlert) {
            resolveAlert(createResult(false, 'replaced'));
        }

        set({
            alertDialog: {
                ...createAlertDialogState(),
                ...options,
                mode,
                open: true
            }
        });

        return new Promise<ModalResult>((resolve: any) => {
            pendingAlert = resolve;
        });
    }

    function openBasePrompt(options: PromptDialogOptions = {}) {
        if (pendingPrompt) {
            resolvePrompt(
                createResult(false, 'replaced', get().promptDialog.value)
            );
        }

        set({
            promptDialog: {
                ...createPromptDialogState(),
                ...options,
                value:
                    typeof options.inputValue === 'string'
                        ? options.inputValue
                        : createPromptDialogState().value,
                inputType:
                    typeof options.inputType === 'string'
                        ? options.inputType
                        : createPromptDialogState().inputType,
                inputPattern: options.pattern ?? null,
                multiline: Boolean(options.multiline),
                open: true
            }
        });

        return new Promise<ModalResult>((resolve: any) => {
            pendingPrompt = resolve;
        });
    }

    function openBaseBoop(options: BoopDialogOptions = {}) {
        if (pendingBoop) {
            resolveBoop(createResult(false, 'replaced'));
        }

        set({
            boopDialog: {
                ...createBoopDialogState(),
                ...options,
                open: true,
                endpoint:
                    typeof options.endpoint === 'string'
                        ? options.endpoint
                        : '',
                targetLabel:
                    typeof options.targetLabel === 'string'
                        ? options.targetLabel
                        : ''
            }
        });

        return new Promise<ModalResult>((resolve: any) => {
            pendingBoop = resolve;
        });
    }

    function openBaseOtp(options: OtpDialogOptions = {}) {
        if (pendingOtp) {
            resolveOtp(createResult(false, 'replaced', get().otpDialog.value));
        }

        set({
            otpDialog: {
                ...createOtpDialogState(),
                ...options,
                mode:
                    options.mode === 'emailOtp' || options.mode === 'otp'
                        ? options.mode
                        : 'totp',
                open: true
            }
        });

        return new Promise<ModalResult>((resolve: any) => {
            pendingOtp = resolve;
        });
    }

    return {
        alertDialog: createAlertDialogState(),
        promptDialog: createPromptDialogState(),
        otpDialog: createOtpDialogState(),
        imageDialog: createImageDialogState(),
        boopDialog: createBoopDialogState(),
        alert(options: any) {
            return openBaseAlert('alert', options);
        },
        confirm(options: any) {
            return openBaseAlert('confirm', options);
        },
        prompt(options: any) {
            return openBasePrompt(options);
        },
        boopPrompt(options: any) {
            return openBaseBoop(options);
        },
        otpPrompt(options: any) {
            return openBaseOtp(options);
        },
        openAlert(options: any) {
            return openBaseAlert('alert', options);
        },
        openPrompt(options: any) {
            return openBasePrompt(options);
        },
        openOtp(options: any) {
            return openBaseOtp(options);
        },
        openImagePreview(options: any = {}) {
            set({
                imageDialog: {
                    ...createImageDialogState(),
                    ...options,
                    open: true,
                    url: typeof options.url === 'string' ? options.url : ''
                }
            });
        },
        updatePromptValue(value: any) {
            set((state: any) => ({
                promptDialog: {
                    ...state.promptDialog,
                    value
                }
            }));
        },
        updateOtpValue(value: any) {
            set((state: any) => ({
                otpDialog: {
                    ...state.otpDialog,
                    value
                }
            }));
        },
        handleOk() {
            if (!pendingAlert) {
                return;
            }

            set({ alertDialog: createAlertDialogState() });
            resolveAlert(createResult(true, 'ok'));
        },
        handleCancel() {
            const { alertDialog } = get();
            if (!pendingAlert) {
                return;
            }

            set({ alertDialog: createAlertDialogState() });
            if (alertDialog.mode === 'alert') {
                resolveAlert(createResult(true, 'ok'));
                return;
            }

            resolveAlert(createResult(false, 'cancel'));
        },
        handleDismiss() {
            const { alertDialog } = get();
            if (!pendingAlert || !alertDialog.dismissible) {
                return;
            }

            set({ alertDialog: createAlertDialogState() });
            if (alertDialog.mode === 'alert') {
                resolveAlert(createResult(true, 'ok'));
                return;
            }

            resolveAlert(createResult(false, 'dismiss'));
        },
        handlePromptOk(value: any) {
            const { promptDialog } = get();
            if (!pendingPrompt) {
                return;
            }

            if (!matchesPromptPattern(promptDialog.inputPattern, value ?? '')) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(true, 'ok', value ?? ''));
        },
        handlePromptCancel(value: any) {
            if (!pendingPrompt) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'cancel', value ?? ''));
        },
        handlePromptDismiss(value: any) {
            const { promptDialog } = get();
            if (!pendingPrompt || !promptDialog.dismissible) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'dismiss', value ?? ''));
        },
        handleBoopOk(value: any) {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(true, 'ok', value ?? ''));
        },
        handleBoopCancel(value: any) {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'cancel', value ?? ''));
        },
        handleBoopDismiss(value: any) {
            const { boopDialog } = get();
            if (!pendingBoop || !boopDialog.dismissible) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'dismiss', value ?? ''));
        },
        handleOtpOk(value: any) {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(true, 'ok', value ?? ''));
        },
        handleOtpCancel(value: any) {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'cancel', value ?? ''));
        },
        handleOtpDismiss(value: any) {
            const { otpDialog } = get();
            if (!pendingOtp || !otpDialog.dismissible) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'dismiss', value ?? ''));
        },
        closeAlert() {
            if (pendingAlert) {
                get().handleDismiss();
                return;
            }

            set({ alertDialog: createAlertDialogState() });
        },
        closePrompt() {
            if (pendingPrompt) {
                get().handlePromptDismiss(get().promptDialog.value);
                return;
            }

            set({ promptDialog: createPromptDialogState() });
        },
        closeBoop() {
            if (pendingBoop) {
                get().handleBoopDismiss('');
                return;
            }

            set({ boopDialog: createBoopDialogState() });
        },
        closeOtp() {
            if (pendingOtp) {
                get().handleOtpDismiss(get().otpDialog.value);
                return;
            }

            set({ otpDialog: createOtpDialogState() });
        },
        closeImagePreview() {
            set({ imageDialog: createImageDialogState() });
        },
        resetModalState() {
            if (pendingAlert) {
                resolveAlert(createResult(false, 'replaced'));
            }
            if (pendingPrompt) {
                resolvePrompt(
                    createResult(false, 'replaced', get().promptDialog.value)
                );
            }
            if (pendingBoop) {
                resolveBoop(createResult(false, 'replaced'));
            }
            if (pendingOtp) {
                resolveOtp(
                    createResult(false, 'replaced', get().otpDialog.value)
                );
            }

            set({
                alertDialog: createAlertDialogState(),
                promptDialog: createPromptDialogState(),
                boopDialog: createBoopDialogState(),
                otpDialog: createOtpDialogState(),
                imageDialog: createImageDialogState()
            });
        }
    };
});
