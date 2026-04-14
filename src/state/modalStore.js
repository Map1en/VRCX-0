import { create } from 'zustand';

const createAlertDialogState = () => ({
    open: false,
    mode: 'alert',
    title: '',
    description: '',
    confirmText: 'OK',
    cancelText: 'Cancel',
    dismissible: true,
    destructive: false
});

const createPromptDialogState = () => ({
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

const createOtpDialogState = () => ({
    open: false,
    title: '',
    description: '',
    value: '',
    mode: 'totp',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    dismissible: true
});

const createImageDialogState = () => ({
    open: false,
    url: '',
    title: ''
});

function createResult(ok, reason, value) {
    return {
        ok,
        reason,
        value
    };
}

function matchesPromptPattern(pattern, value) {
    if (!(pattern instanceof RegExp)) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(value ?? '');
}

export const useModalStore = create((set, get) => {
    let pendingAlert = null;
    let pendingPrompt = null;
    let pendingOtp = null;

    function resolveAlert(result) {
        const resolver = pendingAlert;
        pendingAlert = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolvePrompt(result) {
        const resolver = pendingPrompt;
        pendingPrompt = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolveOtp(result) {
        const resolver = pendingOtp;
        pendingOtp = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function openBaseAlert(mode, options = {}) {
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

        return new Promise((resolve) => {
            pendingAlert = resolve;
        });
    }

    function openBasePrompt(options = {}) {
        if (pendingPrompt) {
            resolvePrompt(createResult(false, 'replaced', get().promptDialog.value));
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

        return new Promise((resolve) => {
            pendingPrompt = resolve;
        });
    }

    function openBaseOtp(options = {}) {
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

        return new Promise((resolve) => {
            pendingOtp = resolve;
        });
    }

    return {
        alertDialog: createAlertDialogState(),
        promptDialog: createPromptDialogState(),
        otpDialog: createOtpDialogState(),
        imageDialog: createImageDialogState(),
        alert(options) {
            return openBaseAlert('alert', options);
        },
        confirm(options) {
            return openBaseAlert('confirm', options);
        },
        prompt(options) {
            return openBasePrompt(options);
        },
        otpPrompt(options) {
            return openBaseOtp(options);
        },
        openAlert(options) {
            return openBaseAlert('alert', options);
        },
        openPrompt(options) {
            return openBasePrompt(options);
        },
        openOtp(options) {
            return openBaseOtp(options);
        },
        openImagePreview(options = {}) {
            set({
                imageDialog: {
                    ...createImageDialogState(),
                    ...options,
                    open: true,
                    url: typeof options.url === 'string' ? options.url : ''
                }
            });
        },
        updatePromptValue(value) {
            set((state) => ({
                promptDialog: {
                    ...state.promptDialog,
                    value
                }
            }));
        },
        updateOtpValue(value) {
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
        handlePromptOk(value) {
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
        handlePromptCancel(value) {
            if (!pendingPrompt) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'cancel', value ?? ''));
        },
        handlePromptDismiss(value) {
            const { promptDialog } = get();
            if (!pendingPrompt || !promptDialog.dismissible) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'dismiss', value ?? ''));
        },
        handleOtpOk(value) {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(true, 'ok', value ?? ''));
        },
        handleOtpCancel(value) {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'cancel', value ?? ''));
        },
        handleOtpDismiss(value) {
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
                resolvePrompt(createResult(false, 'replaced', get().promptDialog.value));
            }
            if (pendingOtp) {
                resolveOtp(createResult(false, 'replaced', get().otpDialog.value));
            }

            set({
                alertDialog: createAlertDialogState(),
                promptDialog: createPromptDialogState(),
                otpDialog: createOtpDialogState(),
                imageDialog: createImageDialogState()
            });
        }
    };
});
