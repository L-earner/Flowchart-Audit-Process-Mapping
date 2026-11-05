// Small stroke icon set (16px grid) so the interface doesn't rely on text
// glyphs like ▲ ✕ ● for controls.
const PATHS: Record<string, string> = {
  undo: "M5.5 4 2.5 7l3 3M3 7h6.5a4 4 0 0 1 0 8H7",
  redo: "M10.5 4l3 3-3 3M13 7H6.5a4 4 0 0 0 0 8H9",
  check: "M3 8.5l3.2 3L13 4.5",
  chevron: "M4 6l4 4 4-4",
  close: "M4 4l8 8M12 4l-8 8",
  plus: "M8 3v10M3 8h10",
  up: "M8 12V4M4.5 7.5 8 4l3.5 3.5",
  down: "M8 4v8M4.5 8.5 8 12l3.5-3.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5",
  fit: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  file: "M4 1.5h5l3 3v10H4zM9 1.5v3h3",
  upload: "M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v3h11v-3",
  download: "M8 2.5v8M5 7.5l3 3 3-3M2.5 10.5v3h11v-3",
  mic: "M8 1.8a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0v-4a2 2 0 0 1 2-2zM4 7.5a4 4 0 0 0 8 0M8 11.5v2.7",
  text: "M3 4h10M3 7h10M3 10h7M3 13h5",
  alert: "M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5v.2",
  flowchart: "M5.5 1.5h5v3h-5zM8 4.5v2.5M5.5 9.5h5v3h-5zM8 7v2.5",
  swimlane: "M1.5 3h13M1.5 8h13M1.5 13h13M4.5 5.5h3M9 10.5h3",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  save: "M3 2.5h8l2.5 2.5v8.5H3zM5.5 2.5v3h4v-3M5.5 13.5v-4h5v4",
  folder: "M1.5 4h4.5l1.5 1.5h7v7.5h-13z",
  map: "M2 4.5h4l2 2.5h6M2 4.5v7h12V7",
  review: "M2.5 4l1.5 1.5L6.5 3M8.5 4.5h5M2.5 9l1.5 1.5L6.5 8M8.5 9.5h5",
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
