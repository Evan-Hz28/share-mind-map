export { auditLogs } from "./audit-logs.js";
export { authIdentities } from "./auth-identities.js";
export { organizations } from "./organizations.js";
export { users } from "./users.js";
export { workspaceMemberships } from "./workspace-memberships.js";
export { workspaces } from "./workspaces.js";

import { auditLogs } from "./audit-logs.js";
import { authIdentities } from "./auth-identities.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workspaceMemberships } from "./workspace-memberships.js";
import { workspaces } from "./workspaces.js";

export const schema = {
  auditLogs,
  authIdentities,
  organizations,
  users,
  workspaceMemberships,
  workspaces,
};
