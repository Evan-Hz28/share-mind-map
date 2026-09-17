import { and, eq, sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";

import type { Database } from "../client.js";
import { authIdentities, schema, users, workspaceMemberships } from "../schema/index.js";

export type DatabaseTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface MemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  loginName: string | null;
  accountStatus: string;
  lastLoginAt: Date | null;
  mustChangePassword: boolean | null;
  role: string;
  status: string;
  grantedBy: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

function toMemberRecord(row: {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  loginName: string | null;
  accountStatus: string;
  lastLoginAt: Date | null;
  mustChangePassword: boolean | null;
  role: string;
  status: string;
  grantedBy: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}): MemberRecord {
  return row;
}

export class MemberRepository {
  public constructor(private readonly database: Database) {}

  public async list(workspaceId: string): Promise<MemberRecord[]> {
    const rows = await this.database
      .select({
        id: workspaceMemberships.id,
        workspaceId: workspaceMemberships.workspaceId,
        userId: workspaceMemberships.userId,
        displayName: users.displayName,
        loginName: authIdentities.loginName,
        accountStatus: users.accountStatus,
        lastLoginAt: users.lastLoginAt,
        mustChangePassword: authIdentities.mustChangePassword,
        role: workspaceMemberships.role,
        status: workspaceMemberships.status,
        grantedBy: workspaceMemberships.grantedBy,
        grantedAt: workspaceMemberships.grantedAt,
        revokedAt: workspaceMemberships.revokedAt,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .leftJoin(
        authIdentities,
        and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")),
      )
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
    return rows.map(toMemberRecord);
  }

  public async lockById(
    transaction: DatabaseTransaction,
    membershipId: string,
  ): Promise<MemberRecord | null> {
    const rows = await transaction
      .select({
        id: workspaceMemberships.id,
        workspaceId: workspaceMemberships.workspaceId,
        userId: workspaceMemberships.userId,
        displayName: users.displayName,
        loginName: authIdentities.loginName,
        accountStatus: users.accountStatus,
        lastLoginAt: users.lastLoginAt,
        mustChangePassword: authIdentities.mustChangePassword,
        role: workspaceMemberships.role,
        status: workspaceMemberships.status,
        grantedBy: workspaceMemberships.grantedBy,
        grantedAt: workspaceMemberships.grantedAt,
        revokedAt: workspaceMemberships.revokedAt,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .leftJoin(
        authIdentities,
        and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")),
      )
      .where(eq(workspaceMemberships.id, membershipId))
      .for("update", { of: workspaceMemberships });
    const row = rows[0];
    return row === undefined ? null : toMemberRecord(row);
  }

  public async countActiveAdmins(
    transaction: DatabaseTransaction,
    workspaceId: string,
  ): Promise<number> {
    const rows = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.role, "admin"),
          eq(workspaceMemberships.status, "active"),
        ),
      );
    return rows[0]?.count ?? 0;
  }
}
