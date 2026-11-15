// CSS animates changes to actual values. No timers or invented totals.
export function RollingNumber({ value }: { value: number }) {
  const label = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return <span className="rolling-number"><span className="sr-only">{label}</span><span className="rolling-visual" aria-hidden="true">{Array.from(label).map((char, index) => /\d/.test(char)
    ? <span className="rolling-place" key={label.length - index}><span className="rolling-strip" style={{ transform: `translateY(-${Number(char) * 10}%)` }}>{Array.from({ length: 10 }, (_, digit) => <span key={digit}>{digit}</span>)}</span></span>
    : <span key={label.length - index}>{char}</span>)}</span></span>;
}
