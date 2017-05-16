var sha3 = require("crypto-js/sha3");
var schema_version = require("./package.json").version;
var Ajv = require("ajv");
var contractSchema = require("./spec/contract.spec.json");

// TODO: This whole thing should have a json schema.

var TruffleSchema = {
  // Return a promise to validate a contract object
  // - Resolves as validated `contractObj`
  // - Rejects with list of errors from schema validator
  validateContractObject: function(contractObj) {
    return new Promise(function (resolve, reject) {
      var ajv = new Ajv();
      var validate = ajv.compile(contractSchema);
      if (validate(contractObj)) {
        resolve(contractObj);
      } else {
        reject(validate.errors);
      }
    });
  },

  normalizeSolcContract: function(standardContract) {
    return {
      "abi": standardContract.abi,
      "bytecode": "0x" + standardContract.evm.bytecode.object,
      "deployedBytecode": "0x" + standardContract.evm.deployedBytecode.object,
      "sourceMap": standardContract.evm.bytecode.sourceMap,
      "deployedSourceMap": standardContract.evm.deployedBytecode.sourceMap,
      "ast": undefined // how to get? unsupported by solc right now
    }
  },

  normalizeAbstraction: function(abstraction) {
    var abstraction = abstraction.toJSON();
    return {
      "abi": abstraction.abi,
      "bytecode": abstraction.bytecode,
      "deployedBytecode": abstraction.deployedBytecode,
      "sourceMap": abstraction.sourceMap,
      "deployedSourceMap": abstraction.deployedSourceMap,
      "ast": abstraction.ast,
    }
  },

  normalizeOptions: function(options, extraOptions) {
    extraOptions = extraOptions || {};
    var normalized = {};
    var expectedKeys = [
      "abi",
      "bytecode",
      "deployedBytecode",
      "sourceMap",
      "deployedSourceMap",
      "ast"
    ];

    var deprecatedKeyMappings = {
      "unlinked_binary": "bytecode",
      "binary": "bytecode",
      "srcmap": "sourceMap",
      "srcmapRuntime": "deployedSourceMap",
      "interface": "abi",
      "runtimeBytecode": "deployedBytecode"
    };

    // Merge options/contract object first, then extra_options
    expectedKeys.forEach(function(key) {
      var value;

      try {
        // Will throw an error if key == address and address doesn't exist.
        value = options[key];

        if (value != undefined) {
          normalized[key] = value;
        }
      } catch (e) {
        // Do nothing.
      }

      try {
        // Will throw an error if key == address and address doesn't exist.
        value = extraOptions[key];

        if (value != undefined) {
          normalized[key] = value;
        }
      } catch (e) {
        // Do nothing.
      }
    });

    Object.keys(deprecatedKeyMappings).forEach(function(deprecatedKey) {
      var mappedKey = deprecatedKeyMappings[deprecatedKey];

      if (normalized[mappedKey] == null) {
        normalized[mappedKey] = options[deprecatedKey] || extraOptions[deprecatedKey];
      }
    });

    if (typeof normalized.abi == "string") {
      normalized.abi = JSON.parse(normalized.abi);
    }

    return normalized;
  },

  isSolcOutput: function(obj) {
    var matches;
    try {
      matches = JSON.parse(obj.metadata).language === "Solidity";
    } catch (e) {
      matches = false;
    }
    return matches;
  },

  isAbstraction: function(obj) {
    try {
      return obj.contract;
    } catch (e) {
      return false;
    }
  },

  // Generate a proper binary from normalized options, and optionally
  // merge it with an existing binary.
  generateObject: function(options, existing_object, extra_options) {
    var obj;

    existing_object = existing_object || {};
    extra_options = extra_options || {};

    options.networks = options.networks || {};

    if (this.isSolcOutput(existing_object)) {
      obj = this.normalizeSolcContract(existing_object);
    } else if (this.isAbstraction(existing_object)) {
      obj = this.normalizeAbstraction(existing_object);
    } else {
      obj = this.normalizeOptions(options, extra_options);
    }

    existing_object.networks = existing_object.networks || {};
    // Merge networks before overwriting
    Object.keys(existing_object.networks).forEach(function(network_id) {
      options.networks[network_id] = existing_object.networks[network_id];
    });

    this.copyCustomOptions(options, obj);
    this.copyCustomOptions(existing_object, obj);


    if (options.overwrite == true) {
      existing_object = {};
    }

    obj.contractName = obj.contractName || "Contract";

    // Ensure bytecode/deployedBytecode start with 0x
    // TODO: Remove this and enforce it through json schema
    if (obj.bytecode && obj.bytecode.indexOf("0x") < 0) {
      obj.bytecode = "0x" + obj.bytecode;
    }
    if (obj.deployedBytecode && obj.deployedBytecode.indexOf("0x") < 0) {
      obj.deployedBytecode = "0x" + obj.deployedBytecode;
    }

    var updatedAt = new Date().toISOString();

    obj.schemaVersion = schema_version;

    if (extra_options.dirty !== false) {
      obj.updatedAt = updatedAt;
    } else {
      obj.updatedAt = options.updatedAt || existing_object.updatedAt || updatedAt;
    }

    this.copyCustomOptions(options, obj);

    return obj;
  },

  copyCustomOptions: function(from, to) {
    // Now let all x- options through.
    Object.keys(from).forEach(function(key) {
      if (key.indexOf("x-") != 0) return;

      try {
        value = from[key];

        if (value != undefined) {
          to[key] = value;
        }
      } catch (e) {
        // Do nothing.
      }
    });
  }
};

module.exports = TruffleSchema;
