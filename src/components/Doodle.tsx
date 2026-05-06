import { RoutePoint } from "@/lib/strava";

interface DoodleProps {
  route: RoutePoint[];
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  pad?: number;
}

// Renders a GPS polyline as a normalized doodle that fills a uniform square cell.
// Each route is scaled to fit its bounding box into the unit square, regardless of distance —
// so a 1mi loop and a 20mi run both render at the same on-screen size, just with different shape complexity.
export function Doodle({
  route,
  size = 100,
  stroke = "#111",
  strokeWidth = 1.5,
  pad = 8,
}: DoodleProps) {
  if (!route || route.length < 2) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r="1.5" fill={stroke} opacity="0.3" />
      </svg>
    );
  }

  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const rangeLat = maxLat - minLat || 1;
  const rangeLng = maxLng - minLng || 1;
  // Use the larger range so the doodle fits in the square without distortion
  const range = Math.max(rangeLat, rangeLng);
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;

  const inner = size - 2 * pad;
  // Project to square, centered, preserving aspect
  const sx = (lng: number) => pad + ((lng - cx) / range) * inner + inner / 2;
  // Note: SVG y is flipped relative to lat
  const sy = (lat: number) => pad + ((cy - lat) / range) * inner + inner / 2;

  const d = route
    .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.lng).toFixed(2)} ${sy(p.lat).toFixed(2)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
