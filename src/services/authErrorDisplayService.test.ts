import { afterEach, describe, expect, it } from 'vitest';

import { getLoginErrorMessage } from './authErrorDisplayService';
import { setI18nLanguage } from './i18nService';

describe('login error localization', () => {
    it.each([
        ['Invalid Username/Email or Password', '用户名、邮箱或密码错误。'],
        ['Missing Credentials', '缺少有效的登录凭据，请重新登录。'],
        [
            'The stored browser session still requires interactive verification.',
            '此会话需要完成额外验证，请手动登录。'
        ],
        [
            '2FA is required but no supported method was returned.',
            '此账号需要双重验证，但未找到支持的验证方式。'
        ]
    ])('localizes known login failures: %s', async (message, translation) => {
        await setI18nLanguage('zh-CN');
        for (const text of [message, JSON.stringify(message)]) {
            expect(getLoginErrorMessage(new Error(text), 'Login failed')).toBe(
                translation
            );
        }
    });

    it('uses the saved-credential error code without changing the error', async () => {
        await setI18nLanguage('zh-CN');
        const error = Object.assign(new Error('Original diagnostic message'), {
            code: 'AUTH_SAVED_CREDENTIALS_INVALID'
        });
        expect(getLoginErrorMessage(error, 'Login failed')).toBe(
            '保存的登录凭据已失效，已移除此保存账号，请重新登录。'
        );
        expect(error.message).toBe('Original diagnostic message');
    });

    it('preserves specific server details even when classified as an invalid session', async () => {
        await setI18nLanguage('zh-CN');
        const error = Object.assign(
            new Error('"Please contact support: abc"'),
            {
                kind: 'sessionInvalidated'
            }
        );
        expect(getLoginErrorMessage(error, 'Login failed')).toBe(error.message);
        expect(getLoginErrorMessage(new Error('   '), 'Login failed')).toBe(
            'Login failed'
        );
    });

    afterEach(async () => {
        await setI18nLanguage('en');
    });

    it.each([false, true])(
        'localizes the new-location login error (quoted: %s) using the current language',
        async (quoted) => {
            const message =
                "It looks like you're logging in from somewhere new! Check your email for a message from VRChat.";
            const error = new Error(
                ` ${quoted ? JSON.stringify(message) : message} `
            );

            await setI18nLanguage('zh-CN');
            expect(getLoginErrorMessage(error, 'Login failed')).toBe(
                '你似乎正在从新的地点登录！请检查邮箱，查看 VRChat 发来的邮件。'
            );

            await setI18nLanguage('en');
            expect(getLoginErrorMessage(error, 'Login failed')).toBe(message);
        }
    );

    it('shows useful error messages while keeping a fallback for unknown failures', () => {
        expect(
            getLoginErrorMessage(
                new Error('Invalid credentials'),
                'Login failed'
            )
        ).toBe('Invalid credentials');
        expect(
            getLoginErrorMessage({ message: 'Ignored' }, 'Login failed')
        ).toBe('Login failed');
        expect(getLoginErrorMessage(null, 'Login failed')).toBe('Login failed');
    });
});
