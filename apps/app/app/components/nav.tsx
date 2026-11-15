import Link from "next/link";
import { WalletButton } from "./wallet-button";
import { DisplayNameEditor } from "./display-name-editor";

export function Nav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Moltivate
      </Link>
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/challenges/new" className="hover:underline">
          Create
        </Link>
        <Link href="/#your-challenges" className="hover:underline">Your challenges</Link>
        <DisplayNameEditor />
        <WalletButton />
      </nav>
    </header>
  );
}
