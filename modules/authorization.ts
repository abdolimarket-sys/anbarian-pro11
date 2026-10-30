/**
 * Future-ready authorization contracts for Anbarin Pro.
 *
 * IMPORTANT: this module is a contract/scaffold only. It does not authenticate users
 * and must not be treated as a security boundary. Current role selection remains
 * local-device configuration until a trusted server provider is connected.
 */
import type { AppSettings } from '@/types';

export type AppRole = 'admin' | 'counter' | 'viewer';
export type Permission =
  | 'inventory.read'
  | 'inventory.count'
  | 'inventory.edit'
  | 'inventory.import'
  | 'inventory.export'
  | 'session.start'
  | 'session.close'
  | 'team.sync'
  | 'users.manage'
  | 'roles.assign'
  | 'audit.read'
  | 'audit.clear'
  | 'license.manage'
  | 'settings.manage';

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  role: AppRole;
  organizationId: string;
  warehouseIds: string[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: string;
}

/** Provider contract to implement when a real backend/auth service is selected. */
export interface AuthorizationProvider {
  getCurrentUser(): Promise<AuthenticatedUser | null>;
  authorize(permission: Permission, resource?: { warehouseId?: string; sessionId?: string }): Promise<AuthorizationDecision>;
  signIn?(credentials: unknown): Promise<AuthenticatedUser>;
  signOut?(): Promise<void>;
}

const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    'inventory.read', 'inventory.count', 'inventory.edit', 'inventory.import', 'inventory.export',
    'session.start', 'session.close', 'team.sync', 'users.manage', 'roles.assign', 'audit.read',
    'audit.clear', 'license.manage', 'settings.manage',
  ]),
  counter: new Set<Permission>([
    'inventory.read', 'inventory.count', 'inventory.export', 'session.start', 'session.close', 'team.sync', 'audit.read',
  ]),
  viewer: new Set<Permission>(['inventory.read', 'inventory.export', 'audit.read']),
};

/** UI convenience only; a server must repeat every authorization check. */
export function roleAllows(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Maps the current local role to the future permission model without changing current app behavior. */
export function currentLocalRole(settings: Pick<AppSettings, 'role'>): AppRole {
  return settings.role === 'counter' || settings.role === 'viewer' ? settings.role : 'admin';
}

export function isKnownPermission(value: string): value is Permission {
  return [
    'inventory.read', 'inventory.count', 'inventory.edit', 'inventory.import', 'inventory.export',
    'session.start', 'session.close', 'team.sync', 'users.manage', 'roles.assign', 'audit.read',
    'audit.clear', 'license.manage', 'settings.manage',
  ].includes(value);
}
