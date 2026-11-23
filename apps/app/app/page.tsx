import { CurrentChallengeLink } from "./components/current-challenge-link";
import { JoinChallenge } from "./components/join-challenge";

// The app's one dashboard: your challenges and joining by invite.
// Creating a challenge lives in the nav only.
export default function Home() {
  return <div className="app-page flex flex-col gap-10">
    <header>
      <p className="kicker">Put your money where your muscles are.</p>
      <h1>Your challenges</h1>
    </header>
    <CurrentChallengeLink />
    <JoinChallenge />
    <p className="page-footnote">Devnet · Test SOL only. Live progress is unverified until settled.</p>
  </div>;
}
