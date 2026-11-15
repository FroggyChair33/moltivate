import type { CSSProperties } from "react";

export function ClubIcon({ kind, className = "" }: { kind: "home" | "coach" | "club" | "plus" | "arrow"; className?: string }) {
  const paths = {
    home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
    coach: "M14 8h-9a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm2 4 5-3v10l-5-3M7 3h5",
    club: "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-6-3h4",
    plus: "M12 5v14M5 12h14", arrow: "M4 12h16m-6-6 6 6-6 6",
  };
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export function Polaroid({ caption, tone = "peach", tilt = -4 }: { caption: string; tone?: "peach" | "sage"; tilt?: number }) {
  return <figure className={`polaroid polaroid-${tone}`} style={{ "--tilt": `${tilt}deg` } as CSSProperties}>
    <div className="polaroid-photo"><svg width="78" height="78" viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="m20 28 9-12 8 6-9 12m15 12 9-12 8 6-9 12M29 28l23 17M15 24l18 13m14-5 18 13" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /><path d="m58 12 3 5m7 4 4-1M12 53l-3 5m14 1 1 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>Your photo goes here</span></div>
    <figcaption>{caption}</figcaption>
  </figure>;
}

export function CoachMark() {
  return <span className="coach-mark" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="M14 40c0-19 9-29 26-29s26 10 26 29-9 28-26 28S14 59 14 40Z" fill="currentColor" /><path d="M29 35v5m22-5v5m-22 9c6 7 16 7 22 0" stroke="#173e2c" strokeWidth="3.5" strokeLinecap="round" /><path d="m9 19-4-3m66 3 4-3M40 4V1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>;
}
