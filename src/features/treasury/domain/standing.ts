// The three states of money (doctrine D-049), pure and light: the server computes them, and
// nothing else does. Every amount is an integer of the currency's smallest unit.

/** What a project did with money, from the register. */
export interface ProjectFunds {
  projectId: string;
  /** What came in for it. */
  received: number;
  /** What went out for it. */
  spent: number;
  /** What is approved for it and still to pay. */
  committed: number;
}

export interface ProjectStanding extends ProjectFunds {
  /** What it received and has not spent; negative when it spent what it did not receive. */
  available: number;
  /** Its own money, kept for it: never below zero. */
  reserved: number;
  /** What it spent of money that was not its own. */
  overdrawn: number;
  /** What it owes that its own money does not cover. */
  uncovered: number;
}

export interface MoneyStanding {
  /** In the bank, in the tills, in the wallets. */
  held: number;
  /** Received for projects and not spent yet: theirs, not the organization's to use. */
  reserved: number;
  /** Approved and still to pay, that no project's own money covers. */
  committed: number;
  /** What the organization may really decide on: held, less reserved, less committed. */
  available: number;
  projects: ProjectStanding[];
}

export function projectStanding(funds: ProjectFunds): ProjectStanding {
  const available = funds.received - funds.spent;
  const reserved = Math.max(0, available);
  return {
    ...funds,
    available,
    reserved,
    overdrawn: Math.max(0, -available),
    uncovered: Math.max(0, funds.committed - reserved),
  };
}

/**
 * « Really available » is what is held, less what is reserved for projects, less what is
 * committed. A project's commitments are paid with its own money first: only what goes beyond it
 * weighs on everyone's — so no franc is taken off twice.
 */
export function reallyAvailable(
  held: number,
  projects: readonly ProjectFunds[],
  /** Approved and still to pay for the running of the organization, outside any project. */
  runningCommitted: number,
): MoneyStanding {
  const standings = projects.map(projectStanding);
  const reserved = standings.reduce((sum, p) => sum + p.reserved, 0);
  const committed = standings.reduce((sum, p) => sum + p.uncovered, 0) + runningCommitted;
  return { held, reserved, committed, available: held - reserved - committed, projects: standings };
}
