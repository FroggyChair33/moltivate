import { AccountClient } from "./account-client";

// Signed-in only: the proxy redirects to /login without a session. All of the page is client-side account state.
export default function AccountPage() {
  return <AccountClient />;
}
