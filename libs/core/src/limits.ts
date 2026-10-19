/**
 * How many team workspaces one account may own. Keeps a script from filling
 * the shared database with workspaces; personal workspaces don't count.
 */
export const OWNED_WORKSPACE_LIMIT = 10;

/** The longest workspace name, in characters. */
export const WORKSPACE_NAME_MAX = 60;
