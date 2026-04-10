export interface FeaturedPromptTemplate {
  id: string;
  category: string;
  title: string;
  imageUrl: string;
  previewText: string;
  fullPrompt: string;
}

export const featuredPromptTemplates: FeaturedPromptTemplate[] = [
  {
    id: "software-dev-architecture",
    category: "Software Development",
    title: "Architecture Review Sprint",
    imageUrl: "/browse/backend.png",
    previewText:
      "Turn a rough feature brief into a production-ready delivery plan with risks, interfaces, and rollout steps.",
    fullPrompt:
      "You are a principal engineer reviewing a feature proposal before implementation.\n\nContext:\n- Product goal: [goal]\n- Current system: [system summary]\n- Constraints: [constraints]\n- Target date: [date]\n\nDeliver:\n1. A concise architecture summary.\n2. The main components that change and why.\n3. API, data model, and background job updates.\n4. Operational risks, edge cases, and migration concerns.\n5. A phased implementation plan with validation checkpoints.\n6. A final recommendation that explicitly calls out what should not be built yet.",
  },
  {
    id: "marketing-campaign",
    category: "Marketing",
    title: "Multi-Channel Campaign Composer",
    imageUrl: "/browse/campaign.png",
    previewText:
      "Convert one positioning statement into a launch campaign with channel-by-channel messaging and measurable hooks.",
    fullPrompt:
      "Act as a senior lifecycle marketer.\n\nInputs:\n- Offer: [offer]\n- Audience: [audience]\n- Tone: [tone]\n- Main objection: [objection]\n- Conversion goal: [goal]\n\nBuild a launch package that includes:\n1. One big idea and supporting proof points.\n2. Email copy for teaser, launch, and reminder.\n3. Two paid social variations.\n4. One landing page hero section.\n5. Suggested metrics to watch in the first 72 hours.\n\nKeep the writing specific, commercial, and easy to test.",
  },
  {
    id: "sales-discovery",
    category: "Sales",
    title: "Discovery Call Closer",
    imageUrl: "/browse/sales.png",
    previewText:
      "Generate better discovery calls with probing questions, objection handling, and a clean next-step close.",
    fullPrompt:
      "You are a sales coach preparing an account executive for a live discovery call.\n\nInputs:\n- Prospect role: [role]\n- Company type: [company]\n- Suspected pain point: [pain]\n- Product sold: [product]\n\nProduce:\n1. An opening statement that earns permission to lead the call.\n2. Ten layered discovery questions.\n3. Three tailored objection responses.\n4. Signals that indicate urgency, budget, or champion quality.\n5. A closing sequence that secures a follow-up or pilot.\n\nDo not use generic boilerplate. Make the language sound like a real seller.",
  },
  {
    id: "support-escalation",
    category: "Customer Support",
    title: "Escalation Recovery Script",
    imageUrl: "/browse/customer.png",
    previewText:
      "De-escalate a frustrated customer while preserving trust, confirming the issue, and moving toward resolution.",
    fullPrompt:
      "You are a senior support lead responding to a customer escalation.\n\nInputs:\n- Product: [product]\n- Customer issue: [issue]\n- What already failed: [history]\n- Desired outcome: [outcome]\n\nWrite:\n1. A first response that acknowledges the impact without sounding scripted.\n2. A structured troubleshooting sequence.\n3. A version for live chat and a version for email.\n4. A manager follow-up if the issue remains unresolved.\n5. A short internal handoff note for engineering.\n\nPrioritize clarity, empathy, and ownership.",
  },
  {
    id: "finance-planning",
    category: "Finance",
    title: "Scenario Planning Memo",
    imageUrl: "/browse/financial-forecasting.png",
    previewText:
      "Translate assumptions into a finance memo with best case, base case, downside case, and cash implications.",
    fullPrompt:
      "Act as a finance manager preparing a decision memo.\n\nInputs:\n- Business line: [line]\n- Revenue assumptions: [assumptions]\n- Cost drivers: [costs]\n- Key uncertainty: [uncertainty]\n\nCreate:\n1. A base case summary.\n2. Best case and downside case assumptions.\n3. Margin and cash-flow implications.\n4. The metrics leadership should review weekly.\n5. A recommendation with trigger points for action.\n\nKeep the output business-facing, concise, and decision oriented.",
  },
  {
    id: "product-prd",
    category: "Product Management",
    title: "PRD to Launch Checklist",
    imageUrl: "/browse/business-plan.png",
    previewText:
      "Shape an ambiguous product request into a scoped PRD with success metrics, edge cases, and rollout sequencing.",
    fullPrompt:
      "You are a product manager drafting a lean product requirements document.\n\nInputs:\n- Problem statement: [problem]\n- User segment: [segment]\n- Desired behavior change: [behavior]\n- Dependencies: [dependencies]\n\nReturn:\n1. Problem, user, and success metric sections.\n2. A tight scope and explicit non-goals.\n3. User stories and acceptance criteria.\n4. Edge cases and instrumentation needs.\n5. A launch checklist covering engineering, support, and analytics.\n\nBias toward clarity and execution, not narrative filler.",
  },
  {
    id: "ux-research",
    category: "User Experience",
    title: "Research Synthesis Builder",
    imageUrl: "/browse/market-analysis.png",
    previewText:
      "Turn scattered notes into UX findings, actionable design principles, and prioritized interface changes.",
    fullPrompt:
      "Act as a UX researcher synthesizing interviews and usability observations.\n\nInputs:\n- Product area: [area]\n- Research notes: [notes]\n- Primary task users attempted: [task]\n\nDeliver:\n1. Top themes with evidence.\n2. Pain points ranked by severity and frequency.\n3. Design opportunities tied to user outcomes.\n4. Three prototype ideas to test next.\n5. A concise readout for design and product stakeholders.\n\nUse concrete language and avoid generic design clichés.",
  },
  {
    id: "recruitment-scorecard",
    category: "Recruitment",
    title: "Structured Hiring Scorecard",
    imageUrl: "/browse/setting-creator.png",
    previewText:
      "Create a hiring scorecard, interview loop, and calibrated feedback prompts for one open role.",
    fullPrompt:
      "You are a recruiting partner setting up a structured hiring process.\n\nInputs:\n- Role title: [role]\n- Seniority: [level]\n- Team context: [team]\n- Must-have capabilities: [must haves]\n\nProduce:\n1. A scorecard with 5 to 7 measurable competencies.\n2. An interview loop with owners and focus areas.\n3. Question prompts that reveal real evidence.\n4. Red flags and false-positive risks.\n5. A final debrief template that forces a clear recommendation.\n\nOptimize for consistency, fairness, and signal quality.",
  },
  {
    id: "operations-playbook",
    category: "Operations",
    title: "Ops Playbook Generator",
    imageUrl: "/browse/operational.png",
    previewText:
      "Document a repeatable workflow with owners, service levels, bottlenecks, and failure recovery steps.",
    fullPrompt:
      "You are an operations manager writing a playbook for a recurring workflow.\n\nInputs:\n- Process name: [process]\n- Teams involved: [teams]\n- Current pain points: [pain points]\n- Desired SLA: [sla]\n\nBuild:\n1. A step-by-step operating procedure.\n2. RACI ownership by stage.\n3. Required inputs, outputs, and systems.\n4. Common failure modes with response steps.\n5. Metrics to track throughput, quality, and queue risk.\n\nKeep the document direct enough that a new operator could follow it tomorrow.",
  },
  {
    id: "pr-response",
    category: "Public Relations",
    title: "Issue Response Briefing",
    imageUrl: "/browse/brand-voice.png",
    previewText:
      "Draft a public response plan for a sensitive issue with holding statements, media angles, and escalation rules.",
    fullPrompt:
      "You are a communications lead preparing a rapid-response brief.\n\nInputs:\n- Situation: [situation]\n- Stakeholders affected: [stakeholders]\n- Known facts: [facts]\n- Unknowns: [unknowns]\n\nCreate:\n1. A holding statement for immediate use.\n2. A fuller public statement once facts are confirmed.\n3. Anticipated press questions with approved answers.\n4. Internal guidance for executives and support teams.\n5. Escalation rules for legal, security, and leadership review.\n\nWrite with discipline and protect credibility above all else.",
  },
];
