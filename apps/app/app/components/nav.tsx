"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { ClubIcon } from "./club-art";

const links = [
  { href: "/", label: "Challenges", icon: "list" },
  { href: "/challenges/new", label: "New challenge", icon: "plus" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return <>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="app-header">
      <Link href="/" className="brand-wordmark" aria-label="Moltivate home">moltivate<span>.</span></Link>
      <span className="network-label"><i /> Devnet · Test SOL</span>
      <WalletButton />
    </header>
    <nav aria-label="Main navigation" className="app-nav">
      {links.map(({ href, label, icon }) => {
        // Challenge, results and join pages all belong under "Challenges".
        const active = href === "/" ? pathname !== "/challenges/new" : pathname === href;
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}><ClubIcon kind={icon} /><span>{label}</span></Link>;
      })}
    </nav>
  </>;
}
