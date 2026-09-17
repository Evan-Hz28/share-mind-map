import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

export function createDatabase(url: string): Database {
  const client = new Pool({ connectionString: url });
  return drizzle(client, { schema });
}
