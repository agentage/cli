// str_replace + edit-body resolution, mirroring @agentage/memory-core's local-ops verbatim
// (exact + unique match, canonical error strings) so the local CLI stays contract-faithful.

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

// Exact, unique substring replacement. new_str '' deletes the match.
export const strReplace = (body: string, path: string, oldStr: string, newStr: string): string => {
  const starts: number[] = [];
  for (let i = body.indexOf(oldStr); i !== -1; i = body.indexOf(oldStr, i + 1)) starts.push(i);
  if (starts.length === 0)
    throw new Error(
      `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${path}.`
    );
  if (starts.length > 1)
    throw new Error(
      `Multiple occurrences of old_str \`${oldStr}\` in ${path} (lines: ${starts
        .map((s) => lineOf(body, s))
        .join(', ')}). Please ensure it is unique.`
    );
  return body.slice(0, starts[0]) + newStr + body.slice(starts[0]! + oldStr.length);
};

export interface EditOp {
  path: string;
  oldStr?: string;
  newStr?: string;
  body?: string;
  mode?: 'append' | 'replace';
}

// Resolve the new body for an edit. str_replace (old_str present) and a whole-body edit are
// mutually exclusive; a str_replace with no new_str deletes the matched text.
export const resolveEdit = (existing: string, op: EditOp): string => {
  const hasStrReplace = op.oldStr !== undefined;
  const hasBody = op.body !== undefined;
  if (hasStrReplace && hasBody)
    throw new Error('cannot combine a str_replace (--old/--new) with a --body edit');
  if (hasStrReplace) return strReplace(existing, op.path, op.oldStr!, op.newStr ?? '');
  if (!hasBody) throw new Error('edit needs either --old (str_replace) or --body');
  if (op.mode === 'append') return `${existing}${existing.endsWith('\n') ? '' : '\n'}${op.body!}`;
  return op.body!;
};
