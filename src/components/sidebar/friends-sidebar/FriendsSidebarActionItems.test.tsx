import type { PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/launchService', () => ({
    launchVrchat: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { CurrentUserActionItems } from './FriendsSidebarActionItems';

const Container = ({ children }: PropsWithChildren) => <>{children}</>;
const CheckboxItem = ({
    children,
    closeOnClick
}: PropsWithChildren<{ closeOnClick?: boolean }>) => (
    <button data-close-on-click={closeOnClick}>{children}</button>
);
const MenuItem = ({ children }: PropsWithChildren) => (
    <button>{children}</button>
);

describe('CurrentUserActionItems', () => {
    it('closes the context menu immediately when selecting a recent signature', () => {
        const html = renderToStaticMarkup(
            <CurrentUserActionItems
                friend={{
                    id: 'usr_self',
                    status: 'active',
                    statusDescription: 'Current signature',
                    statusHistory: ['Previous signature']
                }}
                MenuItem={MenuItem}
                CheckboxItem={CheckboxItem}
                Group={Container}
                Separator={() => null}
                Sub={Container}
                SubTrigger={Container}
                SubContent={Container}
            />
        );

        expect(html).toMatch(
            /data-close-on-click="true">.*?Previous signature.*?<\/button>/
        );
    });
});
