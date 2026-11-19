export function ClubIcon({ kind, className = "" }: { kind: "club" | "plus"; className?: string }) {
  const paths = {
    club: "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-6-3h4",
    plus: "M12 5v14M5 12h14",
  };
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

export function CoachMark() {
  return <span className="coach-mark" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="M14 40c0-19 9-29 26-29s26 10 26 29-9 28-26 28S14 59 14 40Z" fill="currentColor" /><path d="M29 35v5m22-5v5m-22 9c6 7 16 7 22 0" stroke="#173e2c" strokeWidth="3.5" strokeLinecap="round" /><path d="m9 19-4-3m66 3 4-3M40 4V1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>;
}
