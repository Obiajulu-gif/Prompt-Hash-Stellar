import { useRef, useState, KeyboardEvent } from "react";
import { X, Tag } from "lucide-react";

/** Curated suggestion pool drawn from existing categories + common prompt tags. */
export const SUGGESTED_TAGS: string[] = [
  "Software Development",
  "Marketing",
  "Sales",
  "Customer Support",
  "Finance",
  "Product Management",
  "User Experience",
  "Recruitment",
  "Operations",
  "Public Relations",
  "copywriting",
  "summarisation",
  "code review",
  "brainstorming",
  "email",
  "social media",
  "SEO",
  "data analysis",
  "chatbot",
  "creative writing",
  "translation",
  "research",
  "automation",
  "debugging",
  "documentation",
];

export const MAX_TAGS = 8;

interface TagInputProps {
  value: string[];
  onChange: (_tags: string[]) => void;
  /** Override the suggestion pool. Defaults to SUGGESTED_TAGS. */
  suggestions?: string[];
  placeholder?: string;
  className?: string;
}

export function TagInput({
  value,
  onChange,
  suggestions = SUGGESTED_TAGS,
  placeholder = "Add a tag…",
  className = "",
}: TagInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const normalise = (s: string) => s.trim().toLowerCase();

  const isDuplicate = (tag: string) =>
    value.some((t) => normalise(t) === normalise(tag));

  const filteredSuggestions = inputValue.trim()
    ? suggestions.filter(
        (s) =>
          normalise(s).includes(normalise(inputValue)) &&
          !isDuplicate(s),
      )
    : suggestions.filter((s) => !isDuplicate(s)).slice(0, 8);

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;

    if (value.length >= MAX_TAGS) {
      setValidationMessage(`Maximum ${MAX_TAGS} tags allowed.`);
      return;
    }
    if (isDuplicate(tag)) {
      setValidationMessage(`"${tag}" is already added.`);
      return;
    }

    setValidationMessage(null);
    onChange([...value, tag]);
    setInputValue("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    setValidationMessage(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      removeTag(value.length - 1);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Tag pills + input */}
      <div
        className={`flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring ${
          validationMessage
            ? "border-amber-500/60 focus-within:ring-amber-500/50"
            : "border-input bg-transparent focus-within:ring-emerald-500/40"
        } bg-white/5`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
              className="ml-0.5 rounded-full text-emerald-400/60 transition hover:text-emerald-200"
              aria-label={`Remove tag ${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setValidationMessage(null);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Delay to allow suggestion click to register
            setTimeout(() => setShowSuggestions(false), 150);
          }}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={value.length >= MAX_TAGS}
          className="min-w-[120px] flex-1 border-none bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Tag input"
          autoComplete="off"
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && value.length < MAX_TAGS && (
        <div className="relative z-20">
          <div className="absolute top-0 left-0 right-0 rounded-lg border border-white/10 bg-slate-900 shadow-xl">
            <p className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              <Tag className="h-3 w-3" />
              Suggestions
            </p>
            <ul className="max-h-48 overflow-y-auto py-1" role="listbox">
              {filteredSuggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Prevent blur before click
                      e.preventDefault();
                      addTag(suggestion);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                    role="option"
                    aria-selected={false}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Counter + validation */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={validationMessage ? "text-amber-400" : "text-slate-500"}
        >
          {validationMessage ?? "Press Enter or comma to add a custom tag."}
        </span>
        <span className={value.length >= MAX_TAGS ? "text-amber-400" : "text-slate-500"}>
          {value.length}/{MAX_TAGS}
        </span>
      </div>
    </div>
  );
}
