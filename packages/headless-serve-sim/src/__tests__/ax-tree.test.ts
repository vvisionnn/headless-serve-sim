import { describe, expect, test } from "bun:test";
import type { AxElement } from "../ax-shared";
import { buildAxTree } from "../client/console/ax-tree";

function el(path: string, id = path): AxElement {
  return {
    id,
    path,
    label: path,
    value: "",
    role: "button",
    type: "Button",
    enabled: true,
    frame: { x: 0, y: 0, width: 10, height: 10 },
  };
}

const shape = (nodes: ReturnType<typeof buildAxTree>): unknown =>
  nodes.map((n) => [n.element.path, shape(n.children)]);

describe("buildAxTree", () => {
  test("nests elements under the nearest ancestor path", () => {
    const tree = buildAxTree([el("0"), el("0.0"), el("0.0.1"), el("0.1")]);
    expect(shape(tree)).toEqual([
      [
        "0",
        [
          ["0.0", [["0.0.1", []]]],
          ["0.1", []],
        ],
      ],
    ]);
  });

  // The snapshot drops screen-sized containers, so a child's direct parent
  // may be missing; it attaches to the closest surviving ancestor instead.
  test("skips over ancestors missing from the snapshot", () => {
    const tree = buildAxTree([el("0.0"), el("0.0.0.2"), el("0.1")]);
    expect(shape(tree)).toEqual([
      ["0.0", [["0.0.0.2", []]]],
      ["0.1", []],
    ]);
  });

  test("does not treat a sibling with a shared prefix as a parent", () => {
    const tree = buildAxTree([el("0.1"), el("0.10")]);
    expect(shape(tree)).toEqual([
      ["0.1", []],
      ["0.10", []],
    ]);
  });

  test("returns an empty forest for no elements", () => {
    expect(buildAxTree([])).toEqual([]);
  });
});
