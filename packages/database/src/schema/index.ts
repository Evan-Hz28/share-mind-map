export { auditLogs } from "./audit-logs.js";
export { authIdentities } from "./auth-identities.js";
export { documentSnapshots } from "./document-snapshots.js";
export { documents } from "./documents.js";
export { editPermissionRequests } from "./edit-permission-requests.js";
export { folders } from "./folders.js";
export { notificationOutbox, notifications } from "./notifications.js";
export { organizations } from "./organizations.js";
export { users } from "./users.js";
export { workspaceMemberships } from "./workspace-memberships.js";
export { workspaces } from "./workspaces.js";

import { auditLogs } from "./audit-logs.js";
import { authIdentities } from "./auth-identities.js";
import { documentSnapshots } from "./document-snapshots.js";
import { documents } from "./documents.js";
import { editPermissionRequests } from "./edit-permission-requests.js";
import { folders } from "./folders.js";
import { notificationOutbox, notifications } from "./notifications.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workspaceMemberships } from "./workspace-memberships.js";
import { workspaces } from "./workspaces.js";

export const schema = {
  auditLogs,
  authIdentities,
  documentSnapshots,
  documents,
  editPermissionRequests,
  folders,
  notificationOutbox,
  notifications,
  organizations,
  users,
  workspaceMemberships,
  workspaces,
};
