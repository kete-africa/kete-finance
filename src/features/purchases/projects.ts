import { getCenter } from '@/platform/center';
import { currentToken } from '@/platform/person';

/** A project of the center, as purchases need it: its name and the posts of its budget. */
export interface ProjectBudget {
  projectId: string;
  name: string;
  posts: { name: string; budget: number }[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A project the person of this request belongs to, read at the center with her token (doctrine
 * D-047): null when she is outside it — she then asks nothing on it — or without a center.
 */
export async function projectOf(projectId: string): Promise<ProjectBudget | null> {
  const project = await getCenter().project(currentToken(), projectId);
  if (!project) return null;
  return {
    projectId: project.projectId,
    name: project.name,
    posts: project.posts.map((post) => ({ name: post.name, budget: post.budget })),
  };
}

/** The post of a budget under the name a person gave it, in the budget's own spelling. */
export function postOf(
  project: ProjectBudget,
  post: string,
): { name: string; budget: number | null } {
  const found = project.posts.find((one) => same(one.name, post));
  return found ? { name: found.name, budget: found.budget } : { name: post.trim(), budget: null };
}
