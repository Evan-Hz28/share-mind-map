#!/bin/sh
set -eu

node --input-type=module <<'EOF'
import { createDatabase, migrateDatabase } from "@share-mind-map/database";

const database = createDatabase(process.env.DATABASE_URL);
try {
  await migrateDatabase(database);
} finally {
  await database.$client.end();
}
EOF

exec node dist/main.js
