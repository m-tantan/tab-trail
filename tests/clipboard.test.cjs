const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "clipboard.js"), "utf8");

function setup(copySucceeds) {
  let listener;
  let copiedText;
  const textarea = { value: "", select() {} };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener: (value) => { listener = value; } } } },
    document: {
      querySelector: () => textarea,
      execCommand(command) {
        assert.equal(command, "copy");
        copiedText = textarea.value;
        return copySucceeds;
      }
    }
  });
  vm.runInContext(source, context);
  return {
    textarea,
    send(message) {
      let response;
      listener(message, {}, (value) => { response = structuredClone(value); });
      return { response, copiedText };
    }
  };
}

test("clipboard writer copies the exact URL list and clears its temporary text", () => {
  const { send, textarea } = setup(true);
  const text = "https://example.com/one\n\nhttps://example.com/two";
  const result = send({ target: "clipboard", type: "write-clipboard", text });
  assert.deepEqual(result, { response: { ok: true }, copiedText: text });
  assert.equal(textarea.value, "");
});

test("clipboard writer reports a failed write and still clears temporary text", () => {
  const { send, textarea } = setup(false);
  const { response } = send({
    target: "clipboard", type: "write-clipboard", text: "https://example.com"
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /could not write/);
  assert.equal(textarea.value, "");
});

test("clipboard writer ignores other extension messages and rejects empty writes", () => {
  const { send } = setup(true);
  assert.equal(send({ type: "get-popup-state" }).response, undefined);
  const { response } = send({ target: "clipboard", type: "write-clipboard", text: "" });
  assert.equal(response.ok, false);
  assert.match(response.error, /No tab links/);
});
