export type Sex = "F" | "M";
export type HairTexture = "straight" | "wavy" | "curly" | "bald";
export type HairLength = "short" | "long";

/** Everything the user can set on the 3D avatar. */
export interface AvatarConfig {
  sex: Sex;
  texture: HairTexture;
  length: HairLength;
  /** Hair colour as a `#rrggbb` string. */
  color: string;
  /** Body weight in kg – drives the body width. */
  weight: number;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  sex: "F",
  texture: "straight",
  length: "long",
  color: "#5c3821",
  weight: 72,
};

export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "F", label: "Kobieta" },
  { value: "M", label: "Mężczyzna" },
];

export const TEXTURE_OPTIONS: { value: HairTexture; label: string }[] = [
  { value: "straight", label: "Proste" },
  { value: "wavy", label: "Falowane" },
  { value: "curly", label: "Kręcone" },
  { value: "bald", label: "Łysy" },
];

export const LENGTH_OPTIONS: { value: HairLength; label: string }[] = [
  { value: "short", label: "Krótkie" },
  { value: "long", label: "Długie" },
];

export const HAIR_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: "Blond", hex: "#d9b36b" },
  { label: "Brązowe", hex: "#5c3821" },
  { label: "Czarne", hex: "#141212" },
  { label: "Rude", hex: "#b34d21" },
  { label: "Siwe", hex: "#c7c7cc" },
];

export function hairFilename({ texture, length }: Pick<AvatarConfig, "texture" | "length">) {
  return texture === "bald" ? "hair_bald.glb" : `hair_${texture}_${length}.glb`;
}

/** Horizontal body scale derived from weight (≈ the avatar_preview.html mapping). */
export function bodyWidthScale(weight: number) {
  const w = weight > 0 ? weight : DEFAULT_AVATAR.weight;
  return Math.min(1.4, Math.max(0.8, w / 70));
}
