import Link from "next/link";
import { CoachMark, Polaroid } from "../components/club-art";
import { CurrentChallengeLink } from "../components/current-challenge-link";

export default function CoachPage() {
  return <div className="app-page">
    <header className="page-heading"><p className="kicker">Your workout, with company</p><h1>You bring the effort.<br /><em>We’ll bring the nudge.</em></h1><p className="page-intro">A little encouragement to keep showing up.</p></header>
    <div className="coach-layout"><section className="coach-room"><div className="section-topline"><span className="tag tag-light">Camera setup</span><span className="coach-state">Runs in your browser</span></div><div className="coach-portrait"><CoachMark /><h2>Hey, you.<br />Let’s make it count.</h2><p>Space to move. A phone or laptop camera. You.<br />That’s a pretty good start.</p></div><div className="coach-bubble">“Good light, whole body in frame, stand side-on. We’ll count one rep at a time.”<span>Video stays on your device. Only the count is sent.</span></div><div className="coach-call-footer"><span className="call-symbol" aria-hidden="true">↗</span><p>Open a challenge you’ve joined to start the camera.</p></div></section>
    <div className="coach-sidebar"><section className="paper-panel"><p className="kicker">Your pre-workout ritual</p><h2>A little room<br />to move.</h2><ol className="prep-list"><li><span>01</span><div><strong>Find your frame</strong><p>Prop your phone up. Make sure your whole body fits in view.</p></div></li><li><span>02</span><div><strong>Start with squats</strong><p>Stand sideways in good light, with enough space around you.</p></div></li><li><span>03</span><div><strong>Choose your challenge</strong><p>Open an active challenge to start the browser camera session.</p></div></li></ol><Link href="#choose-challenge" className="button-primary">Find my workout <span aria-hidden="true">↓</span></Link></section><Polaroid src="/photos/jump-rope.jpg" alt="A monkey in sweatpants skipping rope in a gym" caption="your little workout corner" tilt={3} /></div></div>
    <blockquote className="motivation">“A little stronger. A little more you. Every day.”</blockquote>
    <section id="choose-challenge" className="paper-panel"><p className="kicker">Make it yours</p><h2>Which commitment<br />are we showing up for?</h2><p className="panel-description">Browser squat counting is available inside an active challenge you’ve joined. Counts are experimental and are not payout verification.</p><CurrentChallengeLink /></section>
  </div>;
}
