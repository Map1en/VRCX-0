import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    CrownIcon,
    EyeOffIcon,
    LogOutIcon,
    MoreHorizontalIcon,
    UsersIcon,
    UsersRoundIcon
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { groupIdForRow } from '@/components/dialogs/user-dialog/userDialogGroupRows';
import { FadeInImage } from '@/components/media/FadeInImage';
import { TILE_SELECTED } from '@/lib/selectableTile';
import { cn } from '@/lib/utils';
import type { GroupMemberVisibility } from '@/platform/tauri/bindings';
import { openGroupDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import type { MyGroupRow as MyGroupRowModel } from '../useMyGroupsPageState';

const visibilityLabelKeys: Record<GroupMemberVisibility, string> = {
    visible: 'dialog.group.actions.visibility_everyone',
    friends: 'dialog.group.actions.visibility_friends',
    hidden: 'dialog.group.actions.visibility_hidden'
};

const visibilityOptions: GroupMemberVisibility[] = [
    'visible',
    'friends',
    'hidden'
];

function memberVisibility(group: MyGroupRowModel): GroupMemberVisibility {
    const value = group.memberVisibility;
    return value === 'friends' || value === 'hidden' ? value : 'visible';
}

export function MyGroupCard({
    group,
    editMode,
    orderEditable,
    orderIndex,
    orderBusy,
    selected,
    actionsDisabled,
    isOwner,
    onToggleSelected,
    onSetVisibility,
    onLeave
}: {
    group: MyGroupRowModel;
    editMode: boolean;
    orderEditable: boolean;
    orderIndex: number;
    orderBusy: boolean;
    selected: boolean;
    actionsDisabled: boolean;
    isOwner: boolean;
    onToggleSelected(groupId: string): void;
    onSetVisibility(
        group: MyGroupRowModel,
        visibility: GroupMemberVisibility
    ): void;
    onLeave(group: MyGroupRowModel): void;
}) {
    const { t } = useTranslation();
    const groupId = groupIdForRow(group);
    const dragDisabled = !orderEditable || orderBusy;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: groupId,
        disabled: dragDisabled
    });
    const cardStyle: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const iconUrl = group.iconUrl
        ? convertFileUrlToImageUrl(group.iconUrl, 128)
        : '';
    const bannerUrl = group.bannerUrl
        ? convertFileUrlToImageUrl(group.bannerUrl, 512)
        : '';
    const visibility = memberVisibility(group);
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
        <div
            ref={setNodeRef}
            style={cardStyle}
            className={cn(
                'group/card relative h-full min-w-0',
                isDragging && 'z-10 opacity-60'
            )}
        >
            <Button
                {...attributes}
                {...listeners}
                type="button"
                variant="ghost"
                className={cn(
                    'object-row bg-object-surface hover:bg-object-surface-hover dark:hover:bg-object-surface-hover h-full w-full min-w-0 flex-col items-stretch gap-0 overflow-hidden rounded-lg border-[var(--object-border)] p-0 text-left font-normal whitespace-normal hover:border-[var(--object-border-hover)]',
                    !dragDisabled &&
                        'cursor-grab touch-none active:cursor-grabbing',
                    selected && TILE_SELECTED
                )}
                aria-pressed={editMode ? selected : undefined}
                onClick={() => {
                    if (editMode) {
                        onToggleSelected(groupId);
                        return;
                    }
                    openGroupDialog({
                        groupId,
                        title: group.name || undefined,
                        seedData: group
                    });
                }}
            >
                <div className="bg-muted relative aspect-[3/1] w-full overflow-hidden">
                    {bannerUrl ? (
                        <FadeInImage
                            src={bannerUrl}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                            fallback={
                                <span className="bg-muted block size-full" />
                            }
                        />
                    ) : null}
                    {orderEditable ? (
                        <span className="bg-background/85 text-foreground absolute top-1 right-1 rounded-sm px-1.5 text-xs font-medium tabular-nums shadow-sm">
                            {orderIndex + 1}
                        </span>
                    ) : null}
                </div>
                <div className="flex h-14 min-w-0 items-center gap-2 px-2.5 py-2">
                    <span className="bg-muted relative z-10 flex size-11 shrink-0 -translate-y-4 items-center justify-center overflow-hidden rounded-md border">
                        {iconUrl ? (
                            <FadeInImage
                                src={iconUrl}
                                alt=""
                                className="size-full object-cover"
                                loading="lazy"
                                fallback={
                                    <UsersRoundIcon className="text-muted-foreground size-4" />
                                }
                            />
                        ) : (
                            <UsersRoundIcon className="text-muted-foreground size-4" />
                        )}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="object-row__title block truncate text-sm leading-tight">
                            {group.name || groupId}
                        </span>
                        <span className="object-row__meta block truncate leading-tight">
                            {subtitle}
                        </span>
                    </span>
                    {isOwner || visibility !== 'visible' ? (
                        <span className="flex shrink-0 items-center gap-1">
                            {isOwner ? (
                                <span
                                    className="shrink-0 text-amber-400"
                                    title={t('dialog.group.label.owner_2')}
                                    aria-label={t('dialog.group.label.owner_2')}
                                >
                                    <CrownIcon
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                </span>
                            ) : null}
                            {visibility === 'friends' ? (
                                <span
                                    className="text-muted-foreground shrink-0"
                                    title={t(visibilityLabelKeys.friends)}
                                    aria-label={t(visibilityLabelKeys.friends)}
                                >
                                    <UsersIcon
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                </span>
                            ) : visibility === 'hidden' ? (
                                <span
                                    className="text-muted-foreground shrink-0"
                                    title={t(visibilityLabelKeys.hidden)}
                                    aria-label={t(visibilityLabelKeys.hidden)}
                                >
                                    <EyeOffIcon
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                </span>
                            ) : null}
                        </span>
                    ) : null}
                </div>
            </Button>
            {editMode ? (
                <span
                    role="presentation"
                    className="absolute top-1 left-1 z-20"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <Checkbox
                        checked={selected}
                        className="bg-background/85 shadow-sm"
                        aria-label={`${t('common.actions.select')} ${group.name || groupId}`}
                        onCheckedChange={(checked) => {
                            if (Boolean(checked) !== selected) {
                                onToggleSelected(groupId);
                            }
                        }}
                    />
                </span>
            ) : null}
            {editMode ? null : (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="secondary"
                                className="absolute top-1 right-1 opacity-0 shadow-sm transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 disabled:invisible data-popup-open:opacity-100"
                                disabled={actionsDisabled}
                                aria-label={t('view.my_groups.row_actions')}
                            >
                                <MoreHorizontalIcon data-icon="icon" />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end">
                        {visibilityOptions.map((option) => (
                            <DropdownMenuItem
                                key={option}
                                disabled={option === visibility}
                                onClick={() => onSetVisibility(group, option)}
                            >
                                {t(visibilityLabelKeys[option])}
                            </DropdownMenuItem>
                        ))}
                        {isOwner ? null : (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onLeave(group)}
                                >
                                    <LogOutIcon data-icon="inline-start" />
                                    {t('view.my_groups.leave')}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}
