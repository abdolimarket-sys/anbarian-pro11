/**
 * Anbarin Pro — future-ready licensing contracts.
 *
 * This module intentionally does not replace the legacy ANB3 flow. It defines
 * stable contracts for a future server-backed licensing service and can be
 * integrated incrementally without changing existing activation behavior.
 * Client-side cached state is advisory only; a trusted server must validate
 * signatures, subscription state, device seats, revocations and entitlements.
 */

export type LicensePlanId = 'trial' | 'starter' | 'standard' | 'professional' | 'enterprise' | (string & {});
export type LicenseStatus = 'active' | 'trial' | 'grace' | 'expired' | 'revoked' | 'suspended' | 'unactivated' | 'offline-unverified';
export type LicenseFeature =
  | 'inventory.basic'
  | 'inventory.advanced'
  | 'reports.basic'
  | 'reports.advanced'
  | 'import_export.advanced'
  | 'team.sync.live'
  | 'team.sync.offline'
  | 'team.multi_user'
  | 'labels.advanced'
  | 'audit.history'
  | 'support.priority';

export interface LicenseEntitlements {
  features: LicenseFeature[];
  maxDevices: number;
  maxUsers: number;
  maxWarehouses: number;
  maxProducts?: number | null;
}

export interface LicenseLease {
  schemaVersion: 1;
  licenseId: string;
  organizationId: string;
  organizationName: string;
  plan: LicensePlanId;
  status: LicenseStatus;
  issuedAt: string;
  validUntil: string | null;
  /** Last time a trusted server confirmed this lease. */
  serverVerifiedAt: string;
  /** Offline allowance granted by the server, not chosen by the client. */
  offlineGraceUntil: string | null;
  deviceId: string;
  entitlements: LicenseEntitlements;
  /** Opaque server signature/token. Never generated with a client-embedded secret. */
  signedToken: string;
  tokenKeyId?: string;
}

export interface LicenseDevice {
  deviceId: string;
  label: string;
  platform: 'web' | 'android' | 'ios' | 'desktop' | 'unknown';
  activatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string | null;
}

export interface LicenseValidationResult {
  valid: boolean;
  status: LicenseStatus;
  lease?: LicenseLease;
  messageCode?: 'VALID' | 'EXPIRED' | 'REVOKED' | 'DEVICE_LIMIT' | 'DEVICE_REVOKED' | 'OFFLINE_GRACE' | 'NETWORK_UNAVAILABLE' | 'INVALID_TOKEN' | 'ORG_SUSPENDED';
}

/** Implemented by a trusted server adapter (for example Supabase Edge Functions). */
export interface LicenseProvider {
  activate(input: { licenseKey: string; deviceId: string; deviceLabel?: string; platform?: LicenseDevice['platform'] }): Promise<LicenseValidationResult>;
  validate(input: { signedToken: string; deviceId: string }): Promise<LicenseValidationResult>;
  deactivateDevice(input: { licenseId: string; deviceId: string }): Promise<{ success: boolean }>;
  listDevices(input: { licenseId: string }): Promise<LicenseDevice[]>;
  revokeDevice(input: { licenseId: string; deviceId: string }): Promise<{ success: boolean }>;
}

export interface LicenseCacheEnvelope {
  schemaVersion: 1;
  cachedAt: string;
  lease: LicenseLease;
}

export const LICENSE_CACHE_KEY = 'anbarin_license_lease_v1';

/** UI-level feature check only. Server endpoints must enforce entitlements too. */
export function leaseHasFeature(lease: LicenseLease | null | undefined, feature: LicenseFeature): boolean {
  if (!lease || !lease.entitlements?.features?.includes(feature)) return false;
  if (lease.status === 'revoked' || lease.status === 'suspended' || lease.status === 'expired' || lease.status === 'unactivated') return false;
  const now = Date.now();
  if (lease.validUntil && new Date(lease.validUntil).getTime() <= now) {
    if (!lease.offlineGraceUntil || new Date(lease.offlineGraceUntil).getTime() <= now) return false;
  }
  return true;
}

/** A cached lease may be displayed offline but is never proof of paid entitlement. */
export function readCachedLicenseLease(storage: Pick<Storage, 'getItem'> = localStorage): LicenseCacheEnvelope | null {
  try {
    const value = JSON.parse(storage.getItem(LICENSE_CACHE_KEY) || 'null') as LicenseCacheEnvelope | null;
    if (!value || value.schemaVersion !== 1 || !value.lease?.signedToken || !value.lease?.deviceId) return null;
    return value;
  } catch {
    return null;
  }
}

/** Stores only a server-issued lease. The caller must have received it from LicenseProvider. */
export function cacheServerIssuedLease(lease: LicenseLease, storage: Pick<Storage, 'setItem'> = localStorage): void {
  if (!lease || lease.schemaVersion !== 1 || !lease.signedToken || !lease.deviceId || !lease.licenseId) {
    throw new Error('invalid_server_lease');
  }
  const envelope: LicenseCacheEnvelope = { schemaVersion: 1, cachedAt: new Date().toISOString(), lease };
  storage.setItem(LICENSE_CACHE_KEY, JSON.stringify(envelope));
}

export function clearCachedLicenseLease(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  storage.removeItem(LICENSE_CACHE_KEY);
}

/** Never infer server validity from this function; it only classifies the cached time window. */
export function getCachedLeaseDisplayStatus(lease: LicenseLease, now = Date.now()): LicenseStatus {
  if (lease.status === 'revoked' || lease.status === 'suspended') return lease.status;
  if (lease.validUntil && new Date(lease.validUntil).getTime() <= now) {
    if (lease.offlineGraceUntil && new Date(lease.offlineGraceUntil).getTime() > now) return 'grace';
    return 'expired';
  }
  return lease.status === 'active' ? 'offline-unverified' : lease.status;
}
