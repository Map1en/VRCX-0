// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserDialogHeaderMedia } from './UserDialogHeaderMedia';

const iconFrame = {
    id: 'invt_frame',
    metadata: {
        assets: [
            {
                type: 'base',
                url: 'https://example.test/frame.webp'
            }
        ]
    }
};

afterEach(cleanup);

function renderMedia(frame?: typeof iconFrame) {
    return render(
        <UserDialogHeaderMedia
            bannerAlt="Profile banner"
            bannerFallbackUrl="https://example.test/legacy.webp"
            bannerUrl="https://example.test/banner.webp"
            iconFrame={frame}
            onBannerClick={vi.fn()}
            onOpenUserIcon={vi.fn()}
            userIconLabel="Open user icon"
            userIconUrl="https://example.test/icon.webp"
        />
    );
}

describe('UserDialogHeaderMedia', () => {
    it('keeps the original profile banner ratio and cover crop', () => {
        const { container } = renderMedia(iconFrame);
        const media = within(container);

        const bannerButton = media.getByRole('button', {
            name: 'Profile banner'
        });
        expect(bannerButton.classList.contains('aspect-[4/3]')).toBe(true);
        expect(
            media
                .getByAltText('Profile banner')
                .classList.contains('object-cover')
        ).toBe(true);
    });

    it('shows only the profile banner and falls back to the avatar image when it fails', () => {
        const { container } = renderMedia(iconFrame);
        const bannerButton = within(container).getByRole('button', {
            name: 'Profile banner'
        });
        const images = [...bannerButton.querySelectorAll('img')];

        expect(bannerButton.style.backgroundColor).toBe('');
        expect(images.map((image) => image.getAttribute('src'))).toEqual([
            'https://example.test/banner.webp'
        ]);

        fireEvent.error(images[0]);
        expect(
            [...bannerButton.querySelectorAll('img')].map((image) =>
                image.getAttribute('src')
            )
        ).toEqual(['https://example.test/legacy.webp']);
    });

    it('keeps the loaded banner on screen while a replacement banner loads', () => {
        const { container, rerender } = renderMedia();
        const bannerButton = within(container).getByRole('button', {
            name: 'Profile banner'
        });
        fireEvent.load(
            bannerButton.querySelector(
                'img[src="https://example.test/banner.webp"]'
            )!
        );

        rerender(
            <UserDialogHeaderMedia
                bannerAlt="Profile banner"
                bannerFallbackUrl="https://example.test/legacy.webp"
                bannerUrl="https://example.test/next.webp"
                onBannerClick={vi.fn()}
                onOpenUserIcon={vi.fn()}
                userIconLabel="Open user icon"
                userIconUrl="https://example.test/icon.webp"
            />
        );
        const images = [...bannerButton.querySelectorAll('img')];
        expect(images.map((image) => image.getAttribute('src'))).toEqual([
            'https://example.test/banner.webp',
            'https://example.test/next.webp'
        ]);
        expect(images[0].classList.contains('opacity-100')).toBe(true);
        expect(images[1].classList.contains('opacity-0')).toBe(true);

        fireEvent.load(images[1]);
        expect(
            [...bannerButton.querySelectorAll('img')].map((image) =>
                image.getAttribute('src')
            )
        ).toEqual(['https://example.test/next.webp']);

        rerender(
            <UserDialogHeaderMedia
                bannerAlt="Profile banner"
                bannerFallbackUrl="https://example.test/legacy.webp"
                bannerUrl=""
                onBannerClick={vi.fn()}
                onOpenUserIcon={vi.fn()}
                userIconLabel="Open user icon"
                userIconUrl="https://example.test/icon.webp"
            />
        );
        expect(
            [...bannerButton.querySelectorAll('img')].map((image) =>
                image.getAttribute('src')
            )
        ).toEqual(['https://example.test/legacy.webp']);
    });

    it('leaves the banner empty when no image is available', () => {
        const { container } = render(
            <UserDialogHeaderMedia
                bannerAlt="Profile banner"
                bannerFallbackUrl=""
                bannerUrl=""
                onOpenUserIcon={vi.fn()}
                userIconLabel="Open user icon"
                userIconUrl=""
            />
        );
        const bannerButton = within(container).getByRole('button');

        expect(bannerButton.querySelector('img')).toBeNull();
        expect(bannerButton.querySelector('svg')).toBeNull();
        expect(bannerButton.childElementCount).toBe(0);
        expect(bannerButton.textContent).toBe('');
    });

    it('uses a compact frame without the avatar white border', () => {
        const { container } = renderMedia(iconFrame);

        const iconButton = within(container).getByRole('button', {
            name: 'Open user icon'
        });
        const iconAnchor = iconButton.parentElement;
        const frame = [...container.querySelectorAll('span')].find((element) =>
            element.classList.contains('-inset-3')
        );

        expect(iconAnchor?.classList.contains('size-16')).toBe(true);
        expect(iconButton.classList.contains('size-full')).toBe(true);
        expect(iconButton.classList.contains('overflow-hidden')).toBe(true);
        expect(iconButton.classList.contains('border-0')).toBe(true);
        expect(iconButton.classList.contains('border-2')).toBe(false);
        expect(iconButton.classList.contains('border-white')).toBe(false);
        expect(iconAnchor?.classList.contains('left-3')).toBe(true);
        expect(iconAnchor?.classList.contains('bottom-3')).toBe(true);
        expect(frame).toBeDefined();
        expect(frame?.classList.contains('absolute')).toBe(true);
        expect(iconButton.contains(frame ?? null)).toBe(false);
    });

    it('keeps the avatar white border when no frame is equipped', () => {
        const { container } = renderMedia();

        const iconButton = within(container).getByRole('button', {
            name: 'Open user icon'
        });
        const iconAnchor = iconButton.parentElement;

        expect(iconAnchor?.classList.contains('left-3')).toBe(true);
        expect(iconAnchor?.classList.contains('bottom-3')).toBe(true);
        expect(iconButton.classList.contains('border-2')).toBe(true);
        expect(iconButton.classList.contains('border-white')).toBe(true);
        expect(
            [...container.querySelectorAll('span')].some((element) =>
                element.classList.contains('-inset-3')
            )
        ).toBe(false);
    });
});
