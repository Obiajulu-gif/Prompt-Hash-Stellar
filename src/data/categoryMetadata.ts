export interface CategoryMeta {
  name: string;
  slug: string;
  description: string;
  count?: number;
}

export const categoryMetadata: Record<string, CategoryMeta> = {
  "Software Development": {
    name: "Software Development",
    slug: "software-development",
    description:
      "Prompts for architects, engineers, and developers to streamline coding, architecture review, and technical planning workflows.",
  },
  Marketing: {
    name: "Marketing",
    slug: "marketing",
    description:
      "Campaign strategies, copywriting frameworks, and multi-channel launch templates for marketing professionals.",
  },
  Sales: {
    name: "Sales",
    slug: "sales",
    description:
      "Discovery call scripts, objection handling, and closing sequences crafted for high-performance sales teams.",
  },
  "Customer Support": {
    name: "Customer Support",
    slug: "customer-support",
    description:
      "Escalation recovery scripts, troubleshooting sequences, and empathy-driven support templates.",
  },
  Finance: {
    name: "Finance",
    slug: "finance",
    description:
      "Financial scenario planning, budgeting memos, and decision-oriented analysis prompts for finance teams.",
  },
  "Product Management": {
    name: "Product Management",
    slug: "product-management",
    description:
      "PRD templates, launch checklists, and product strategy prompts for effective product management.",
  },
  "User Experience": {
    name: "User Experience",
    slug: "user-experience",
    description:
      "UX research synthesis, design critiques, and user testing frameworks for experience designers.",
  },
  Recruitment: {
    name: "Recruitment",
    slug: "recruitment",
    description:
      "Structured hiring scorecards, interview loops, and calibrated feedback prompts for recruiting teams.",
  },
  Operations: {
    name: "Operations",
    slug: "operations",
    description:
      "Playbook generators, process documentation, and workflow optimization prompts for operations managers.",
  },
  "Public Relations": {
    name: "Public Relations",
    slug: "public-relations",
    description:
      "Crisis communication briefs, media response plans, and stakeholder messaging templates for PR professionals.",
  },
  Development: {
    name: "Development",
    slug: "development",
    description:
      "Technical prompts for developers covering code generation, debugging, system design, and architecture planning.",
  },
  Creative: {
    name: "Creative",
    slug: "creative",
    description:
      "Narrative design, storytelling frameworks, and creative writing prompts for content creators and writers.",
  },
};

const slugToName = Object.fromEntries(
  Object.entries(categoryMetadata).map(([, meta]) => [meta.slug, meta.name]),
);

export function resolveCategoryName(slug: string): string | undefined {
  return slugToName[slug.toLowerCase()];
}

export function resolveCategorySlug(name: string): string | undefined {
  return categoryMetadata[name]?.slug;
}
