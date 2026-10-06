import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("classification Select is independent of confirmation buttons", () => {
    const source = ts.createSourceFile("selector.tsx", readFileSync(new URL("./channel-model-selector-modal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let selects = 0;
    const visit = (node: ts.Node, insideButton = false) => {
        const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(source) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(source) : "";
        if (tag === "Select") {
            selects++;
            assert.equal(insideButton, false, "classification control must not trigger its ancestor's confirmation click");
        }
        ts.forEachChild(node, (child) => visit(child, insideButton || tag === "Button"));
    };
    visit(source);
    assert.equal(selects, 1);
});

test("ordinary checkbox and select-all actions preserve existing mixed classifications", () => {
    const source = ts.createSourceFile("selector.tsx", readFileSync(new URL("./channel-model-selector-modal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const actions = new Set(["toggleModel", "selectActiveModels"]);
    let checked = 0;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && actions.has(node.name.getText(source))) {
            checked++;
            const check = (child: ts.Node) => {
                assert.equal(ts.isIdentifier(child) && child.text === "setModelCapabilities", false, "selection must not implicitly reclassify existing models");
                ts.forEachChild(child, check);
            };
            ts.forEachChild(node, check);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(checked, 2);
});

function classificationAttributes() {
    const source = ts.createSourceFile("selector.tsx", readFileSync(new URL("./channel-model-selector-modal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let attributes: ts.JsxAttributes | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "Select") attributes = node.attributes;
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(attributes);
    return new Map(attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(source), attribute.initializer?.getText(source)]));
}

test("reselecting automatic classification applies the explicit reset command", () => {
    assert.match(classificationAttributes().get("onSelect") || "", /assignModelCapabilities/);
});

test("classification stays locked while delayed model discovery is running", () => {
    assert.equal(classificationAttributes().get("disabled"), "{fetching}");
});
