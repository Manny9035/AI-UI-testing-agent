export interface Discipline {
  id: string;
  slash: string;
  title: string;
  description: string;
  enabled: boolean;
}

/** The challenge categories. Only functional testing is wired up in this build. */
export const DISCIPLINES: Discipline[] = [
  {
    id: "functional",
    slash: "/Functional Testing",
    title: "Functional Testing",
    description: "Does the software do what its behavior says it does?",
    enabled: true,
  },
  {
    id: "api",
    slash: "/API Testing",
    title: "API Testing",
    description: "Contracts, status codes, and failure responses.",
    enabled: false,
  },
  {
    id: "uiux",
    slash: "/UI/UX Testing",
    title: "UI/UX Testing",
    description: "Flows, states, and what a person actually sees.",
    enabled: false,
  },
  {
    id: "performance",
    slash: "/Performance Testing",
    title: "Performance Testing",
    description: "Latency, load, and the cost of a request.",
    enabled: false,
  },
  {
    id: "security",
    slash: "/Security Testing",
    title: "Security Testing",
    description: "Auth, input handling, and exposed secrets.",
    enabled: false,
  },
  {
    id: "data",
    slash: "/Data & Database Testing",
    title: "Data & Database Testing",
    description: "Integrity, migrations, and bad records.",
    enabled: false,
  },
];

export function disciplineById(id: string): Discipline | undefined {
  return DISCIPLINES.find((item) => item.id === id);
}
