/**
 * The film is rendered once per colour scheme, so the README can show the one
 * that matches the reader's. The scheme is the room's resting appearance; the
 * mid-film sweep goes to the other one and back.
 */
export type Theme = "light" | "dark";

export const scheme: Theme =
  new URLSearchParams(location.search).get("scheme") === "light" ? "light" : "dark";
export const other: Theme = scheme === "light" ? "dark" : "light";
