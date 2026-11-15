import Link from "next/link";
import { Eyebrow } from "./components/eyebrow";

const steps = [
  {
    n: "01",
    title: "Find your people.",
    text: "Bring a friend. Make a team. Turn “we should go to the gym” into an actual plan.",
  },
  {
    n: "02",
    title: "Put a little on the line.",
    text: "Pick a shared goal and agree on the stakes. Clear rules, a little skin in the game.",
  },
  {
    n: "03",
    title: "Show up. Level up.",
    text: "Record your workout. Count your contribution. Celebrate a commitment you actually kept.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background px-6 py-24">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <Eyebrow>A little commitment. A stronger you.</Eyebrow>
          <h1 className="text-4xl font-semibold tracking-tight">
            Put your money where your muscles are.
          </h1>
          <p className="text-lg text-muted">
            Stay Moltivated. Stake devnet SOL, form two teams, and keep your
            commitment.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/challenges/new"
            className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Create a challenge
          </Link>
        </div>
      </div>

      <div className="mx-auto mt-20 grid w-full max-w-3xl gap-10 sm:grid-cols-3">
        {steps.map((step) => (
          <div key={step.n}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xs font-bold text-accent">{step.n}</span>
              <h3 className="text-xl font-semibold">{step.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
