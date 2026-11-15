import Link from "next/link";
import { CurrentChallengeLink } from "../components/current-challenge-link";
import { DisplayNameEditor } from "../components/display-name-editor";
import { JoinChallenge } from "../components/join-challenge";
import { ClubIcon, Polaroid } from "../components/club-art";

export default function ClubPage() {
  return <div className="app-page">
    <header className="page-heading"><p className="kicker">The showing-up club</p><h1>Good company.<br /><em>Better habits.</em></h1><p className="page-intro">Your teams, your commitments, and every little win along the way.</p><DisplayNameEditor /></header>
    <div className="club-layout"><section className="paper-panel"><div className="section-topline"><h2>Your challenges</h2><span className="tag">Devnet</span></div><p className="panel-description">Open a challenge for its updating leaderboard, workout session, and results.</p><CurrentChallengeLink /><Link className="button-primary" href="/challenges/new">Start something together <ClubIcon kind="plus" /></Link></section><aside className="club-photo"><Polaroid src="/photos/gym-team.jpg" alt="A colourful team of costumed characters training together" position="center 20%" caption="leave room for your team." tone="sage" tilt={4} /></aside></div>
    <blockquote className="motivation">“You don’t have to go far. Just go together.”</blockquote>
    <JoinChallenge /><p className="page-footnote">Live challenge progress is experimental until settled. Test SOL only.</p>
  </div>;
}
