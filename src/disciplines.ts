export interface Discipline {
  id: string;
  slash: string;
  title: string;
  description: string;
  enabled: boolean;
}

/** The challenge categories. Functional, API, and security testing run in this build. */
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
    description: "Call the API, compare it with the code, and say what to change.",
    enabled: true,
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
    description: "Review inputs and protections, then say how to prevent each gap.",
    enabled: true,
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
