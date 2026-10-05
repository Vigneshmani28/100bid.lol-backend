import path from "node:path";
import { UPLOADS_DIR_NAME } from "../config/constants";

/**
 * Absolute path to the directory uploaded ad images are written to and
 * served from. Resolved once, relative to the process's working directory
 * (the backend package root when run via `npm run dev`/`start`).
 */
export const UPLOADS_DIR = path.join(process.cwd(), UPLOADS_DIR_NAME);
