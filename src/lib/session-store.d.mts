export type SchoolAuth = { username: string; userId: string; sessionId: string; cookiePath?: string };
export type SavedSession = SchoolAuth & { version: number; issuedAt: number; expiresAt: number; remember: boolean };
export const REMEMBER_TTL_SECONDS: number;
export const TEMPORARY_TTL_SECONDS: number;
export function createSession(auth: SchoolAuth, remember?: boolean, now?: number): Promise<{ token: string; session: SavedSession }>;
export function readSession(token: string | undefined, now?: number): Promise<SavedSession | null>;
export function revokeSession(token: string | undefined): Promise<void>;
