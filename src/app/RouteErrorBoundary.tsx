import { Component, type ReactNode } from 'react';

import { recordRouteError } from '@/services/telemetry/telemetryPageReach';
import type { TelemetryRouteErrorClass } from '@/services/telemetry/telemetryTypes';

export function classifyRouteError(error: unknown): TelemetryRouteErrorClass {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    if (
        name === 'ChunkLoadError' ||
        /loading chunk|dynamically imported module|failed to fetch/i.test(
            message
        )
    ) {
        return 'load_fail';
    }
    return 'render_crash';
}

type RouteErrorBoundaryProps = {
    resetKey: string;
    fallback: ReactNode;
    children: ReactNode;
};

type RouteErrorBoundaryState = {
    hasError: boolean;
    renderedKey: string;
};

export class RouteErrorBoundary extends Component<
    RouteErrorBoundaryProps,
    RouteErrorBoundaryState
> {
    state: RouteErrorBoundaryState = {
        hasError: false,
        renderedKey: this.props.resetKey
    };

    static getDerivedStateFromError(): Partial<RouteErrorBoundaryState> {
        return { hasError: true };
    }

    static getDerivedStateFromProps(
        props: RouteErrorBoundaryProps,
        state: RouteErrorBoundaryState
    ): Partial<RouteErrorBoundaryState> | null {
        if (props.resetKey !== state.renderedKey) {
            return { hasError: false, renderedKey: props.resetKey };
        }
        return null;
    }

    componentDidCatch(error: unknown): void {
        recordRouteError(classifyRouteError(error), error);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return this.props.fallback;
        }
        return this.props.children;
    }
}
