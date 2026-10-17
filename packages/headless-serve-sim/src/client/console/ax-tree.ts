import type { AxElement } from "../../ax-shared";

export interface AxTreeNode {
  element: AxElement;
  children: AxTreeNode[];
}

/**
 * Rebuild the hierarchy from the flat snapshot. Each element's `path` is its
 * index chain ("0.2.1"); screen-sized containers are dropped server-side, so
 * an element hangs off its closest ancestor that survived.
 */
export function buildAxTree(elements: readonly AxElement[]): AxTreeNode[] {
  const byPath = new Map<string, AxTreeNode>();
  const roots: AxTreeNode[] = [];
  for (const element of elements) {
    const node: AxTreeNode = { element, children: [] };
    let parent: AxTreeNode | undefined;
    for (let cut = element.path.lastIndexOf("."); cut > 0 && !parent;) {
      const prefix = element.path.slice(0, cut);
      parent = byPath.get(prefix);
      cut = prefix.lastIndexOf(".");
    }
    (parent ? parent.children : roots).push(node);
    byPath.set(element.path, node);
  }
  return roots;
}
