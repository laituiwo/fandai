//
// # Simple Google Mirror
//

var zlib = require("zlib"),
    http = require('http'),
    https = require("https");

http.createServer(function(req, res) {
    https.request({
        hostname: 'www.google.com',
        path: req.url,
        headers: (req.domain = req.headers['host'], delete req.headers['host'], req.headers)
    }, function(pxRes) {
        var text = /(text|json)/.test(pxRes.headers['content-type'] || '')
        pxRes.headers = JSON.parse(JSON.stringify(pxRes.headers).replace(/google\.com/g, req.domain));
        if (text) pxRes.headers['Content-Encoding'] = 'deflate';
        res.writeHead(pxRes.statusCode, pxRes.headers);
        (text ? pxRes.pipe(zlib.createDeflateRaw()) : pxRes).pipe(res);
    }).end();
}).on('listening', function() {
    console.log('Server running and listening at %s', this._connectionKey);
}).listen(process.env.PORT || 8080, process.env.IP || "0.0.0.0");