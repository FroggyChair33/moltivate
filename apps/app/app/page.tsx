import { CurrentChallengeLink } from "./components/current-challenge-link";
import { DisplayNameEditor } from "./components/display-name-editor";
import { JoinChallenge } from "./components/join-challenge";

// The app's one dashboard: your challenges, your name, and joining by invite.
// Creating a challenge lives in the nav only.
export default function Home() {
  return <div className="app-page flex flex-col gap-10">
    <header>
      <p className="kicker">Put your money where your muscles are.</p>
      <h1>Your challenges</h1>
      <DisplayNameEditor />
    </header>
    <CurrentChallengeLink />
    <JoinChallenge />
    <p className="page-footnote">Devnet · Test SOL only. Live progress is unverified until settled.</p>
  </div>;
}
