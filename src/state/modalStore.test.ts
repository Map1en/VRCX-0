import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useModalStore } from './modalStore';

describe('modalStore', () => {
    beforeEach(() => {
        useModalStore.getState().resetModalState();
    });

    it('resolves alerts and confirms with their distinct cancel semantics', async () => {
        const alertResult = useModalStore.getState().alert({
            title: 'Notice',
            destructive: true
        });

        expect(useModalStore.getState().alertDialog).toMatchObject({
            open: true,
            mode: 'alert',
            title: 'Notice',
            destructive: true
        });
        useModalStore.getState().handleCancel();
        expect(useModalStore.getState().alertDialog).toMatchObject({
            open: false,
            mode: 'alert',
            title: 'Notice',
            destructive: true
        });
        useModalStore.getState().handleAlertCloseComplete();
        expect(useModalStore.getState().alertDialog).toEqual({
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
        await expect(alertResult).resolves.toEqual({
            ok: true,
            reason: 'ok',
            value: undefined
        });

        const confirmResult = useModalStore.getState().confirm();
        useModalStore.getState().handleCancel();
        await expect(confirmResult).resolves.toEqual({
            ok: false,
            reason: 'cancel',
            value: undefined
        });
    });

    it('resolves the previous alert when a new alert replaces it', async () => {
        const first = useModalStore.getState().confirm({ title: 'First' });
        const second = useModalStore.getState().alert({ title: 'Second' });

        await expect(first).resolves.toEqual({
            ok: false,
            reason: 'replaced',
            value: undefined
        });
        expect(useModalStore.getState().alertDialog.title).toBe('Second');

        useModalStore.getState().handleOk();
        await expect(second).resolves.toMatchObject({ ok: true, reason: 'ok' });
    });

    it('does not clear a new alert when an earlier close animation completes', async () => {
        const first = useModalStore.getState().confirm({ title: 'First' });
        useModalStore.getState().handleCancel();
        await first;

        const second = useModalStore.getState().alert({ title: 'Second' });
        useModalStore.getState().handleAlertCloseComplete();

        expect(useModalStore.getState().alertDialog).toMatchObject({
            open: true,
            mode: 'alert',
            title: 'Second'
        });

        useModalStore.getState().handleOk();
        await second;
    });

    it('resolves an optional alternative confirm action', async () => {
        const result = useModalStore.getState().confirm({
            alternativeText: 'Keep cache'
        });

        useModalStore.getState().handleAlternative();

        await expect(result).resolves.toMatchObject({
            ok: true,
            reason: 'alternative'
        });
    });

    it('keeps non-dismissible alerts open until an explicit action', async () => {
        const result = useModalStore.getState().confirm({ dismissible: false });
        const resolved = vi.fn();
        void result.then(resolved);

        useModalStore.getState().handleDismiss();
        await Promise.resolve();

        expect(resolved).not.toHaveBeenCalled();
        expect(useModalStore.getState().alertDialog.open).toBe(true);

        useModalStore.getState().handleOk();
        await expect(result).resolves.toMatchObject({ ok: true, reason: 'ok' });
    });

    it('validates prompt values without leaking RegExp global state', async () => {
        const result = useModalStore.getState().prompt({
            inputValue: 'seed',
            pattern: /^usr_[a-z]+$/g,
            multiline: true
        });

        expect(useModalStore.getState().promptDialog).toMatchObject({
            open: true,
            value: 'seed',
            multiline: true
        });

        useModalStore.getState().handlePromptOk('invalid');
        expect(useModalStore.getState().promptDialog.open).toBe(true);
        useModalStore.getState().handlePromptOk('usr_alpha');

        await expect(result).resolves.toEqual({
            ok: true,
            reason: 'ok',
            value: 'usr_alpha'
        });

        const second = useModalStore.getState().prompt({
            pattern: /^usr_[a-z]+$/g
        });
        useModalStore.getState().handlePromptOk('usr_beta');
        await expect(second).resolves.toMatchObject({ ok: true });
    });

    it('returns the current prompt value when close dismisses it', async () => {
        const result = useModalStore.getState().openPrompt();
        useModalStore.getState().updatePromptValue('typed value');
        useModalStore.getState().closePrompt();

        await expect(result).resolves.toEqual({
            ok: false,
            reason: 'dismiss',
            value: 'typed value'
        });
        expect(useModalStore.getState().promptDialog.open).toBe(false);
    });

    it('normalizes OTP modes and resolves the submitted value', async () => {
        const fallbackMode = useModalStore
            .getState()
            .otpPrompt({ mode: 'totp', value: 'old' });
        expect(useModalStore.getState().otpDialog.mode).toBe('totp');
        useModalStore.getState().handleOtpCancel();
        await fallbackMode;

        const result = useModalStore.getState().openOtp({ mode: 'emailOtp' });
        useModalStore.getState().updateOtpValue('123456');
        useModalStore.getState().closeOtp();

        await expect(result).resolves.toEqual({
            ok: false,
            reason: 'dismiss',
            value: '123456'
        });
    });

    it('keeps non-dismissible boop prompts open and resolves explicit values', async () => {
        const result = useModalStore.getState().boopPrompt({
            targetLabel: 'Target',
            dismissible: false
        });

        useModalStore.getState().handleBoopDismiss('ignored');
        expect(useModalStore.getState().boopDialog.open).toBe(true);

        useModalStore.getState().handleBoopOk({ emojiId: 'wave' });
        await expect(result).resolves.toEqual({
            ok: true,
            reason: 'ok',
            value: { emojiId: 'wave' }
        });
    });

    it('opens and resets image preview state without a promise resolver', () => {
        useModalStore.getState().openImagePreview({
            url: ' image.png ',
            title: 'Preview',
            fileName: 'image.png'
        });

        expect(useModalStore.getState().imageDialog).toMatchObject({
            open: true,
            url: ' image.png ',
            title: 'Preview',
            fileName: 'image.png'
        });

        useModalStore.getState().closeImagePreview();
        expect(useModalStore.getState().imageDialog).toMatchObject({
            open: false,
            url: '',
            title: ''
        });
    });

    it('resolves every pending resolver when modal state is reset', async () => {
        const alert = useModalStore.getState().alert();
        const prompt = useModalStore.getState().prompt({ inputValue: 'draft' });
        const boop = useModalStore.getState().boopPrompt();
        const otp = useModalStore.getState().otpPrompt({ value: '654321' });

        useModalStore.getState().resetModalState();

        await expect(alert).resolves.toMatchObject({ reason: 'replaced' });
        await expect(prompt).resolves.toMatchObject({
            reason: 'replaced',
            value: 'draft'
        });
        await expect(boop).resolves.toMatchObject({ reason: 'replaced' });
        await expect(otp).resolves.toMatchObject({
            reason: 'replaced',
            value: '654321'
        });
    });
});
