import {
    DndContext,
    closestCenter,
    type DragEndEvent,
    useDroppable
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    EyeIcon,
    EyeOffIcon,
    FolderXIcon,
    GripVerticalIcon,
    PencilIcon,
    Trash2Icon
} from 'lucide-react';
import type {
    CSSProperties,
    HTMLAttributes,
    MouseEvent,
    ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    NAV_ICON_OPTIONS,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isToolNavKey } from '@/shared/constants/tools';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';

import {
    definitionLabel,
    getFolderDropId,
    getFolderItemIcon,
    getFolderItemKey,
    getFolderSortableId,
    getItemSortableId,
    isDashboardKey,
    type CustomNavDefinition,
    type CustomNavLayout,
    type CustomNavFolderItem
} from './customNavLayout';

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;
type DndSensors = Parameters<typeof DndContext>[0]['sensors'];
type DragHandleProps = HTMLAttributes<HTMLElement> & {
    ref?: (node: HTMLElement | null) => void;
};
type SortableRowRenderProps = {
    rowRef: (node: HTMLElement | null) => void;
    rowStyle: CSSProperties;
    dragHandleProps: DragHandleProps;
    isDragging: boolean;
};

type NavIconSelectProps = {
    value?: unknown;
    fallbackIcon?: unknown;
    ariaLabel: string;
    onValueChange: (value: string) => void;
};

type NavItemRowProps = Partial<SortableRowRenderProps> & {
    label: ReactNode;
    icon?: unknown;
    fallbackIcon?: unknown;
    indent?: boolean;
    isTool: boolean;
    isDashboard: boolean;
    onHide: () => void;
    onIconChange?: (value: string) => void;
    onEditDashboard: () => void;
    onDeleteDashboard: () => void;
};

type SortableNavItemRowProps = {
    id: string;
    children: (props: SortableRowRenderProps) => ReactNode;
};

type FolderDropZoneProps = {
    folderId: unknown;
    label: ReactNode;
};

type HiddenNavItem = {
    key: unknown;
    label: string;
};

type CustomNavDialogLayoutEditorProps = {
    sensors: DndSensors;
    sortableNodeIds: string[];
    localLayout: CustomNavLayout;
    definitionMap: Map<unknown, CustomNavDefinition>;
    hiddenItems: HiddenNavItem[];
    onDragEnd: (event: DragEndEvent) => void;
    onFolderIconChange: (
        index: number,
        icon: string,
        fallbackIcon?: unknown
    ) => void;
    onFolderEdit: (index: number) => void;
    onFolderDelete: (index: number) => void;
    onFolderChildIconChange: (
        folderIndex: number,
        itemIndex: number,
        icon: string,
        fallbackIcon: unknown
    ) => void;
    onHideItem: (key: unknown) => void;
    onEditDashboard: (key: unknown) => void;
    onDeleteDashboard: (key: unknown) => void;
    onShowItem: (key: unknown) => void;
};

function customNavActionLabel(t: TranslationFn, key: string, value: unknown) {
    return t(`nav_menu.custom_nav.dynamic.${key}`, { value });
}

function NavIconSelect({
    value,
    fallbackIcon,
    ariaLabel,
    onValueChange
}: NavIconSelectProps) {
    const normalizedIcon = normalizeNavIconKey(value, fallbackIcon);

    return (
        <Select
            value={normalizedIcon}
            items={NAV_ICON_OPTIONS.map((option) => {
                const OptionIcon = getNavIconComponent(option.key);
                return {
                    value: option.key,
                    label: (
                        <span className="flex min-w-0 items-center gap-2">
                            <OptionIcon data-icon="inline-start" />
                            <span className="truncate">{option.label}</span>
                        </span>
                    )
                };
            })}
            onValueChange={(value) => onValueChange(value ?? '')}
        >
            <SelectTrigger size="sm" className="w-32" aria-label={ariaLabel}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                <SelectGroup>
                    {NAV_ICON_OPTIONS.map((option) => {
                        const OptionIcon = getNavIconComponent(option.key);
                        return (
                            <SelectItem key={option.key} value={option.key}>
                                <span className="flex min-w-0 items-center gap-2">
                                    <OptionIcon data-icon="inline-start" />
                                    <span className="truncate">
                                        {option.label}
                                    </span>
                                </span>
                            </SelectItem>
                        );
                    })}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

function NavItemRow({
    label,
    icon,
    fallbackIcon = DEFAULT_NAV_ICON_KEY,
    indent = false,
    rowRef,
    rowStyle,
    dragHandleProps,
    isDragging = false,
    isTool,
    isDashboard,
    onHide,
    onIconChange,
    onEditDashboard,
    onDeleteDashboard
}: NavItemRowProps) {
    const { t } = useTranslation();

    return (
        <div
            ref={rowRef}
            style={rowStyle}
            className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
                isDragging && 'opacity-50',
                indent && 'ml-6'
            )}
        >
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
                aria-label={customNavActionLabel(t, 'drag_value', label)}
                {...dragHandleProps}
            >
                <GripVerticalIcon data-icon="inline-start" />
            </Button>
            {onIconChange ? (
                <NavIconSelect
                    value={icon}
                    fallbackIcon={fallbackIcon}
                    ariaLabel={customNavActionLabel(t, 'icon_for_value', label)}
                    onValueChange={(onValue) => onIconChange(onValue)}
                />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {isDashboard ? (
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={customNavActionLabel(
                            t,
                            'edit_value',
                            label
                        )}
                        onClick={onEditDashboard}
                    >
                        <PencilIcon data-icon="inline-start" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={customNavActionLabel(
                            t,
                            'delete_value',
                            label
                        )}
                        onClick={onDeleteDashboard}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </Button>
                </>
            ) : null}
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={customNavActionLabel(
                    t,
                    isTool ? 'remove_value' : 'hide_value',
                    label
                )}
                onClick={onHide}
            >
                {isTool ? (
                    <Trash2Icon data-icon="inline-start" />
                ) : (
                    <EyeOffIcon data-icon="inline-start" />
                )}
            </Button>
        </div>
    );
}

function SortableNavItemRow({ id, children }: SortableNavItemRowProps) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    const rowStyle: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const dragHandleProps: DragHandleProps = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation()
    };

    return children({
        rowRef: setNodeRef,
        rowStyle,
        dragHandleProps,
        isDragging
    });
}

function FolderDropZone({ folderId, label }: FolderDropZoneProps) {
    const { setNodeRef } = useDroppable({
        id: getFolderDropId(folderId)
    });

    return (
        <div
            ref={setNodeRef}
            className="text-muted-foreground ml-6 rounded-md border border-dashed px-2 py-1.5 text-sm"
        >
            {label}
        </div>
    );
}

export function CustomNavDialogLayoutEditor({
    sensors,
    sortableNodeIds,
    localLayout,
    definitionMap,
    hiddenItems,
    onDragEnd,
    onFolderIconChange,
    onFolderEdit,
    onFolderDelete,
    onFolderChildIconChange,
    onHideItem,
    onEditDashboard,
    onDeleteDashboard,
    onShowItem
}: CustomNavDialogLayoutEditorProps) {
    const { t } = useTranslation();

    return (
        <>
            <DndContext
                accessibility={
                    typeof document === 'undefined'
                        ? undefined
                        : { container: document.body }
                }
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
            >
                <SortableContext
                    items={sortableNodeIds}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="flex flex-col gap-1">
                        {localLayout.map((entry, index) => {
                            if (entry.type === 'folder') {
                                return (
                                    <div
                                        key={String(entry.id)}
                                        className="flex flex-col gap-1 rounded-lg border p-2"
                                    >
                                        <SortableNavItemRow
                                            id={getFolderSortableId(entry.id)}
                                        >
                                            {({
                                                rowRef,
                                                rowStyle,
                                                dragHandleProps,
                                                isDragging
                                            }) => (
                                                <div
                                                    ref={rowRef}
                                                    style={rowStyle}
                                                    className={cn(
                                                        'flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors',
                                                        isDragging &&
                                                            'opacity-50'
                                                    )}
                                                >
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
                                                        aria-label={customNavActionLabel(
                                                            t,
                                                            'drag_value',
                                                            entry.name
                                                        )}
                                                        {...dragHandleProps}
                                                    >
                                                        <GripVerticalIcon data-icon="inline-start" />
                                                    </Button>
                                                    <NavIconSelect
                                                        value={entry.icon}
                                                        fallbackIcon={
                                                            DEFAULT_FOLDER_ICON
                                                        }
                                                        ariaLabel={customNavActionLabel(
                                                            t,
                                                            'icon_for_value',
                                                            entry.name
                                                        )}
                                                        onValueChange={(icon) =>
                                                            onFolderIconChange(
                                                                index,
                                                                icon
                                                            )
                                                        }
                                                    />
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {String(
                                                            entry.name || ''
                                                        )}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        aria-label={customNavActionLabel(
                                                            t,
                                                            'edit_value',
                                                            entry.name
                                                        )}
                                                        onClick={() =>
                                                            onFolderEdit(index)
                                                        }
                                                    >
                                                        <PencilIcon data-icon="inline-start" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        aria-label={customNavActionLabel(
                                                            t,
                                                            'delete_value',
                                                            entry.name
                                                        )}
                                                        onClick={() =>
                                                            onFolderDelete(
                                                                index
                                                            )
                                                        }
                                                    >
                                                        <FolderXIcon data-icon="inline-start" />
                                                    </Button>
                                                </div>
                                            )}
                                        </SortableNavItemRow>
                                        {entry.items?.length ? (
                                            <div className="flex flex-col gap-1">
                                                {entry.items.map(
                                                    (
                                                        item: CustomNavFolderItem,
                                                        childIndex
                                                    ) => {
                                                        const key =
                                                            getFolderItemKey(
                                                                item
                                                            );
                                                        const definition =
                                                            definitionMap.get(
                                                                key
                                                            );
                                                        if (!definition) {
                                                            return null;
                                                        }
                                                        return (
                                                            <SortableNavItemRow
                                                                key={String(
                                                                    key
                                                                )}
                                                                id={getItemSortableId(
                                                                    key
                                                                )}
                                                            >
                                                                {(rowProps) => (
                                                                    <NavItemRow
                                                                        {...rowProps}
                                                                        indent
                                                                        label={definitionLabel(
                                                                            definition,
                                                                            t
                                                                        )}
                                                                        icon={
                                                                            getFolderItemIcon(
                                                                                item
                                                                            ) ||
                                                                            definition.icon
                                                                        }
                                                                        fallbackIcon={
                                                                            definition.icon ||
                                                                            DEFAULT_NAV_ICON_KEY
                                                                        }
                                                                        isTool={isToolNavKey(
                                                                            key
                                                                        )}
                                                                        isDashboard={isDashboardKey(
                                                                            key
                                                                        )}
                                                                        onIconChange={(
                                                                            icon
                                                                        ) =>
                                                                            onFolderChildIconChange(
                                                                                index,
                                                                                childIndex,
                                                                                icon,
                                                                                definition.icon ||
                                                                                    DEFAULT_NAV_ICON_KEY
                                                                            )
                                                                        }
                                                                        onHide={() =>
                                                                            onHideItem(
                                                                                key
                                                                            )
                                                                        }
                                                                        onEditDashboard={() =>
                                                                            onEditDashboard(
                                                                                key
                                                                            )
                                                                        }
                                                                        onDeleteDashboard={() =>
                                                                            onDeleteDashboard(
                                                                                key
                                                                            )
                                                                        }
                                                                    />
                                                                )}
                                                            </SortableNavItemRow>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        ) : (
                                            <FolderDropZone
                                                folderId={entry.id}
                                                label={t(
                                                    'nav_menu.custom_nav.folder_drop_here'
                                                )}
                                            />
                                        )}
                                    </div>
                                );
                            }

                            const definition = definitionMap.get(entry.key);
                            if (!definition) {
                                return null;
                            }
                            return (
                                <SortableNavItemRow
                                    key={String(entry.key)}
                                    id={getItemSortableId(entry.key)}
                                >
                                    {(rowProps) => (
                                        <NavItemRow
                                            {...rowProps}
                                            label={definitionLabel(
                                                definition,
                                                t
                                            )}
                                            icon={entry.icon || definition.icon}
                                            fallbackIcon={
                                                definition.icon ||
                                                DEFAULT_NAV_ICON_KEY
                                            }
                                            isTool={isToolNavKey(entry.key)}
                                            isDashboard={isDashboardKey(
                                                entry.key
                                            )}
                                            onIconChange={(icon) =>
                                                onFolderIconChange(
                                                    index,
                                                    icon,
                                                    definition.icon ||
                                                        DEFAULT_NAV_ICON_KEY
                                                )
                                            }
                                            onHide={() => onHideItem(entry.key)}
                                            onEditDashboard={() =>
                                                onEditDashboard(entry.key)
                                            }
                                            onDeleteDashboard={() =>
                                                onDeleteDashboard(entry.key)
                                            }
                                        />
                                    )}
                                </SortableNavItemRow>
                            );
                        })}
                    </div>
                </SortableContext>
            </DndContext>
            {hiddenItems.length ? (
                <>
                    <div className="my-4 flex items-center gap-2">
                        <Separator className="flex-1" />
                        <span className="text-muted-foreground text-xs">
                            {t('nav_menu.custom_nav.hidden_items')}
                        </span>
                        <Separator className="flex-1" />
                    </div>
                    <div className="flex flex-col gap-1">
                        {hiddenItems.map((item) => (
                            <Button
                                key={String(item.key)}
                                type="button"
                                variant="ghost"
                                className="text-muted-foreground h-auto w-full justify-start px-2 py-1.5 text-left font-normal"
                                aria-label={customNavActionLabel(
                                    t,
                                    'show_value',
                                    item.label
                                )}
                                onClick={() => onShowItem(item.key)}
                            >
                                <EyeIcon data-icon="inline-start" />
                                <span className="min-w-0 flex-1 truncate">
                                    {item.label}
                                </span>
                            </Button>
                        ))}
                    </div>
                </>
            ) : null}
        </>
    );
}
