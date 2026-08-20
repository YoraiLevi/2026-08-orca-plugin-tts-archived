/**
 * Speech text normalizer.
 *
 * Turns an agent's markdown reply into text that sounds right when spoken.
 * Pure, synchronous, and DEPENDENCY-FREE — this module imports nothing, not even `node:`
 * builtins, so it runs identically in a plugin worker, a panel, a service, and a test.
 *
 * Stage order is load-bearing. Block constructs (fences, headings, lists, tables) are handled
 * while line structure still exists; whitespace is collapsed last.
 *
 * Ported from block/buzz `preprocess_for_tts` (docs/.research/prior-art-buzz.md), plus the four
 * constructs buzz does not handle: headings, lists, tables, file paths.
 */
export type CodeBlockPolicy = 'announce' | 'drop';
export type PathStyle = 'basename' | 'verbatim';
export interface NormalizeOptions {
    /** Fenced code: announce as "code block omitted", or drop silently. Default 'announce'. */
    codeBlocks?: CodeBlockPolicy;
    /** Paths: speak `src/a/b.ts` as "b.ts in src/a", or verbatim. Default 'basename'. */
    pathStyle?: PathStyle;
    /** Expand integers and clock times to words. Default true. */
    expandNumbers?: boolean;
}
export declare function normalize(md: string, opts?: NormalizeOptions): string;
/** 0..999999 to words. Larger numbers are left for the engine, which handles them better. */
export declare function numberToWords(n: number): string;
