import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Apedia: learn anything, your way, for your reasons";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card shown when a link to Apedia is shared: the Ape and the headline. */
export default async function Image() {
  const mascot = await readFile(join(process.cwd(), "public/ape-mascot.png"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: 80,
          background: "#fbfaf6",
          color: "#1e1e1e",
        }}
      >
        <img
          src={`data:image/png;base64,${mascot.toString("base64")}`}
          width={320}
          height={320}
          style={{ borderRadius: "50%" }}
          alt=""
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
          <div style={{ fontSize: 44, color: "#5b5b5b" }}>Apedia</div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
            Learn anything, your way, for your reasons.
          </div>
          <div style={{ fontSize: 32, color: "#3d3d3d" }}>
            Short Lessons, real sources, a teacher for anything.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
