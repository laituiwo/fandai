//
// # AirGoo Server
//

var options = require("./defines").initialize();
var AirGooServer = require("./airgoo");


new AirGooServer().initialize(options).start();