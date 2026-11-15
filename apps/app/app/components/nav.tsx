import Link from "next/link";
import { WalletButton } from "./wallet-button";

export function Nav() {
  return (
    <header className="flex items-center justify-between border-b border-black/10 px-6 py-4 dark:border-white/10">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Moltivate
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/challenges/new" className="hover:underline">
          Create
        </Link>
        <WalletButton />
      </nav>
    </header>
  );
}
