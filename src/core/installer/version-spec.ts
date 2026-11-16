import { isRange } from '../semver-range.js';

// A dist-tag is a word: a letter first, then letters, digits, `.`, `_` or `-` (never a flag).
export const DIST_TAG = /^[A-Za-z][\w.-]*$/;

// What may follow `<id>@`: a version, a range or a dist-tag; never a path, URL, git or file spec.
export const isVersionSpec = (spec: string): boolean =>
  !/\s/.test(spec) && (isRange(spec) || DIST_TAG.test(spec));
