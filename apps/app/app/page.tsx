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

const ethos = ["less scrolling", "more showing up", "stronger together", "stay moltivated"];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <div className="relative overflow-hidden px-6 py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[radial-gradient(ellipse_at_center,#f0d57b_0%,transparent_70%)] opacity-60 blur-2xl"
        />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
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
          <div className="relative flex flex-col gap-4 sm:flex-row">
            <Link
              href="/challenges/new"
              className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
            >
              Create a challenge
            </Link>
            <span
              aria-hidden="true"
              className="absolute top-full left-1/2 mt-2 -translate-x-1/3 rotate-[-6deg] whitespace-nowrap font-hand text-lg text-accent sm:top-1/2 sm:left-full sm:mt-0 sm:ml-3 sm:-translate-y-1/2 sm:translate-x-0"
            >
              free to try, devnet only
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-3xl px-6">
        <div className="grid gap-10 sm:grid-cols-3">
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

      <div
        role="group"
        aria-label="Less scrolling. More showing up. Stronger together. Stay Moltivated."
        className="mt-20 overflow-hidden bg-foreground py-5 text-background"
      >
        <div className="marquee-track flex w-max items-center gap-12" aria-hidden="true">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-12">
              {ethos.map((phrase) => (
                <span key={phrase} className="flex items-center gap-12 font-serif text-xl font-medium">
                  {phrase}
                  <b className="text-accent-soft">&#x2733;</b>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
