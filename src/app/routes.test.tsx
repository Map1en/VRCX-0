import { describe, expect, it } from 'vitest';

import { protectedRoutes } from './routes';

type RouteLike = {
    path?: string;
    element?: {
        props?: {
            to?: string;
        };
    };
};

describe('protectedRoutes', () => {
    it('retires the instance activity route without redirecting to it', () => {
        expect(
            protectedRoutes.some(
                (route: RouteLike) => route.path === '/charts/instance'
            )
        ).toBe(false);

        const chartsRoute = protectedRoutes.find(
            (route: RouteLike) => route.path === '/charts'
        );
        expect(chartsRoute?.element?.props?.to).toBe('/charts/mutual');
    });
});
