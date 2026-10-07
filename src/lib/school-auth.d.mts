import type { NextRequest, NextResponse } from 'next/server';
import type { SchoolAuth, SavedSession } from './session-store.mjs';
export const API_UA: string;
export class AuthenticationError extends Error {
 status: number;
 code: string;
 upstreamErrorCode: string;
 constructor(status: number, code: string, message: string, upstreamErrorCode?: string);
}
export function isSameOriginRequest(req: NextRequest): boolean;
export function sessionCookieName(req: NextRequest): string;
export function setSessionCookie(response: NextResponse, req: NextRequest, token: string, remember: boolean): void;
export function clearSessionCookie(response: NextResponse, req: NextRequest): void;
export function getSavedSession(req: NextRequest): Promise<SavedSession | null>;
export function invalidateSession(req: NextRequest): Promise<void>;
export function loginSchool(username: string, password: string): Promise<SchoolAuth>;
export function authenticateRequest(req: NextRequest, body: Record<string, unknown>): Promise<SchoolAuth>;
export function isUpstreamSessionExpired(status: number, data?: unknown): boolean;
export function expiredSessionError(req: NextRequest): Promise<AuthenticationError>;
