// Raw upload cap — base64 inflates this ~33%, so 300KB raw stays well
// under the DB column's 500,000-character CHECK constraint.
export const MAX_LOGO_BYTES = 300 * 1024;
