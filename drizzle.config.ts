import * as dotenv from "dotenv";

import type { Config } from "drizzle-kit";

dotenv.config();

export default {
  schema: "./server/db/schemas/*.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL as string,
  },
} satisfies Config;
