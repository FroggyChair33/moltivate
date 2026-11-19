// A small rotated paper slip summarizing a challenge before you join it.
export function CommitmentSlip({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="w-fit -rotate-1 rounded-lg border border-black/10 bg-background px-5 py-4 shadow-[3px_5px_0_rgba(23,62,44,0.08)]">
      <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{label}</span>
      <strong className="mt-1 block font-serif text-xl leading-tight font-semibold text-foreground">{value}</strong>
      <span className="mt-1 block text-xs text-muted">{detail}</span>
    </div>
  );
}
