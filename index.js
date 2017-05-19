var sha3 = require("crypto-js/sha3");
var schema_version = require("./package.json").version;
var Ajv = require("ajv");
var contractSchema = require("./spec/contract.spec.json");


// some data functions
//

var getter = function(key, transform) {
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

var chain = function() {
  var getters = Array.prototype.slice.call(arguments);
  return function(obj) {
    return getters.reduce(function (cur, get) {
      return get(cur);
    }, obj);
  }
}

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
    "sources": ["networks",
      // can infer blank network from being given network_id
      getter("network_id", function(network_id) {
        if (network_id !== undefined) {
          var networks = {}
          networks[network_id] = {"events": {}, "links": {}};
          return networks;
        }
      })
    ],
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
      })
    ]
  }
};

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
  normalize: function(objectable) {
    // construct normalized obj
    var normalized = {};
    Object.keys(properties).forEach(function(key) {
      var property = properties[key];

      var value;

      // either used the defined sources or assume the key will only ever be
      // listed as its canonical name (itself)
      var sources = property.sources || [key];

      // iterate over sources until value is defined or end of list met
      for (var i = 0; value === undefined && i < sources.length; i++) {
        var source = sources[i];
        // string refers to path to value in objectable, split and chain
        // getters
        if (typeof source === "string") {
          var traversals = source.split(".")
            .map(function(k) { return getter(k) });
          source = chain.apply(null, traversals);
        }

        // source should be a function that takes the objectable and returns
        // value or undefined
        value = source(objectable);
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
    this.copyCustomOptions(objectable, normalized);

    return normalized;
  },

  // Generate a proper binary from normalized options, and optionally
  // merge it with an existing binary.
  generateObject: function(objectable, existingObjectable, options) {
    objectable = objectable || {};
    existingObjectable = existingObjectable || {};

    options = options || {};

    obj = this.normalize(objectable);
    existingObj = this.normalize(existingObjectable);

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
