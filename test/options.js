var Schema = require("../index.js");
var assert = require("assert");

describe("options", function() {
  it("let's x- options through", function() {
    var options = {
      "x-from-dependency": "adder/Adder.sol"
    }

    options = Schema.normalizeInput(options);
    assert.equal(options["x-from-dependency"], "adder/Adder.sol");

    options = Schema.generateObject(options);
    assert.equal(options["x-from-dependency"], "adder/Adder.sol");

    options = Schema.generateObject(options, {"x-another-option": "exists"});
    assert.equal(options["x-another-option"], "exists");
  });
});
