// Rules of the activation page (Sprint 12B, corrected in the Sprint 12C
// acceptance test). No imports, so it can be tested with `node --test`.

/** The minimum length of the ERP password policy (checked again there) */
export const MIN_PASSWORD_LENGTH = 15;

/**
 * What the address bar holds:
 * token     a complete activation link (#token=<43 characters>)
 * missing   no fragment: e.g. the page was reloaded after it had read and
 *           removed the token, or opened without the link
 * malformed a fragment that is not a complete token (cut-off copy)
 */
export type LinkFragment = { kind: "token"; token: string } | { kind: "missing" } | { kind: "malformed" };

export function parseActivationFragment(hash: string): LinkFragment {
  if (hash === "" || hash === "#") return { kind: "missing" };
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { kind: "token", token: match[1] } : { kind: "malformed" };
}

/** Why "Set password" cannot be used yet, or null when it can */
export function submitBlocker(password: string, confirmation: string): string | null {
  const length = Array.from(password.normalize("NFKC")).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `Enter at least ${MIN_PASSWORD_LENGTH} characters (${length} so far).`;
  }
  if (confirmation === "") return "Repeat the password.";
  if (confirmation !== password) return "The passwords do not match.";
  return null;
}
