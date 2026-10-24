/** The part of the bridge its tests import. */
export function decodeAttributedBody(hex: string | null): string | null;
export function normaliseHandle(handle: string): string;
export function mayForward(handle: string, text: string, linked: Set<string>): boolean;
