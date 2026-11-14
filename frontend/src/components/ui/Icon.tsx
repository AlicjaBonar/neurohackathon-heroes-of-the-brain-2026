import type { ReactNode } from "react";

const paths = {
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7a5.5 5.5 0 0 0 1-8.9Z" />
  ),
  lungs: (
    <path d="M12 3v9m-2-5c-2 1-3 4-3.3 6.2-.5 3.3-3.6 3.8-4.3 1.2-.9-3.2 1.9-7.1 5.1-9.5C8.7 4 10 5.4 10 7Zm4 0c2 1 3 4 3.3 6.2.5 3.3 3.6 3.8 4.3 1.2.9-3.2-1.9-7.1-5.1-9.5C15.3 4 14 5.4 14 7Z" />
  ),
  wave: <path d="M3 12h3l2.1-6 3.8 12L15 9l2 3h4" />,
  chart: (
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 2 5-6" />
    </>
  ),
  spark: (
    <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Zm7 13 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  arrow: (
    <>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h11" />
    </>
  ),
  activity: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h2l1.4-4 2.2 8 1.4-4h2" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
