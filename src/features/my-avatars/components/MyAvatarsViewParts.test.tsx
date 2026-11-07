// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn()
}));

import { getMyAvatarsGridDensityConfig } from '../myAvatarsGrid';
import type { MyAvatarActionHandler, MyAvatarRow } from '../myAvatarsTypes';
import { AvatarActionMenuItems, MyAvatarGridCard } from './MyAvatarGridCard';
import { MyAvatarTagList, PlatformBadges } from './MyAvatarsViewParts';

describe('My Avatars view parts', () => {
    afterEach(cleanup);

    it('labels icon-only platform badges', () => {
        render(
            <PlatformBadges
                unityPackages={[
                    { platform: 'standalonewindows', variant: 'standard' },
                    { platform: 'android', variant: 'standard' },
                    { platform: 'ios', variant: 'standard' }
                ]}
            />
        );

        expect(screen.getByLabelText('PC')).toBeTruthy();
        expect(screen.getByLabelText('Android')).toBeTruthy();
        expect(screen.getByLabelText('iOS')).toBeTruthy();
    });

    it('shows the first two tags and folds the rest into a count', () => {
        render(
            <MyAvatarTagList
                tags={[
                    { tag: 'cute', color: null },
                    { tag: 'quest', color: null },
                    { tag: 'wip', color: null },
                    { tag: 'old', color: null }
                ]}
            />
        );

        expect(screen.getByText('cute')).toBeTruthy();
        expect(screen.getByText('quest')).toBeTruthy();
        expect(screen.queryByText('wip')).toBeNull();
        expect(screen.getByText('+2')).toBeTruthy();
    });

    it('identifies the target avatar without changing menu actions', () => {
        const avatar: MyAvatarRow = {
            id: 'avtr_example',
            name: 'Example Avatar',
            releaseStatus: 'private'
        };
        const onAction = vi.fn<MyAvatarActionHandler>();

        render(
            <AvatarActionMenuItems
                avatar={avatar}
                isActive={false}
                disabled={false}
                Item="button"
                Group="div"
                Label="div"
                Separator="hr"
                onAction={onAction}
            />
        );

        expect(screen.getByText('Example Avatar')).toBeTruthy();

        fireEvent.click(screen.getByText('dialog.avatar.actions.make_public'));

        expect(onAction).toHaveBeenCalledWith('makePublic', avatar);
    });

    it('opens the grid card action menu', () => {
        render(
            <MyAvatarGridCard
                avatar={{
                    id: 'avtr_example',
                    name: 'Example Avatar',
                    releaseStatus: 'private'
                }}
                densityConfig={getMyAvatarsGridDensityConfig('standard')}
                isUpdating={false}
                onAction={vi.fn<MyAvatarActionHandler>()}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.my_avatars.action.open_avatar_actions'
            })
        );

        const menu = screen.getByRole('menu');
        expect(menu).toBeTruthy();
        expect(
            within(menu).getByText('common.actions.view_details')
        ).toBeTruthy();
    });
});
