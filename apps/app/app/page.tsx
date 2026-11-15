import Link from "next/link";
import { CurrentChallengeLink } from "./components/current-challenge-link";
import { JoinChallenge } from "./components/join-challenge";

export default function Home() {
  return <div className="mx-auto w-full max-w-3xl space-y-10 px-5 py-10 sm:px-8">
    <section className="space-y-4">
      <p className="text-sm font-medium text-muted">Your club. Your commitment.</p>
      <h1 className="text-5xl leading-tight sm:text-6xl">Stay<br /><em>Moltivated.</em></h1>
      <p className="max-w-md text-muted">Put your money where your muscles are. Show up for your team, one workout at a time.</p>
      <Link href="/challenges/new" className="inline-flex rounded-full bg-foreground px-6 py-3 font-medium text-background">Create a challenge</Link>
      <p className="text-xs text-muted">Devnet · Test SOL only</p>
    </section>
    <section className="space-y-5" id="your-challenges">
      <h2 className="text-3xl">Your challenges</h2>
      <CurrentChallengeLink />
    </section>
    <JoinChallenge />
    <details className="rounded-2xl border border-line p-5">
      <summary className="cursor-pointer font-medium">Install Moltivate on iPhone</summary>
      <p className="mt-3 text-sm text-muted">In Safari, open Share, choose Add to Home Screen, then tap Add. Keep an internet connection for workouts and wallet transactions.</p>
    </details>
  </div>;
}
