import { teamCrest } from "../lib/crest";

interface Props {
  name: string;
  size?: number;
}

export function TeamCrest({ name, size = 40 }: Props) {
  const crest = teamCrest(name);
  const gradId = `crest-grad-${crest.initials}-${size}`;
  return (
    <svg width={size} height={size * (31 / 32)} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={crest.colorA} />
          <stop offset="100%" stopColor={crest.colorB} />
        </linearGradient>
      </defs>
      <path d={crest.shieldPath} fill={`url(#${gradId})`} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
      <text
        x="16"
        y="18"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="#fff"
        fontFamily="Segoe UI, sans-serif"
      >
        {crest.initials}
      </text>
    </svg>
  );
}
