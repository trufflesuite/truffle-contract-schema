var fs = require("fs");
var spec = require("../spec/contract.spec.json");
var Ajv = require("ajv");
var assert = require("assert");
var Schema = require("../index.js");

var MetaCoin = require("./MetaCoin.json");

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
    var valid = validator(MetaCoin);
    assert.ifError(validator.errors);
  });

  it("returns a validation promise with successful `then` behavior", function(done) {
    Schema.validateContractObject(MetaCoin)
      .then(function() {
        done();
      });
  });

  it("returns a validation promise with successful `catch` behavior", function(done) {
    var invalid = {
      "address": -1
    };

    Schema.validateContractObject(invalid)
      .catch(function(errors) {
        var addressErrors = errors.filter(function(error) {
          return error.dataPath === ".address"
        });
        assert(addressErrors);
        done();
      });
  });

});
