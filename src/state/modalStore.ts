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
    alternativeText: string;
    cancelText: string;
    dismissible: boolean;
    destructive: boolean;
};
type PromptDialogState = {
    open: boolean;
    title: string;
    description: string;
    value: string;
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
    value: string;
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
    targetLabel: string;
    dismissible: boolean;
};
type AlertDialogOptions = Partial<AlertDialogState>;
type PromptDialogOptions = Partial<PromptDialogState> & {
    inputValue?: string;
    pattern?: RegExp | null;
    errorMessage?: string;
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
    updatePromptValue(value: string): void;
    updateOtpValue(value: string): void;
    handleOk(): void;
    handleAlternative(): void;
    handleCancel(): void;
    handleDismiss(): void;
    handlePromptOk(value?: string): void;
    handlePromptCancel(value?: string): void;
    handlePromptDismiss(value?: string): void;
    handleBoopOk(value?: unknown): void;
    handleBoopCancel(value?: unknown): void;
    handleBoopDismiss(value?: unknown): void;
    handleOtpOk(value?: string): void;
    handleOtpCancel(value?: string): void;
    handleOtpDismiss(value?: string): void;
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
    confirmText: '',
    alternativeText: '',
    cancelText: '',
    dismissible: true,
    destructive: false
});

const createPromptDialogState = (): PromptDialogState => ({
    open: false,
    title: '',
    description: '',
    value: '',
    confirmText: '',
    cancelText: '',
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
    confirmText: '',
    cancelText: '',
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

export const useModalStore = create<ModalStore>((set, get) => {
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

        return new Promise<ModalResult>((resolve) => {
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

        return new Promise<ModalResult>((resolve) => {
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
                targetLabel:
                    typeof options.targetLabel === 'string'
                        ? options.targetLabel
                        : ''
            }
        });

        return new Promise<ModalResult>((resolve) => {
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

        return new Promise<ModalResult>((resolve) => {
            pendingOtp = resolve;
        });
    }

    return {
        alertDialog: createAlertDialogState(),
        promptDialog: createPromptDialogState(),
        otpDialog: createOtpDialogState(),
        imageDialog: createImageDialogState(),
        boopDialog: createBoopDialogState(),
        alert(options?: AlertDialogOptions) {
            return openBaseAlert('alert', options);
        },
        confirm(options?: AlertDialogOptions) {
            return openBaseAlert('confirm', options);
        },
        prompt(options?: PromptDialogOptions) {
            return openBasePrompt(options);
        },
        boopPrompt(options?: BoopDialogOptions) {
            return openBaseBoop(options);
        },
        otpPrompt(options?: OtpDialogOptions) {
            return openBaseOtp(options);
        },
        openAlert(options?: AlertDialogOptions) {
            return openBaseAlert('alert', options);
        },
        openPrompt(options?: PromptDialogOptions) {
            return openBasePrompt(options);
        },
        openOtp(options?: OtpDialogOptions) {
            return openBaseOtp(options);
        },
        openImagePreview(options: ImageDialogOptions = {}) {
            set({
                imageDialog: {
                    ...createImageDialogState(),
                    ...options,
                    open: true,
                    url: typeof options.url === 'string' ? options.url : ''
                }
            });
        },
        updatePromptValue(value: string) {
            set((state) => ({
                promptDialog: {
                    ...state.promptDialog,
                    value
                }
            }));
        },
        updateOtpValue(value: string) {
            set((state) => ({
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
        handleAlternative() {
            if (!pendingAlert) {
                return;
            }

            set({ alertDialog: createAlertDialogState() });
            resolveAlert(createResult(true, 'alternative'));
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
        handlePromptOk(value = '') {
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
        handlePromptCancel(value = '') {
            if (!pendingPrompt) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'cancel', value ?? ''));
        },
        handlePromptDismiss(value = '') {
            const { promptDialog } = get();
            if (!pendingPrompt || !promptDialog.dismissible) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'dismiss', value ?? ''));
        },
        handleBoopOk(value?: unknown) {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(true, 'ok', value ?? ''));
        },
        handleBoopCancel(value?: unknown) {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'cancel', value ?? ''));
        },
        handleBoopDismiss(value?: unknown) {
            const { boopDialog } = get();
            if (!pendingBoop || !boopDialog.dismissible) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'dismiss', value ?? ''));
        },
        handleOtpOk(value = '') {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(true, 'ok', value ?? ''));
        },
        handleOtpCancel(value = '') {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'cancel', value ?? ''));
        },
        handleOtpDismiss(value = '') {
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
