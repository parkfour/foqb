import { randomInt } from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/l/I) since this is meant to
// be read aloud, texted, or copied by hand, not just pasted. 16 chars from
// this ~57-character alphabet is ~93 bits of entropy — far past what's
// needed for a password nobody has to memorize.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const LENGTH = 16;

export function generatePassword(): string {
  let password = "";
  for (let i = 0; i < LENGTH; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
