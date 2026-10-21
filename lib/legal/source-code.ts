// Where this instance's source code can be downloaded. The AGPL (LICENSE,
// section 13) requires an instance running modified code to offer its users
// that modified source, so a fork points SOURCE_CODE_URL at its own copy.
export const UPSTREAM_SOURCE_CODE_URL: string | null = "https://github.com/parkfour/foqb";

export function getSourceCodeUrl(): string | null {
  return process.env.SOURCE_CODE_URL || UPSTREAM_SOURCE_CODE_URL;
}
