import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(configDirectory, "config.env") });
