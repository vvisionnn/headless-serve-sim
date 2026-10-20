import { describe, expect, test } from "bun:test";
import { latestWins } from "../client/utils/latest-wins";

/** A setter whose sets finish only when told to. */
function setter() {
  const sent: string[] = [];
  const waiting: Array<() => void> = [];
  const send = (key: string, value: string) => {
    sent.push(`${key}=${value}`);
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const finish = async () => {
    waiting.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sent, send, finish };
}

describe("latestWins", () => {
  test("a second click while a set is in flight lands once the first finishes", async () => {
    const s = setter();
    const set = latestWins(s.send);
    set("voiceover", "on");
    set("voiceover", "off");
    expect(s.sent).toEqual(["voiceover=on"]);
    await s.finish();
    expect(s.sent).toEqual(["voiceover=on", "voiceover=off"]);
    await s.finish();
    expect(s.sent).toEqual(["voiceover=on", "voiceover=off"]);
  });

  test("only the latest of several waiting values is sent", async () => {
    const s = setter();
    const set = latestWins(s.send);
    set("text-size", "small");
    set("text-size", "medium");
    set("text-size", "large");
    await s.finish();
    await s.finish();
    expect(s.sent).toEqual(["text-size=small", "text-size=large"]);
  });

  test("a value back where the in-flight set left it isn't sent again", async () => {
    const s = setter();
    const set = latestWins(s.send);
    set("voiceover", "on");
    set("voiceover", "off");
    set("voiceover", "on");
    await s.finish();
    expect(s.sent).toEqual(["voiceover=on"]);
  });

  test("different options don't wait on each other", () => {
    const s = setter();
    const set = latestWins(s.send);
    set("voiceover", "on");
    set("reduce-motion", "on");
    expect(s.sent).toEqual(["voiceover=on", "reduce-motion=on"]);
  });

  test("a failed set still sends the latest value after it", async () => {
    const sent: string[] = [];
    let fail = true;
    const set = latestWins(async (_key: string, value: string) => {
      sent.push(value);
      if (fail) {
        fail = false;
        await Promise.resolve();
        throw new Error("boom");
      }
    });
    set("voiceover", "on");
    set("voiceover", "off");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(["on", "off"]);
  });
});
