import type { ReactNode } from 'react';

export function LoginPageShell({
    children,
    footer,
    header
}: {
    children: ReactNode;
    footer?: ReactNode;
    header: ReactNode;
}) {
    return (
        <div
            data-vrcx-0-surface="login-page"
            className="vrcx-0-main-shell relative flex min-h-full w-full flex-col overflow-y-auto p-6"
        >
            <div className="flex flex-1 items-center justify-center">
                <div className="flex w-full max-w-lg flex-col gap-4">
                    {header}
                    {children}
                </div>
            </div>
            {footer}
        </div>
    );
}
