/**
 * Prompt building for zero-shot tagging, from the POC (src/prompts.mjs):
 * every tag is scored as its bare name, "a photo of the tag", plus any
 * description the user wrote; the tag's score is the maximum cosine across
 * that set. SigLIP2's 64-token text context truncates longer ensembles, so
 * descriptions much over ~60 characters warn but are never rejected.
 */

export interface TagPrompt {
  tag: string;
  prompts: string[];
}

const PROMPT_LENGTH_WARNING = 60;

export function buildTagPrompt(tag: string, descriptions: string[] | undefined): TagPrompt {
  const prompts = [tag, `a photo of ${tag}`];
  for (const description of descriptions ?? []) {
    if (description.length > PROMPT_LENGTH_WARNING) {
      // Names and descriptions are user input: warn and truncate the score
      // row rather than reject, matching the classifier's tolerance.
      console.warn(
        `Description for tag '${tag}' is longer than ${PROMPT_LENGTH_WARNING} characters and may be truncated by the context window: ${description}`,
      );
    }
    prompts.push(description);
  }
  return { tag, prompts };
}

/**
 * Flattens per-tag prompt sets into the canonical, tag-grouped prompt list:
 * all of a tag's prompts are adjacent, so text embeddings can be sliced back
 * into per-tag rows without searching.
 */
export function buildPromptTable(tags: string[], descriptionsFor: (tag: string) => string[] | undefined): TagPrompt[] {
  return tags.map((tag) => buildTagPrompt(tag, descriptionsFor(tag)));
}
