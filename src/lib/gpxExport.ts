import { Point } from "./shapeMath";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateGPX(points: Point[], routeName: string): string {
  const safeName = escapeXml(routeName.slice(0, 100));
  const now = new Date();
  const trkpts = points
    .filter(p => isFinite(p.lat) && isFinite(p.lng))
    .map((p, i) => {
      const time = new Date(now.getTime() + i * 30000); // 30 seconds apart
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">
        <time>${time.toISOString()}</time>
      </trkpt>`;
    }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Drawn" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
    <time>${now.toISOString()}</time>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadGPX(points: Point[], routeName: string) {
  const gpx = generateGPX(points, routeName);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${routeName.replace(/\s+/g, "_")}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
