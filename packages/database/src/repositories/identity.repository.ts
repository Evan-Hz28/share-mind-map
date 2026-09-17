import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { authIdentities, users, workspaceMemberships, workspaces } from "../schema/index.js";

export interface LocalPrincipal {
  identity: {
    id: string;
    organizationId: string;
    userId: string;
    provider: string;
    providerSubject: string;
    loginName: string | null;
    passwordHash: string | null;
    mustChangePassword: boolean;
    passwordChangedAt: Date | null;
  };
  user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    accountStatus: string;
    lastLoginAt: Date | null;
  };
  membership: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    role: string;
    status: string;
  };
}

export class IdentityRepository {
  public constructor(private readonly database: Database) {}

  public async findLocalBySubject(
    organizationId: string,
    subject: string,
  ): Promise<LocalPrincipal | null> {
    const rows = await this.database
      .select({
        identityId: authIdentities.id,
        identityOrganizationId: authIdentities.organizationId,
        identityUserId: authIdentities.userId,
        provider: authIdentities.provider,
        providerSubject: authIdentities.providerSubject,
        loginName: authIdentities.loginName,
        passwordHash: authIdentities.passwordHash,
        mustChangePassword: authIdentities.mustChangePassword,
        passwordChangedAt: authIdentities.passwordChangedAt,
        userId: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        accountStatus: users.accountStatus,
        lastLoginAt: users.lastLoginAt,
        membershipId: workspaceMemberships.id,
        workspaceId: workspaceMemberships.workspaceId,
        workspaceName: workspaces.name,
        role: workspaceMemberships.role,
        membershipStatus: workspaceMemberships.status,
      })
      .from(authIdentities)
      .innerJoin(users, eq(users.id, authIdentities.userId))
      .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .where(
        and(
          eq(authIdentities.organizationId, organizationId),
          eq(authIdentities.provider, "local"),
          eq(authIdentities.providerSubject, subject.toLowerCase()),
          eq(users.accountStatus, "active"),
          eq(workspaceMemberships.status, "active"),
          eq(workspaces.organizationId, organizationId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      identity: {
        id: row.identityId,
        organizationId: row.identityOrganizationId,
        userId: row.identityUserId,
        provider: row.provider,
        providerSubject: row.providerSubject,
        loginName: row.loginName,
        passwordHash: row.passwordHash,
        mustChangePassword: row.mustChangePassword,
        passwordChangedAt: row.passwordChangedAt,
      },
      user: {
        id: row.userId,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        accountStatus: row.accountStatus,
        lastLoginAt: row.lastLoginAt,
      },
      membership: {
        id: row.membershipId,
        workspaceId: row.workspaceId,
        workspaceName: row.workspaceName,
        role: row.role,
        status: row.membershipStatus,
      },
    };
  }
}
