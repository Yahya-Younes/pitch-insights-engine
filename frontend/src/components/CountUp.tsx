import { useTweenedNumbers } from "../hooks/useTweenedNumbers";

// A number as the i18n helpers print it: digits, optional decimal part
// ("92", "0.42", "4,5"). Thousands separators are not merged, which is fine
// for the short figures this animates.
const NUMBER = /\d+(?:[.,]\d+)?/g;

interface Part {
  start: number;
  end: number;
  value: number;
  decimals: number;
  comma: boolean;
}

function parse(text: string): Part[] {
  return [...text.matchAll(NUMBER)].map((m) => {
    const raw = m[0];
    const comma = raw.includes(",");
    return {
      start: m.index ?? 0,
      end: (m.index ?? 0) + raw.length,
      value: Number(raw.replace(",", ".")),
      decimals: raw.split(/[.,]/)[1]?.length ?? 0,
      comma,
    };
  });
}

/** Already-formatted text ("92 %", "8/8", "1.4k") whose numbers count up to
 * their value and then glide on each update. Screen readers get the final
 * text right away. */
export function CountUpText({ text, durationMs = 900 }: { text: string; durationMs?: number }) {
  const parts = parse(text);
  const shown = useTweenedNumbers(parts.map((p) => p.value), durationMs, text.replace(NUMBER, "#"));
  if (parts.length === 0) return <>{text}</>;

  let out = "";
  let cursor = 0;
  parts.forEach((p, i) => {
    const n = (shown[i] ?? p.value).toFixed(p.decimals);
    out += text.slice(cursor, p.start) + (p.comma ? n.replace(".", ",") : n);
    cursor = p.end;
  });
  out += text.slice(cursor);

  return (
    <>
      <span aria-hidden="true">{out}</span>
      <span className="ui-sr-only">{text}</span>
    </>
  );
}
