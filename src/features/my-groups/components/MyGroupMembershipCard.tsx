import { useTranslation } from 'react-i18next';

import { groupIdForRow } from '@/components/dialogs/user-dialog/userDialogGroupRows';
import { EntityAvatar } from '@/components/EntityAvatar';
import { TileShell } from '@/components/tile/TileShell';
import { openGroupDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Button } from '@/ui/shadcn/button';

import type { MyGroupMembershipRow } from '../useMyGroupMembershipLists';

type MembershipAction = {
    label: string;
    variant?: 'default' | 'outline' | 'ghost';
    onClick(): void;
};

export function MyGroupMembershipCard({
    group,
    disabled,
    actions
}: {
    group: MyGroupMembershipRow;
    disabled: boolean;
    actions: MembershipAction[];
}) {
    const { t } = useTranslation();
    const groupId = groupIdForRow(group);
    const iconUrl = group.iconUrl
        ? convertFileUrlToImageUrl(group.iconUrl, 128)
        : '';
    const subtitle = [
        group.shortCode
            ? `${group.shortCode}${group.discriminator ? `.${group.discriminator}` : ''}`
            : '',
        typeof group.memberCount === 'number'
            ? t('host.tools_dialogs.group_moderation.member_count', {
                  count: group.memberCount
              })
            : ''
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <TileShell className="flex h-full flex-col gap-2 p-2.5">
            <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() =>
                    openGroupDialog({
                        groupId,
                        title: group.name || undefined,
                        seedData: group
                    })
                }
            >
                <EntityAvatar kind="group" imageUrl={iconUrl} />
                <span className="min-w-0 flex-1">
                    <span className="object-row__title block truncate text-sm leading-tight">
                        {group.name || groupId}
                    </span>
                    <span className="object-row__meta block truncate leading-tight">
                        {subtitle}
                    </span>
                </span>
            </button>
            <div className="flex flex-wrap justify-end gap-1.5">
                {actions.map((action) => (
                    <Button
                        key={action.label}
                        type="button"
                        size="xs"
                        variant={action.variant ?? 'outline'}
                        disabled={disabled}
                        onClick={action.onClick}
                    >
                        {action.label}
                    </Button>
                ))}
            </div>
        </TileShell>
    );
}
