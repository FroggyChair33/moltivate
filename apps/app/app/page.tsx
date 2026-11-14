import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">
          Put your money where your muscles are.
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Stay Moltivated. Stake devnet SOL, form two teams, and keep your
          commitment.
        </p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/challenges/new"
          className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Create a challenge
        </Link>
        <Link
          href="/challenges/demo"
          className="rounded-full border border-black/10 px-6 py-3 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
        >
          View demo scoreboard
        </Link>
      </div>
    </div>
  );
}
