"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { ClubIcon } from "./club-art";

const links = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/coach", label: "Coach", icon: "coach" },
  { href: "/club", label: "Your club", icon: "club" },
  { href: "/challenges/new", label: "Create", icon: "plus" },
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
        const active = pathname === href || (href === "/club" && pathname.startsWith("/challenges/") && pathname !== "/challenges/new");
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}><ClubIcon kind={icon} /><span>{label}</span></Link>;
      })}
    </nav>
  </>;
}
