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

const HAIR_COLOR_BY_NAME: Record<string, string> = {
  grey: "#c7c7cc",
  gray: "#c7c7cc",
  blonde: "#d9b36b",
  brown: "#5c3821",
  black: "#141212",
  red: "#b34d21",
};

/** What the backend stores about a user's avatar (`hair_color` may be a hex or a name like "blonde"/"none"). */
export type StoredAvatar = {
  hair_color?: string | null;
  hair_texture?: string | null;
  hair_length?: string | null;
} | null;

/** Builds the 3D avatar config from a saved/demo user profile. */
export function avatarFromUser(user: {
  sex?: Sex | null;
  weight_kg?: number | null;
  avatar?: StoredAvatar;
}): AvatarConfig {
  const sex = user.sex ?? DEFAULT_AVATAR.sex;
  const stored = user.avatar;
  const hair = stored?.hair_color ?? undefined;
  const textures: HairTexture[] = ["straight", "wavy", "curly", "bald"];
  const storedTexture = textures.find((t) => t === stored?.hair_texture);
  const bald = hair === "none" || storedTexture === "bald";
  return {
    sex,
    texture: bald ? "bald" : (storedTexture ?? DEFAULT_AVATAR.texture),
    length: stored?.hair_length === "short" || stored?.hair_length === "long"
      ? stored.hair_length
      : sex === "F" ? "long" : "short",
    color: hair?.startsWith("#") ? hair : (hair && HAIR_COLOR_BY_NAME[hair]) || DEFAULT_AVATAR.color,
    weight: user.weight_kg ? Math.round(user.weight_kg) : DEFAULT_AVATAR.weight,
  };
}

/** Avatar payload to save with a user profile. */
export function avatarToStored(avatar: AvatarConfig): NonNullable<StoredAvatar> {
  return {
    hair_color: avatar.texture === "bald" ? "none" : avatar.color,
    hair_texture: avatar.texture,
    hair_length: avatar.length,
  };
}
