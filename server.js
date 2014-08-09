//
// # Simple Google Mirror
//

var util = require("util");
var http = require('http');
var app = require("./proxy");


var server = http.createServer(app);
server.on('listening', function() {
    console.log('Server running and listening at %s', server._connectionKey);
});
server.on('close', function() {
    util.log('Server now shutdow.');
});
server.listen(process.env.PORT || 8080, process.env.IP || "0.0.0.0");
