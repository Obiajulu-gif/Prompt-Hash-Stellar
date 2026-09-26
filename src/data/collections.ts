export interface Collection {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  promptIds: number[];
  curator: string;
  promptCount: number;
}

export const collections: Collection[] = [
  {
    id: "dev-tools",
    title: "Development & Architecture",
    description:
      "High-performance prompts for system design, code generation, and technical architecture planning.",
    imageUrl: "/images/codeguru.png",
    promptIds: [1],
    curator: "PromptHash",
    promptCount: 1,
  },
  {
    id: "creative-writing",
    title: "Creative Writing & Storytelling",
    description:
      "Unlock narrative structures, character development, and creative writing techniques from expert curators.",
    imageUrl: "/images/codeguru.png",
    promptIds: [2],
    curator: "PromptHash",
    promptCount: 1,
  },
  {
    id: "marketing-sales",
    title: "Marketing & Sales",
    description:
      "Crafted prompts for copywriting, sales funnels, brand strategy, and audience engagement.",
    imageUrl: "/images/codeguru.png",
    promptIds: [],
    curator: "PromptHash",
    promptCount: 0,
  },
  {
    id: "productivity",
    title: "Productivity & Workflow",
    description:
      "Streamline your daily workflow with prompts designed for task management, automation, and team coordination.",
    imageUrl: "/images/codeguru.png",
    promptIds: [],
    curator: "PromptHash",
    promptCount: 0,
  },
];
