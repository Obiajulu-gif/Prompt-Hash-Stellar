# Prompt categories and tags

Prompt listings expose both a single `category` and zero or more `tags` for marketplace discovery.

## Category format

- Required string.
- Maximum length: 40 bytes.
- Use a human-readable marketplace label, such as `Software Development`, `Marketing`, `Education`, or `Design`.
- Category matching in the contract is exact. Clients should normalize category choices before calling `create_prompt` or `get_prompts_by_category`.

## Tag format

- Optional list on `ListingConfig.tags`.
- Maximum of 8 tags per prompt.
- Each tag must be non-empty and no longer than 32 bytes.
- Tags should use lowercase kebab-case, such as `unit-tests`, `copywriting`, or `lesson-plan`.
- Duplicate tags are rejected.

## Discovery methods

- `get_prompts_by_category(category)` returns active, non-expired prompts with an exact category match.
- `get_prompts_by_tag(tag)` returns active, non-expired prompts that contain the exact tag.

## Anti-Plagiarism & Similarity Scanning

To maintain listing quality and protect creators from plagiarism:
- **Pre-publish checks**: When submitting a prompt, the system evaluates its content against existing prompts in the same category using TF-IDF cosine similarity.
- **Blocked**: If a prompt is `highly_similar` (score >= 0.90) to an existing prompt, publication is blocked.
- **Review required**: If a prompt is `suspicious` (score >= 0.70), the creator is warned. If they proceed, the prompt may be flagged for maintainer review or potential restriction (`moderationStatus: restricted`).
- **Override**: Maintainers can reinstate restricted listings via the moderation API if an appeal is granted.
