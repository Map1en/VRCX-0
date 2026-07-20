import { describe, expect, it } from 'vitest';

import {
    createRequestError,
    isVrchatMissingCredentialsError,
    isVrchatRequestError,
    unwrapVrchatResponse,
    unwrapErrorMessage
} from './vrchatRequest';

function captureRequestError(run: () => unknown) {
    try {
        run();
    } catch (error) {
        if (isVrchatRequestError(error)) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected a VRChat request error');
}

describe('vrchat response unwrapping', () => {
    it('parses a successful JSON response', () => {
        expect(
            unwrapVrchatResponse(
                { status: 200, data: JSON.stringify({ ok: true }) },
                'users/usr_1'
            )
        ).toEqual({ json: { ok: true }, status: 200 });
    });

    it.each([
        { status: 204, data: '' },
        { status: 204, data: null },
        { status: 204, data: '   ' }
    ])('allows an empty $status response body', ({ status, data }) => {
        expect(unwrapVrchatResponse({ status, data }, 'files')).toMatchObject({
            status
        });
    });

    it('rejects a non-empty invalid JSON success body with its transport context', () => {
        const error = captureRequestError(() =>
            unwrapVrchatResponse(
                { status: 200, data: '<html>upstream error</html>' },
                'users/usr_1',
                { fallbackMessage: 'VRChat user request failed' }
            )
        );

        expect(error).toMatchObject({
            message: 'VRChat user request failed: invalid JSON response (200)',
            status: 200,
            endpoint: 'users/usr_1',
            payload: '<html>upstream error</html>'
        });
    });

    it('accepts a successful text response only when the endpoint declares it', () => {
        expect(
            unwrapVrchatResponse<string>(
                { status: 200, data: 'BEGIN:VCALENDAR' },
                'calendar/group_1/event_1.ics',
                { responseType: 'text' }
            )
        ).toEqual({ json: 'BEGIN:VCALENDAR', status: 200 });
    });

    it('preserves a string API error message', () => {
        const error = captureRequestError(() =>
            unwrapVrchatResponse(
                {
                    status: 400,
                    data: JSON.stringify({ error: 'capacity reached' })
                },
                'favorites'
            )
        );

        expect(error).toMatchObject({
            message: 'capacity reached',
            status: 400,
            endpoint: 'favorites'
        });
    });

    it('uses an API-level error status carried by a successful HTTP envelope', () => {
        const error = captureRequestError(() =>
            unwrapVrchatResponse(
                {
                    status: 200,
                    data: JSON.stringify({
                        error: { status_code: 429, message: 'Slow down' }
                    })
                },
                'favorites'
            )
        );

        expect(error).toMatchObject({
            message: 'Slow down',
            status: 429,
            endpoint: 'favorites'
        });
    });

    it('does not report a successful HTTP status for an unclassified API error', () => {
        const error = captureRequestError(() =>
            unwrapVrchatResponse(
                {
                    status: 200,
                    data: JSON.stringify({
                        error: { message: 'Session rejected' }
                    })
                },
                'auth'
            )
        );

        expect(error).toMatchObject({
            message: 'Session rejected',
            status: 0,
            endpoint: 'auth'
        });
    });

    it.each([
        {
            status: 302,
            data: '',
            payload: ''
        },
        {
            status: 401,
            data: JSON.stringify({ error: { message: 'Unauthorized' } }),
            payload: { error: { message: 'Unauthorized' } }
        },
        {
            status: 403,
            data: JSON.stringify({ message: 'Forbidden' }),
            payload: { message: 'Forbidden' }
        },
        {
            status: 429,
            data: 'Rate limited',
            payload: 'Rate limited'
        },
        {
            status: 500,
            data: '<html>Server error</html>',
            payload: '<html>Server error</html>'
        }
    ])(
        'preserves status, endpoint, and payload for a $status response',
        ({ status, data, payload }) => {
            const error = captureRequestError(() =>
                unwrapVrchatResponse({ status, data }, 'users/usr_1')
            );

            expect(error).toMatchObject({
                status,
                endpoint: 'users/usr_1',
                payload
            });
        }
    );
});

describe('vrchat request error classification', () => {
    it('classifies 401 and explicit missing credentials messages as missing credentials', () => {
        expect(
            isVrchatMissingCredentialsError(
                createRequestError('Unauthorized', 401, 'auth/user')
            )
        ).toBe(true);
        expect(
            isVrchatMissingCredentialsError(
                new Error('Missing Credentials for VRChat request')
            )
        ).toBe(true);
        expect(
            isVrchatMissingCredentialsError(
                createRequestError('Forbidden', 403, 'users/usr_1')
            )
        ).toBe(false);
        expect(isVrchatMissingCredentialsError(null)).toBe(false);
    });

    it('unwraps nested and string error messages before using the status fallback', () => {
        expect(
            unwrapErrorMessage(
                { error: { message: '"Two factor required"' } },
                401
            )
        ).toBe('Two factor required');
        expect(unwrapErrorMessage('"plain failure"', 400)).toBe(
            'plain failure'
        );
        expect(unwrapErrorMessage({}, 500)).toBe('VRChat request failed (500)');
    });
});
