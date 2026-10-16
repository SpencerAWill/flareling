// The redaction helpers stay internal (log.ts uses them) until an app needs
// one; knip reports unused lib exports. Their tests import ./redact.ts
// directly, which also keeps them runnable in Stryker's plain-Node project.
export { errorMessage, log, runWithLogContext } from "./log.ts";
