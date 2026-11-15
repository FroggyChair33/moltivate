// Same small-caps-label-plus-dot pattern as the apps/web marketing site's
// .eyebrow (e.g. "A LITTLE COMMITMENT. A STRONGER YOU."), reused as a
// lightweight section label across the functional app's pages.
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#5f9165]" />
      {children}
    </p>
  );
}
