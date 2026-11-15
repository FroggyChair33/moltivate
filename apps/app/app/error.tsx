"use client";

import Link from "next/link";

export default function AppError({ reset }: { reset: () => void }) {
  return <section className="mx-auto max-w-lg space-y-4 px-5 py-12">
    <h1 className="text-3xl">Let’s get you back.</h1>
    <p>Something interrupted this page. Try again. If you’re in Phantom’s browser and this keeps happening, open the site in Safari or connect your wallet from a desktop browser.</p>
    <button onClick={reset} className="rounded-full bg-foreground px-6 py-3 text-background">Try again</button>
    <Link href="/" className="block underline">Return home</Link>
  </section>;
}
