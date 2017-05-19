var sha3 = require("crypto-js/sha3");
var schema_version = require("./package.json").version;
var Ajv = require("ajv");
var contractSchema = require("./spec/contract.spec.json");


/**
 * Property definitions for Contract Objects
 *
 * Describes canonical output properties as sourced from some "dirty" input
 * object. Describes normalization process to account for deprecated and/or
 * nonstandard keys and values.
 *
 * Maps (key -> property) where:
 *  - `key` is the top-level output key matching up with those in the schema
 *  - `property` is an object with optional values:
 *      - `sources`: list of sources (see below); default `key`
 *      - `transform`: function(value) -> transformed value; default x -> x
 *
 * Each source represents a means to select a value from dirty object.
 * Allows:
 *  - dot-separated (`.`) string, corresponding to path to value in dirty
 *    object
 *  - function(dirtyObj) -> (cleanValue | undefined)
 *
 * The optional `transform` parameter standardizes value regardless of source,
 * for purposes of ensuring data type and/or string schemas.
 */
var properties = {
  "contractName": {
    "sources": ["contractName", "contract_name"]
  },
  "abi": {
    "sources": ["abi", "interface"],
    "transform": function(value) {
      if (typeof value === "string") {
        try {
          value = JSON.parse(value)
        } catch (e) {
          value = undefined;
        }
      }
      return value;
    }
  },
  "bytecode": {
    "sources": [
      "bytecode", "binary", "unlinked_binary", "evm.bytecode.object"
    ],
    "transform": function(value) {
      if (value && value.indexOf("0x") != 0) {
        value = "0x" + value;
      }
      return value;
    }
  },
  "deployedBytecode": {
    "sources": [
      "deployedBytecode", "runtimeBytecode", "evm.deployedBytecode.object"
    ],
    "transform": function(value) {
      if (value && value.indexOf("0x") != 0) {
        value = "0x" + value;
      }
      return value;
    }
  },
  "sourceMap": {
    "sources": ["sourceMap", "srcmap", "evm.bytecode.sourceMap"]
  },
  "deployedSourceMap": {
    "sources": ["deployedSourceMap", "srcmapRuntime", "evm.deployedBytecode.sourceMap"]
  },
  "source": {},
  "sourcePath": {},
  "ast": {},
  "networks": {
    // infers blank network from network_id
    "sources": ["networks", getter("network_id", function(network_id) {
      if (network_id !== undefined) {
        var networks = {}
        networks[network_id] = {"events": {}, "links": {}};
        return networks;
      }
    })],
    "transform": function(value) {
      if (value === undefined) {
        value = {}
      }
      return value;
    }
  },
  "schemaVersion": {
    "sources": ["schemaVersion", "schema_version"]
  },
  "updatedAt": {
    "sources": ["updatedAt", getter("updated_at", function(ms) {
      return new Date(ms).toISOString()
    })]
  }
};


/**
 * Construct a getter for a given key, possibly applying some post-retrieve
 * transformation on the resulting value.
 *
 * @return {Function} Accepting dirty object and returning value || undefined
 */
function getter(key, transform) {
  if (transform === undefined) {
    transform = function(x) { return x };
  }

  return function(obj) {
    try {
      return transform(obj[key]);
    } catch (e) {
      return undefined;
    }
  }
}


/**
 * Chains together a series of function(obj) -> value, passing resulting
 * returned value to next function in chain.
 *
 * Accepts any number of functions passed as arguments
 * @return {Function} Accepting initial object, returning end-of-chain value
 *
 * Assumes all intermediary values to be objects, with well-formed sequence
 * of operations.
 */
function chain() {
  var getters = Array.prototype.slice.call(arguments);
  return function(obj) {
    return getters.reduce(function (cur, get) {
      return get(cur);
    }, obj);
  }
}


// Schema module
//

var TruffleSchema = {
  // Return a promise to validate a contract object
  // - Resolves as validated `contractObj`
  // - Rejects with list of errors from schema validator
  validate: function(contractObj) {
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

  // accepts as argument anything that can be turned into a contract object
  // returns a contract object
  normalize: function(objDirty) {
    var normalized = {};

    // iterate over each property
    Object.keys(properties).forEach(function(key) {
      var property = properties[key];
      var value;  // normalized value || undefined

      // either used the defined sources or assume the key will only ever be
      // listed as its canonical name (itself)
      var sources = property.sources || [key];

      // iterate over sources until value is defined or end of list met
      for (var i = 0; value === undefined && i < sources.length; i++) {
        var source = sources[i];
        // string refers to path to value in objDirty, split and chain
        // getters
        if (typeof source === "string") {
          var traversals = source.split(".")
            .map(function(k) { return getter(k) });
          source = chain.apply(null, traversals);
        }

        // source should be a function that takes the objDirty and returns
        // value or undefined
        value = source(objDirty);
      }

      // run source-agnostic transform on value
      // (e.g. make sure bytecode begins 0x)
      if (property.transform) {
        value = property.transform(value);
      }

      // add resulting (possibly undefined) to normalized obj
      normalized[key] = value;
    });

    // copy custom options
    this.copyCustomOptions(objDirty, normalized);

    return normalized;
  },

  // Generate a proper binary from normalized options, and optionally
  // merge it with an existing binary.
  generateObject: function(objDirty, existingObjDirty, options) {
    objDirty = objDirty || {};
    existingObjDirty = existingObjDirty || {};

    options = options || {};

    obj = this.normalize(objDirty);
    existingObj = this.normalize(existingObjDirty);

    Object.keys(existingObj).forEach(function(key) {
      // networks will be skipped because normalize replaces undefined with {}
      if (obj[key] === undefined) {
        obj[key] = existingObj[key];
      }
    });

    Object.keys(existingObj.networks).forEach(function(network_id) {
      obj.networks[network_id] = existingObj.networks[network_id];
    });

    // if (options.overwrite == true) {
    //   e = {};
    // }

    obj.contractName = obj.contractName || "Contract";

    var updatedAt = new Date().toISOString();

    obj.schemaVersion = schema_version;

    if (options.dirty !== false) {
      obj.updatedAt = updatedAt;
    } else {
      obj.updatedAt = obj.updatedAt || updatedAt;
    }

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
