import { describe, expect, it } from 'vitest';

import { classifyRouteError } from './RouteErrorBoundary';

describe('classifyRouteError', () => {
    it('classifies chunk loading failures as load_fail', () => {
        expect(classifyRouteError(new Error('Loading chunk 123 failed'))).toBe(
            'load_fail'
        );
        expect(
            classifyRouteError(
                new Error('Failed to fetch dynamically imported module')
            )
        ).toBe('load_fail');
    });

    it('classifies other render exceptions as render_crash', () => {
        expect(classifyRouteError(new TypeError('bad props'))).toBe(
            'render_crash'
        );
        expect(classifyRouteError('unexpected')).toBe('render_crash');
    });
});
