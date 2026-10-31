import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CurrentUserSocialStatusDialog } from '@/components/dialogs/user-dialog/UserSelfEditDialogs';
import { useGameIsolationCardStore } from '@/components/layout/status-bar/gameIsolationCardStore';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import {
    ProfileAvatarFrame,
    ProfileNameplate,
    useDecorationHover
} from '@/components/ProfileDecorations';
import {
    CurrentUserActionItems,
    resolveCurrentUserStatusLabelKey
} from '@/components/sidebar/friends-sidebar/FriendsSidebarActionItems';
import { resolveFriendRowDisplay } from '@/components/sidebar/friends-sidebar/FriendsSidebarFriendRow';
import {
    resolveFriendRowLocationState,
    StaticSidebarLocation
} from '@/components/sidebar/friends-sidebar/FriendsSidebarLocation';
import {
    resolveSidebarStatusDotClassName,
    type SidebarFriendRecord
} from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { useFriendsSidebarActions } from '@/components/sidebar/friends-sidebar/useFriendsSidebarActions';
import { useFriendsSidebarPreferences } from '@/components/sidebar/friends-sidebar/useFriendsSidebarPreferences';
import { SidePanelSelfAccountMenu } from '@/components/sidebar/side-panel/SidePanelSelfAccountMenu';
import { useFriendsSidebarDisplayPreferences } from '@/components/sidebar/useFriendsSidebarDisplayPreferences';
import { useFriendsSidebarRuntimeSnapshot } from '@/components/sidebar/useFriendsSidebarRuntimeSnapshot';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { presenceLocationTag, presenceOf } from '@/domain/friends/presence';
import { cn } from '@/lib/utils';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

const STATUS_DESCRIPTION_MAX_LENGTH = 32;

const CONTEXT_MENU_SLOTS = {
    MenuItem: ContextMenuItem,
    CheckboxItem: ContextMenuCheckboxItem,
    Group: ContextMenuGroup,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent
};

const DROPDOWN_MENU_SLOTS = {
    MenuItem: DropdownMenuItem,
    CheckboxItem: DropdownMenuCheckboxItem,
    Group: DropdownMenuGroup,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent
};

export function SidePanelSelfHeader() {
    const { t } = useTranslation();
    const [isEditingDescription, setIsEditingDescription] = useState(false);
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const decorationHover = useDecorationHover();
    const descriptionInputRef = useRef<HTMLInputElement | null>(null);
    const {
        currentEndpoint,
        currentUser,
        currentUserId,
        gameState,
        isDarkMode
    } = useFriendsSidebarRuntimeSnapshot();
    const {
        ageGatedInstancesVisible,
        randomUserColours,
        randomUserColourStyle,
        showInstanceIdInLocation,
        showSidebarAvatarFrame,
        showSidebarNameplate,
        trustColor
    } = useFriendsSidebarDisplayPreferences();
    const { statusPresets } = useFriendsSidebarPreferences();
    const confirm = useModalStore((state) => state.confirm);
    const gameIsolationAvailable = useRuntimeStore(
        (state) => state.hostCapabilities.gameProcessMonitor.available
    );
    const gameIsolationEnabled = useRuntimeStore(
        (state) => state.gameIsolation.enabled
    );
    const {
        applyCurrentUserStatusPreset,
        changeCurrentUserStatus,
        editCurrentUserSocialStatus,
        openFriend,
        setCurrentUserStatusDescription,
        socialStatusDialog
    } = useFriendsSidebarActions({
        confirm,
        currentUser,
        currentUserId
    });

    const selfRow = useMemo<SidebarFriendRecord | null>(
        () => (currentUser ? { ...currentUser } : null),
        [currentUser]
    );
    const { displaySource, imageUrl, displayName, nameStyle } =
        resolveFriendRowDisplay(selfRow, {
            randomUserColours,
            randomUserColourStyle,
            isDarkMode,
            trustColor
        });
    const selfPresence = presenceOf(selfRow);
    const locationMetadata = useLocationMetadata({
        locationInfo: selfPresence
            ? presenceLocationTag(selfPresence, { preferTraveling: true })
            : '',
        currentLocation: gameState?.currentLocation || '',
        endpoint: currentEndpoint || ''
    });

    useEffect(() => {
        if (!isEditingDescription) {
            return;
        }
        const input = descriptionInputRef.current;
        input?.focus();
        input?.select();
    }, [isEditingDescription]);

    if (!selfRow) {
        return (
            <CurrentUserSocialStatusDialog controller={socialStatusDialog} />
        );
    }

    const statusValue = String(displaySource?.status || '');
    const statusDescription = String(displaySource?.statusDescription || '');
    const {
        displayLocation,
        displayTraveling,
        metadataHint,
        showLocationSubline
    } = resolveFriendRowLocationState({
        friend: selfRow,
        isCurrentUser: true,
        isGroupByInstance: false,
        locationTime: null
    });
    const editDescriptionLabel = t(
        'component.friends_sidebar.modal.edit_status_description'
    );
    const statusLabel = t(resolveCurrentUserStatusLabelKey(statusValue));
    const iconFrameId = showSidebarAvatarFrame ? selfRow.iconFrame?.trim() : '';
    const nameplateId = showSidebarNameplate
        ? selfRow.nameplateEffect?.trim()
        : '';

    function commitDescription() {
        setIsEditingDescription(false);
        const nextDescription = descriptionDraft.trim();
        if (nextDescription === statusDescription) {
            return;
        }
        setCurrentUserStatusDescription(nextDescription);
    }

    const openSelf = () => openFriend(selfRow);

    const renderActionItems = (
        slots: typeof CONTEXT_MENU_SLOTS,
        showOpen: boolean
    ) => {
        return (
            <CurrentUserActionItems
                friend={selfRow}
                onOpen={openSelf}
                onChangeStatus={changeCurrentUserStatus}
                onSetStatusDescription={setCurrentUserStatusDescription}
                onEditSocialStatus={editCurrentUserSocialStatus}
                onApplyStatusPreset={applyCurrentUserStatusPreset}
                statusPresets={statusPresets}
                showOpen={showOpen}
                {...slots}
            />
        );
    };

    return (
        <div
            className="vrcx-0-side-panel-self ml-2 flex shrink-0 items-center pt-4 pb-2 pl-2"
            {...decorationHover.hoverProps}
        >
            <ContextMenu>
                <ContextMenuTrigger
                    render={
                        <div className="relative isolate mr-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5">
                            {nameplateId ? (
                                <ProfileNameplate
                                    templateId={nameplateId}
                                    active={decorationHover.active}
                                />
                            ) : null}
                            <button
                                type="button"
                                aria-label={`${displayName} · ${statusLabel}`}
                                className="focus-visible:ring-ring shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2"
                                onClick={openSelf}
                            >
                                <UserStatusAvatar
                                    className="size-10"
                                    imageUrl={imageUrl}
                                    statusDotClassName={resolveSidebarStatusDotClassName(
                                        selfRow,
                                        { hideNonFriend: false }
                                    )}
                                    frame={
                                        iconFrameId ? (
                                            <ProfileAvatarFrame
                                                templateId={iconFrameId}
                                                active={decorationHover.active}
                                            />
                                        ) : null
                                    }
                                />
                            </button>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <DropdownMenu>
                                    <DropdownMenuTrigger
                                        render={
                                            <button
                                                type="button"
                                                aria-label={t(
                                                    'side_panel.self_menu'
                                                )}
                                                className="focus-visible:ring-ring text-content-tertiary flex min-w-0 cursor-pointer items-center gap-0.5 rounded-md text-left outline-none focus-visible:ring-2"
                                            />
                                        }
                                    >
                                        <span
                                            style={nameStyle}
                                            className="min-w-0 truncate text-sm leading-5 font-medium"
                                        >
                                            {displayName}
                                        </span>
                                        {gameIsolationEnabled ? (
                                            <span className="text-content-secondary shrink-0 rounded border px-1 text-[10px] leading-4">
                                                {t('game_isolation.badge')}
                                            </span>
                                        ) : null}
                                        <ChevronDownIcon className="size-3.5 shrink-0" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="start"
                                        className="w-56"
                                    >
                                        {renderActionItems(
                                            DROPDOWN_MENU_SLOTS,
                                            true
                                        )}
                                        {gameIsolationAvailable ? (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        useGameIsolationCardStore
                                                            .getState()
                                                            .setOpen(true)
                                                    }
                                                >
                                                    {t(
                                                        'game_isolation.menu_item'
                                                    )}
                                                </DropdownMenuItem>
                                            </>
                                        ) : null}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                {isEditingDescription ? (
                                    <input
                                        ref={descriptionInputRef}
                                        type="text"
                                        maxLength={
                                            STATUS_DESCRIPTION_MAX_LENGTH
                                        }
                                        value={descriptionDraft}
                                        aria-label={editDescriptionLabel}
                                        className="ring-ring text-content-primary -mx-1 h-4 min-w-0 rounded-md bg-transparent px-1 text-xs outline-none focus-visible:ring-2"
                                        onChange={(event) =>
                                            setDescriptionDraft(
                                                event.target.value
                                            )
                                        }
                                        onBlur={commitDescription}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.currentTarget.blur();
                                                return;
                                            }
                                            if (event.key === 'Escape') {
                                                setDescriptionDraft(
                                                    statusDescription
                                                );
                                                setIsEditingDescription(false);
                                            }
                                        }}
                                    />
                                ) : (
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <button
                                                    type="button"
                                                    aria-label={
                                                        editDescriptionLabel
                                                    }
                                                    className={cn(
                                                        'focus-visible:ring-ring -mx-1 h-4 min-w-0 cursor-text truncate rounded-md px-1 text-left text-xs leading-4 outline-none focus-visible:ring-2',
                                                        statusDescription
                                                            ? 'text-content-secondary'
                                                            : 'text-content-disabled hover:text-content-tertiary'
                                                    )}
                                                    onClick={() => {
                                                        setDescriptionDraft(
                                                            statusDescription
                                                        );
                                                        setIsEditingDescription(
                                                            true
                                                        );
                                                    }}
                                                >
                                                    {statusDescription ||
                                                        t(
                                                            'dialog.user.action.edit_social_status'
                                                        )}
                                                </button>
                                            }
                                        />
                                        <TooltipContent>
                                            {statusDescription ||
                                                t(
                                                    'dialog.user.action.edit_social_status'
                                                )}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                                {showLocationSubline ? (
                                    <div
                                        className="text-content-secondary flex h-4 min-w-0 items-center text-xs leading-4"
                                        onContextMenu={(event) =>
                                            event.stopPropagation()
                                        }
                                    >
                                        <StaticSidebarLocation
                                            location={displayLocation}
                                            traveling={displayTraveling}
                                            hint={metadataHint}
                                            metadata={locationMetadata}
                                            link
                                            showGroupLink
                                            showInstanceIdInLocation={
                                                showInstanceIdInLocation
                                            }
                                            ageGatedInstancesVisible={
                                                ageGatedInstancesVisible
                                            }
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    }
                />
                <ContextMenuContent className="w-56">
                    {renderActionItems(CONTEXT_MENU_SLOTS, true)}
                </ContextMenuContent>
            </ContextMenu>
            <div className="flex w-9 shrink-0 justify-center">
                <SidePanelSelfAccountMenu />
            </div>
            <CurrentUserSocialStatusDialog controller={socialStatusDialog} />
        </div>
    );
}
