// Shared between the client (signs this) and the server (verifies it),
// so they can never drift. Including the wallet and the exact name in the
// signed text means a captured signature can only ever (re-)set this one
// name for this one wallet -- replaying it is a harmless no-op, not a way
// to set a different name later.
export function displayNameMessage(wallet: string, displayName: string): string {
  return `Moltivate: set display name to "${displayName}" for ${wallet}`;
}
