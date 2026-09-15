import { cn } from '@/lib/utils';
import { ResizableHandle } from '@/ui/shadcn/resizable';

const WORKSPACE_RESIZE_HANDLE_CLASS_NAME =
    'w-(--vrcx-0-side-panel-resizer-width) shrink-0 cursor-ew-resize bg-transparent select-none after:w-(--vrcx-0-side-panel-resizer-width) before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-(--vrcx-0-workspace-divider) before:transition-[width,background-color] before:duration-(--motion-standard) before:ease-(--ease-out-ui) before:content-[""] data-[separator=hover]:before:w-0.5 data-[separator=hover]:before:bg-(--vrcx-0-resize-accent) data-[separator=hover]:before:delay-100 data-[separator=focus]:before:w-0.5 data-[separator=focus]:before:bg-(--vrcx-0-resize-accent) data-[separator=active]:before:w-0.5 data-[separator=active]:before:bg-(--vrcx-0-resize-accent-active) data-[separator=active]:before:delay-0';

export function WorkspaceResizeHandle({
    className,
    ...props
}: React.ComponentProps<typeof ResizableHandle>) {
    return (
        <ResizableHandle
            className={cn(WORKSPACE_RESIZE_HANDLE_CLASS_NAME, className)}
            {...props}
        />
    );
}
