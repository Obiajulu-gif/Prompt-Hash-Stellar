import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

export function MarkdownContent({ children, className = "" }: MarkdownContentProps) {
  return (
    <div
      className={[
        "prose prose-invert prose-sm max-w-none",
        "prose-headings:text-slate-100 prose-headings:font-semibold",
        "prose-p:text-slate-300 prose-p:leading-relaxed",
        "prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-slate-100",
        "prose-code:text-emerald-300 prose-code:bg-slate-800/60 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-slate-800/60 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg",
        "prose-blockquote:border-l-emerald-500/50 prose-blockquote:text-slate-400",
        "prose-ul:text-slate-300 prose-ol:text-slate-300",
        "prose-hr:border-white/10",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
