import Link from "next/link";
import { CurrentChallengeLink } from "./components/current-challenge-link";
import { JoinChallenge } from "./components/join-challenge";
import { ClubIcon, CoachMark, Polaroid } from "./components/club-art";

export default function Home() {
  return <div className="app-page home-page">
    <section className="home-hero">
      <div>
        <p className="kicker"><span className="status-dot" /> A little effort. A lot of good company.</p>
        <h1>Show up.<br />Stay <em>Moltivated.</em></h1>
        <p className="page-intro">Put your money where your muscles are. Make a pact with your people, and turn “tomorrow” into today.</p>
        <div className="action-row"><Link href="/challenges/new" className="button-primary">Make a commitment <ClubIcon kind="arrow" /></Link><Link href="/coach" className="text-link">Meet your coach ↗</Link></div>
        <span className="hand-note">better together. always.</span>
      </div>
      <div className="hero-photos"><span className="photo-sun" /><Polaroid caption="the showing-up club" /><Polaroid caption="one more? you got this." tone="sage" tilt={7} /></div>
    </section>
    <div className="club-ribbon"><span>SMALL WINS, SHARED.</span><span aria-hidden="true">✳</span><span>PUT YOUR MONEY WHERE YOUR MUSCLES ARE.</span><span aria-hidden="true">✳</span><span>STAY MOLTIVATED.</span></div>
    <section className="home-grid">
      <Link href="/coach" className="coach-teaser"><div className="section-topline"><span className="kicker">In your corner</span><ClubIcon kind="arrow" /></div><CoachMark /><h2>A little nudge.<br />One more rep.</h2><p>Meet your AI workout coach and get ready for your next set.</p><span className="tag tag-light">Explore coaching ↗</span></Link>
      <div id="your-challenges" className="paper-panel"><div className="section-topline"><p className="kicker">The commitments</p><ClubIcon kind="club" /></div><h2>Your people.<br /><em>Your progress.</em></h2><CurrentChallengeLink /><Link href="/club" className="text-link">Open your club ↗</Link></div>
    </section>
    <blockquote className="motivation">“You don’t need a perfect day. Just a little start.”</blockquote>
    <section className="home-grid"><JoinChallenge /><details className="paper-panel install-note"><summary>Keep your club close <span aria-hidden="true">+</span></summary><p>On iPhone, open this app in Safari, tap Share, then Add to Home Screen. Keep an internet connection for workouts and wallet transactions.</p><span className="hand-note">a home for your good habits.</span></details></section>
    <p className="page-footnote">Made for showing up. Devnet demo · Test SOL only.</p>
  </div>;
}
