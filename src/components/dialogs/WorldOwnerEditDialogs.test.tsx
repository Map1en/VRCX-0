// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';

import { WorldTagsDialog } from './WorldOwnerEditDialogs';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

afterEach(cleanup);

function createWorld(tags: string[]): WorldProfileRecord {
    return {
        id: 'wrld_test',
        name: 'Test World',
        tags
    } as WorldProfileRecord;
}

describe('WorldTagsDialog', () => {
    it('shows managed world features as positive controls before author tags', () => {
        render(
            <WorldTagsDialog
                open
                onOpenChange={vi.fn()}
                world={createWorld([
                    'feature_avatar_scaling_disabled',
                    'feature_focus_view_disabled',
                    'feature_third_person_view_disabled'
                ])}
                onSave={vi.fn()}
            />
        );

        const avatarScaling = screen.getByRole('checkbox', {
            name: 'dialog.world.action.enable_avatar_scaling'
        });
        const focusView = screen.getByRole('checkbox', {
            name: 'dialog.world.action.enable_focus_view'
        });
        const thirdPerson = screen.getByRole('checkbox', {
            name: 'dialog.world.action.enable_third_person_view'
        });
        const debug = screen.getByRole('checkbox', {
            name: 'dialog.world.action.enable_debugging'
        });
        const authorTags = screen.getByLabelText(
            'dialog.world.label.author_tags'
        );

        expect(avatarScaling.getAttribute('aria-checked')).toBe('false');
        expect(focusView.getAttribute('aria-checked')).toBe('false');
        expect(thirdPerson.getAttribute('aria-checked')).toBe('false');
        expect(
            thirdPerson.compareDocumentPosition(debug) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            debug.compareDocumentPosition(authorTags) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(screen.queryByText('Third Person')).toBeNull();
    });

    it('converts the positive controls back to VRChat disabled tags on save', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();

        render(
            <WorldTagsDialog
                open
                onOpenChange={vi.fn()}
                world={createWorld([])}
                onSave={onSave}
            />
        );

        await user.click(
            screen.getByRole('checkbox', {
                name: 'dialog.world.action.enable_avatar_scaling'
            })
        );
        await user.click(
            screen.getByRole('checkbox', {
                name: 'dialog.world.action.enable_focus_view'
            })
        );
        await user.click(
            screen.getByRole('checkbox', {
                name: 'dialog.world.action.enable_third_person_view'
            })
        );
        await user.click(screen.getByText('common.actions.save'));

        expect(onSave).toHaveBeenCalledWith(
            expect.arrayContaining([
                'feature_avatar_scaling_disabled',
                'feature_focus_view_disabled',
                'feature_third_person_view_disabled'
            ])
        );
    });

    it('uses translation keys for content and default-content options', () => {
        render(
            <WorldTagsDialog
                open
                onOpenChange={vi.fn()}
                world={createWorld([])}
                onSave={vi.fn()}
            />
        );

        const optionTranslationKeys = [
            'dialog.world.tags.content_horror',
            'dialog.world.tags.content_gore',
            'dialog.world.tags.content_violence',
            'dialog.world.tags.content_adult',
            'dialog.world.tags.content_sex',
            'dialog.gallery_icons.emoji',
            'dialog.gallery_icons.stickers',
            'dialog.world.tags.pedestals',
            'dialog.gallery_icons.prints',
            'dialog.inventory.drones',
            'dialog.inventory.items'
        ];

        for (const name of optionTranslationKeys) {
            expect(screen.getByRole('checkbox', { name })).toBeTruthy();
        }
    });

    it('keeps content tag checkboxes and raw input in sync like avatars', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();

        render(
            <WorldTagsDialog
                open
                onOpenChange={vi.fn()}
                world={createWorld([
                    'content_horror',
                    'content_custom',
                    'system_approved'
                ])}
                onSave={onSave}
            />
        );

        const contentTags = screen.getByLabelText(
            'dialog.world.label.raw_content_tags'
        );
        const horror = screen.getByRole('checkbox', {
            name: 'dialog.world.tags.content_horror'
        });
        const violence = screen.getByRole('checkbox', {
            name: 'dialog.world.tags.content_violence'
        });

        expect((contentTags as HTMLTextAreaElement).value).toBe(
            'horror,custom'
        );
        expect(horror.getAttribute('aria-checked')).toBe('true');

        await user.clear(contentTags);
        await user.type(contentTags, 'violence,content_custom');

        expect(horror.getAttribute('aria-checked')).toBe('false');
        expect(violence.getAttribute('aria-checked')).toBe('true');

        await user.click(horror);
        expect((contentTags as HTMLTextAreaElement).value).toBe(
            'violence,custom,horror'
        );

        await user.click(screen.getByText('common.actions.save'));

        expect(onSave).toHaveBeenCalledWith(
            expect.arrayContaining([
                'content_violence',
                'content_custom',
                'content_horror',
                'system_approved'
            ])
        );
    });

    it('preserves existing custom content tags when managed tags change', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn<(tags: string[]) => void>();

        render(
            <WorldTagsDialog
                open
                onOpenChange={vi.fn()}
                world={createWorld([
                    'content_Custom',
                    'content_content_custom',
                    'content_Foo',
                    'content_foo',
                    'system_approved'
                ])}
                onSave={onSave}
            />
        );

        await user.click(
            screen.getByRole('checkbox', {
                name: 'dialog.world.tags.content_horror'
            })
        );
        await user.click(screen.getByText('common.actions.save'));

        const savedTags = onSave.mock.calls[0]?.[0] ?? [];
        expect(savedTags.filter((tag) => tag.startsWith('content_'))).toEqual([
            'content_Custom',
            'content_content_custom',
            'content_Foo',
            'content_foo',
            'content_horror'
        ]);
        expect(savedTags).toContain('system_approved');
    });
});
