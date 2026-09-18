import { BanIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectableTile } from '@/components/tile/SelectableTile';
import type { CurrentUserProfileUpdateRequest } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import {
    buildGradientBackgroundUpdate,
    isProfileBackgroundTextureAvailable,
    PROFILE_BACKGROUND_TEXTURES,
    resolveProfileGradientColors
} from '../profileBackgroundSelection';
import type { UserDialogProfileRecord } from '../userDialogProfileTypes';

const NO_BACKGROUND_PREVIEW_STYLE: CSSProperties = {
    backgroundImage:
        'repeating-linear-gradient(45deg, color-mix(in oklch, var(--muted-foreground) 10%, transparent) 0 6px, transparent 6px 12px)'
};

function GradientColorField({
    label,
    value,
    disabled,
    onChange
}: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <label
            className="flex shrink-0 items-center gap-1.5 text-xs font-medium"
            title={label}
        >
            <span className="text-muted-foreground">{label}</span>
            <Input
                type="color"
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                className="size-8 shrink-0 cursor-pointer p-0.5"
            />
        </label>
    );
}

export function UserDialogProfileBackgroundPicker({
    profile,
    isVrcPlus,
    pendingKey,
    onUpdateBackground
}: {
    profile: UserDialogProfileRecord;
    isVrcPlus: boolean;
    pendingKey: string;
    onUpdateBackground: (
        key: string,
        params: CurrentUserProfileUpdateRequest
    ) => void;
}) {
    const { t } = useTranslation();
    const { top: profileGradientTop, bottom: profileGradientBottom } =
        resolveProfileGradientColors(profile);
    const [gradientTop, setGradientTop] = useState(profileGradientTop);
    const [gradientBottom, setGradientBottom] = useState(profileGradientBottom);
    const [showGradientEditor, setShowGradientEditor] = useState(
        profile.backgroundType === 'gradient'
    );
    const pending = Boolean(pendingKey);
    const vrcPlusHint = t('dialog.inventory.requires_vrc_plus');

    useEffect(() => {
        if (pending || profile.backgroundType !== 'gradient') {
            return;
        }
        setGradientTop(profileGradientTop);
        setGradientBottom(profileGradientBottom);
    }, [
        pending,
        profile.backgroundGradientBottom,
        profile.backgroundGradientTop,
        profile.backgroundType,
        profileGradientBottom,
        profileGradientTop
    ]);

    const gradientChanged =
        profile.backgroundType !== 'gradient' ||
        gradientTop !== profileGradientTop ||
        gradientBottom !== profileGradientBottom;
    const gradientStyle = {
        backgroundImage: `linear-gradient(180deg, ${gradientTop}, ${gradientBottom})`
    };

    return (
        <div className="flex flex-col gap-3">
            {showGradientEditor ? (
                <div className="border-border bg-muted/20 flex flex-wrap items-center gap-2 rounded-lg border p-2">
                    <GradientColorField
                        label={t('dialog.inventory.gradient_top')}
                        value={gradientTop}
                        disabled={pending}
                        onChange={setGradientTop}
                    />
                    <GradientColorField
                        label={t('dialog.inventory.gradient_bottom')}
                        value={gradientBottom}
                        disabled={pending}
                        onChange={setGradientBottom}
                    />
                    <Button
                        type="button"
                        size="sm"
                        className="ms-auto"
                        disabled={pending || !gradientChanged}
                        onClick={() =>
                            onUpdateBackground(
                                'gradient',
                                buildGradientBackgroundUpdate(
                                    gradientTop,
                                    gradientBottom
                                )
                            )
                        }
                    >
                        {t('dialog.inventory.apply_gradient')}
                    </Button>
                </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SelectableTile
                    label={t('dialog.inventory.background_default')}
                    showLabel
                    icon={BanIcon}
                    previewStyle={NO_BACKGROUND_PREVIEW_STYLE}
                    aspectClassName="aspect-[16/9]"
                    isCurrent={profile.backgroundType === 'default'}
                    busy={pendingKey === 'default'}
                    inert={pending || profile.backgroundType === 'default'}
                    onClick={() => {
                        setShowGradientEditor(false);
                        onUpdateBackground('default', {
                            backgroundType: 'default'
                        });
                    }}
                />
                <SelectableTile
                    label={t('dialog.inventory.background_gradient')}
                    showLabel
                    fallbackIcon={false}
                    previewStyle={gradientStyle}
                    aspectClassName="aspect-[16/9]"
                    isCurrent={
                        profile.backgroundType === 'gradient' &&
                        !gradientChanged
                    }
                    busy={pendingKey === 'gradient'}
                    inert={pending}
                    onClick={() => setShowGradientEditor(true)}
                />
                {PROFILE_BACKGROUND_TEXTURES.map((texture) => {
                    const locked = !isProfileBackgroundTextureAvailable(
                        texture.textureId,
                        isVrcPlus
                    );
                    const isCurrent =
                        profile.backgroundType === 'texture' &&
                        profile.backgroundTextureId === texture.textureId;
                    return (
                        <SelectableTile
                            key={texture.textureId}
                            label={texture.label}
                            showLabel
                            hint={locked ? vrcPlusHint : undefined}
                            badge={texture.requiresVrcPlus ? 'VRC+' : undefined}
                            imageUrl={texture.imageUrl}
                            imageClassName="size-full object-cover"
                            aspectClassName="aspect-[16/9]"
                            isCurrent={isCurrent}
                            locked={locked}
                            busy={pendingKey === texture.textureId}
                            inert={pending || locked || isCurrent}
                            onClick={() => {
                                setShowGradientEditor(false);
                                onUpdateBackground(texture.textureId, {
                                    backgroundType: 'texture',
                                    backgroundTextureId: texture.textureId
                                });
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}
