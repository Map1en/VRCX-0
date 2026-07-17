export function evictOverflow(order: string[], capacity: number): string[] {
    const overflow = order.length - capacity;
    return overflow > 0 ? order.splice(0, overflow) : [];
}
