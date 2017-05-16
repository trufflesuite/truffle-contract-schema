var fs = require("fs");
var spec = require("../spec/contract.spec.json");
var Ajv = require("ajv");
var assert = require("assert");

var MetaCoinJSON = require("./MetaCoin.json");

describe("Schema", function() {
  var validator;
  var invalidSchemaError;

  before("load schema library", function() {
    var ajv = new Ajv();
    try {
      validator = ajv.compile(spec);
    } catch (e) {
      invalidSchemaError = e;
    }
  });

  it("validates as json-schema", function() {
    assert.ifError(invalidSchemaError);
  });

  it("validates a simple example", function() {
    var valid = validator(MetaCoinJSON);
    assert.ifError(validator.errors);
  });

});
