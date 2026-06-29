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
