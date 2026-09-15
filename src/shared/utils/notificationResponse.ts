export type NotificationResponseLike = {
    data?: unknown;
    icon?: string;
    text?: string;
    type?: string;
};

const DISMISS_RESPONSE_TYPE = 'delete';

export function getDismissResponse<TResponse extends NotificationResponseLike>(
    responses: readonly TResponse[] | null | undefined
): TResponse | null {
    if (!Array.isArray(responses)) {
        return null;
    }
    return (
        responses.find(
            (response) => response?.type === DISMISS_RESPONSE_TYPE
        ) || null
    );
}
