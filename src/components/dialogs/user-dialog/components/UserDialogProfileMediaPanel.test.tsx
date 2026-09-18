// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: mocks.t })
}));
vi.mock('@/repositories/mediaRepository', () => ({
    default: { getFileList: vi.fn().mockResolvedValue({ json: [] }) }
}));

import { UserDialogProfileMediaPanel } from './UserDialogProfileMediaPanel';

describe('UserDialogProfileMediaPanel', () => {
    it('enables clearing from profile media fields while preserving write field names', async () => {
        const onSetProfileMediaField = vi.fn();
        render(
            <UserDialogProfileMediaPanel
                profile={{
                    id: 'usr_self',
                    bannerCustomUrl: 'https://image/file_banner/1',
                    userIcon: 'https://image/file_icon/1'
                }}
                actionStatus="idle"
                onBack={vi.fn()}
                onSetProfileMediaField={onSetProfileMediaField}
            />
        );
        const clearBanner = screen.getByRole('button', {
            name: 'dialog.gallery_icons.clear_banner'
        });
        const clearIcon = screen.getByRole('button', {
            name: 'dialog.gallery_icons.clear_profile_icon'
        });
        expect(clearBanner.hasAttribute('disabled')).toBe(false);
        expect(clearIcon.hasAttribute('disabled')).toBe(false);
        fireEvent.click(clearBanner);
        await waitFor(() =>
            expect(onSetProfileMediaField).toHaveBeenCalledWith('banner', '')
        );
        fireEvent.click(clearIcon);
        await waitFor(() =>
            expect(onSetProfileMediaField).toHaveBeenCalledWith('userIcon', '')
        );
    });
});
