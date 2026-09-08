// Unit tests for the OmniRoute scripting response parser in convex/pipeline.ts.
// Run with: bun test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { extractJson } = await import("../convex/pipeline.ts");

const VALID = JSON.stringify({
  clips: [
    { videoPrompt: "intro scene", dialogue: "Hello!" },
    { videoPrompt: "feature scene", dialogue: "Look at this." },
    { videoPrompt: "closing scene", dialogue: "Buy now!" },
  ],
});

describe("extractJson", () => {
  it("parses a clean JSON object", () => {
    assert.deepEqual(extractJson(VALID), JSON.parse(VALID));
  });

  it("parses a ```json fenced response", () => {
    assert.deepEqual(extractJson("```json\n" + VALID + "\n```"), JSON.parse(VALID));
  });

  it("parses a bare ``` fenced response", () => {
    assert.deepEqual(extractJson("```\n" + VALID + "\n```"), JSON.parse(VALID));
  });

  it("extracts JSON embedded in prose", () => {
    const wrapped = `Here is your script:\n\n${VALID}\n\nHope this helps!`;
    assert.deepEqual(extractJson(wrapped), JSON.parse(VALID));
  });

  it("extracts JSON with trailing commas inside prose text", () => {
    const messy = `Sure! {"clips": [{"videoPrompt": "a", "dialogue": "b"}]}, enjoy!`;
    assert.deepEqual(extractJson(messy), {
      clips: [{ videoPrompt: "a", dialogue: "b" }],
    });
  });

  it("throws on text with no JSON object", () => {
    assert.throws(() => extractJson("no json here at all"), /not valid JSON/);
  });

  it("throws on an unclosed JSON object", () => {
    assert.throws(() => extractJson('{"clips": [{'), /not valid JSON/);
  });
});
