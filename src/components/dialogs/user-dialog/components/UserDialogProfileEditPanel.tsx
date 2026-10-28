import { BanIcon, PackageIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState,
    LoadingState,
    PageBackButton,
    PageHeader,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { SelectableTile } from '@/components/tile/SelectableTile';
import {
    isEquippedProfileDecoration,
    resolveInventoryName,
    resolveProfileDecorationPreviewUrl,
    resolveProfileDecorationTypeLabelKey
} from '@/domain/entities/inventory';
import { cn } from '@/lib/utils';
import type { ProfileMediaField } from '@/shared/utils/currentUserMedia';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    PROFILE_DECORATION_SLOTS,
    type ProfileDecorationSlot
} from '../userDialogProfileAppearance';
import type { UserDialogProfileRecord } from '../userDialogProfileTypes';
import { UserProfileDetailsFields } from '../UserSelfEditDialogs';
import {
    UNEQUIP_PENDING_KEY,
    type UserDialogProfileDecorationsController
} from '../useUserDialogProfileDecorations';
import type { useUserDialogSelfActions } from '../useUserDialogSelfActions';
import { UserDialogProfileBackgroundPicker } from './UserDialogProfileBackgroundPicker';
import { UserProfileMediaPicker } from './UserProfileMediaPicker';

type ProfileEditTab =
    | 'details'
    | ProfileMediaField
    | ProfileDecorationSlot
    | 'background';

const PROFILE_EDIT_TABS: readonly ProfileEditTab[] = [
    'details',
    'userIcon',
    'banner',
    ...PROFILE_DECORATION_SLOTS,
    'background'
];

function isProfileEditTab(value: string): value is ProfileEditTab {
    return PROFILE_EDIT_TABS.some((tab) => tab === value);
}

function isProfileDecorationSlot(
    tab: ProfileEditTab
): tab is ProfileDecorationSlot {
    return PROFILE_DECORATION_SLOTS.some((slot) => slot === tab);
}

type ProfileDetailsController = ReturnType<
    typeof useUserDialogSelfActions
>['profileDetails'];

function ProfileDecorationSlotPicker({
    slot,
    controller
}: {
    slot: ProfileDecorationSlot;
    controller: UserDialogProfileDecorationsController;
}) {
    const { t } = useTranslation();
    const { itemsBySlot, pendingKey, isReady, equipItem, unequipSlot } =
        controller;
    const pending = Boolean(pendingKey);
    const items = itemsBySlot[slot];
    const hasEquipped = items.some(isEquippedProfileDecoration);
    const isIconFrame = slot === 'iconFrame';
    const isNameplate = slot === 'nameplateEffect';
    const tileAspectClassName = isNameplate ? 'aspect-[5/1]' : 'aspect-square';
    const tileContentClassName = isIconFrame
        ? undefined
        : isNameplate
          ? 'px-4 py-3'
          : 'p-3';
    const tileImageClassName = isIconFrame
        ? undefined
        : 'size-full object-cover';

    if (!isReady) {
        return <LoadingState className="min-h-48" />;
    }

    return (
        <div className="flex flex-col gap-3">
            <div
                className={cn(
                    'grid gap-2',
                    isNameplate
                        ? 'grid-cols-1 sm:grid-cols-2'
                        : 'grid-cols-3 sm:grid-cols-4'
                )}
            >
                <SelectableTile
                    label={t('dialog.gallery_select.none')}
                    icon={BanIcon}
                    isCurrent={!hasEquipped}
                    busy={pendingKey === UNEQUIP_PENDING_KEY}
                    inert={pending || !hasEquipped}
                    aspectClassName={tileAspectClassName}
                    surfaceClassName={tileContentClassName}
                    imageClassName={tileImageClassName}
                    onClick={() => unequipSlot(slot)}
                />
                {items.map((item) => {
                    const equipped = isEquippedProfileDecoration(item);
                    return (
                        <SelectableTile
                            key={item.id}
                            label={resolveInventoryName(item)}
                            imageUrl={resolveProfileDecorationPreviewUrl(item)}
                            isCurrent={equipped}
                            busy={pendingKey === item.id}
                            inert={pending || equipped}
                            aspectClassName={tileAspectClassName}
                            surfaceClassName={tileContentClassName}
                            imageClassName={tileImageClassName}
                            onClick={() => equipItem(item)}
                        />
                    );
                })}
            </div>
            {!items.length ? (
                <EmptyState
                    icon={PackageIcon}
                    className="min-h-32"
                    title={t('dialog.inventory.empty_title')}
                    description={t('dialog.inventory.empty_description')}
                />
            ) : null}
        </div>
    );
}

function ProfileDetailsTab({
    busy,
    details,
    statusDotClassName,
    statusText,
    onEditStatus,
    onSaved
}: {
    busy: boolean;
    details: ProfileDetailsController;
    statusDotClassName: string;
    statusText: string;
    onEditStatus: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
                <Field>
                    <FieldLabel>
                        {t('dialog.user.label.social_status')}
                    </FieldLabel>
                    <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2">
                        <i className={cn('shrink-0', statusDotClassName)} />
                        <span className="min-w-0 flex-1 truncate text-sm">
                            {statusText}
                        </span>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={t(
                                            'dialog.user.action.edit_social_status'
                                        )}
                                        disabled={busy}
                                        onClick={onEditStatus}
                                    >
                                        <PencilIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.user.action.edit_social_status')}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </Field>
                <UserProfileDetailsFields
                    busy={busy}
                    draft={details.draft}
                    setDraft={details.setDraft}
                    languageRows={details.languageRows}
                    availableLanguageOptions={details.availableLanguageOptions}
                    languageOptionsStatus={details.languageOptionsStatus}
                />
            </div>
            <div className="flex shrink-0 justify-end gap-2 px-1">
                <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={details.onReset}
                >
                    {t('common.actions.cancel')}
                </Button>
                <Button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                        if (await details.onSave()) onSaved();
                    }}
                >
                    {t('common.actions.save')}
                </Button>
            </div>
        </div>
    );
}

export function UserDialogProfileEditPanel({
    profile,
    isVrcPlus,
    busy,
    details,
    decorations,
    statusDotClassName,
    statusText,
    onBack,
    onEditStatus,
    onSetMediaFile,
    onSetBannerColor
}: {
    profile: UserDialogProfileRecord;
    isVrcPlus: boolean;
    busy: boolean;
    details: ProfileDetailsController;
    decorations: UserDialogProfileDecorationsController;
    statusDotClassName: string;
    statusText: string;
    onBack: () => void;
    onEditStatus: () => void;
    onSetMediaFile: (
        field: ProfileMediaField,
        fileId: string
    ) => Promise<unknown>;
    onSetBannerColor: (hexColor: string) => Promise<unknown>;
}) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<ProfileEditTab>('details');
    const tabLabel = (tab: ProfileEditTab) => {
        if (tab === 'details') {
            return t('dialog.user.profile_edit.details');
        }
        if (tab === 'userIcon') {
            return t('dialog.user.profile_media.profile_icon');
        }
        if (tab === 'banner') {
            return t('dialog.user.profile_media.banner');
        }
        if (tab === 'background') {
            return t('dialog.inventory.background');
        }
        return t(resolveProfileDecorationTypeLabelKey(tab) ?? '');
    };

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => {
                if (isProfileEditTab(value)) setActiveTab(value);
            }}
            className="flex min-h-0 flex-1 flex-col gap-3"
        >
            <PageToolbar>
                <PageToolbarRow className="items-center">
                    <PageBackButton
                        label={t('common.actions.back')}
                        onClick={onBack}
                    />
                    <PageHeader className="min-w-0 p-0">
                        <PageTitle>
                            {t('dialog.user.actions.edit_profile')}
                        </PageTitle>
                    </PageHeader>
                </PageToolbarRow>
            </PageToolbar>
            <TabsList className="max-w-full justify-start overflow-x-auto">
                {PROFILE_EDIT_TABS.map((tab) => {
                    const label = tabLabel(tab);
                    return (
                        <TabsTrigger key={tab} value={tab} aria-label={label}>
                            {label}
                        </TabsTrigger>
                    );
                })}
            </TabsList>
            <TabsContent
                value={activeTab}
                className={cn(
                    'min-h-0 flex-1',
                    activeTab === 'details'
                        ? 'flex flex-col'
                        : 'overflow-y-auto p-1'
                )}
            >
                {activeTab === 'details' ? (
                    <ProfileDetailsTab
                        busy={busy}
                        details={details}
                        statusDotClassName={statusDotClassName}
                        statusText={statusText}
                        onEditStatus={onEditStatus}
                        onSaved={onBack}
                    />
                ) : activeTab === 'userIcon' || activeTab === 'banner' ? (
                    <UserProfileMediaPicker
                        key={activeTab}
                        field={activeTab}
                        profile={profile}
                        isVrcPlus={isVrcPlus}
                        busy={busy}
                        onSetFile={onSetMediaFile}
                        onSetBannerColor={onSetBannerColor}
                    />
                ) : activeTab === 'background' ? (
                    <UserDialogProfileBackgroundPicker
                        profile={profile}
                        isVrcPlus={isVrcPlus || profile.hasVrcPlus === true}
                        pendingKey={decorations.pendingKey}
                        onUpdateBackground={decorations.updateBackground}
                    />
                ) : isProfileDecorationSlot(activeTab) ? (
                    <ProfileDecorationSlotPicker
                        slot={activeTab}
                        controller={decorations}
                    />
                ) : null}
            </TabsContent>
        </Tabs>
    );
}
