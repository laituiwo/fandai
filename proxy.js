var https = require("https");
var util = require('util');
var zlib = require('zlib');


util.apply = function(o, c, defaults) {
    if (defaults) {
        util.apply(o, defaults);
    }
    if (o && c && typeof c == 'object') {
        for (var p in c) {
            o[p] = c[p];
        }
    }
    return o;
};

util.apply(String.prototype, {
    contains: function(str) {
        return str && this.indexOf(str) > -1;
    },
    startsWith: function(prefix) {
        return prefix && this.length >= prefix.length && this.substring(0, prefix.length) === prefix;
    },
    endsWith: function(suffix) {
        return suffix && this.length >= suffix.length && this.slice(-suffix.length) === suffix;
    },
    hashCode: function() {
        if (this.length === 0) return 0;
        var hash = 0,
            charAt, i, len = this.length;
        for (i = 0; i < len; i++) {
            charAt = this.charCodeAt(i);
            hash = ((hash << 5) - hash) + charAt;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }
});

var trust_proxy = process.env.trust_proxy === false ? false : true;

var rulesDefine = {
    html: [{
        "pathRegex": /\/(search|webhp)/,
        "pattern": /onmousedown=\"[^\"]+?\"/g,
        "replacement": "target=\"_blank\""
        /* 换掉 /search rwt */
    }, {
        "pattern": /,pushdown_promo:'[^']+?'/g,
        "replacement": ""
        /* 滤掉广告 */
    }, {
        "pattern": /\/\/(?=ssl\.)/g,
        "replacement": "/!"
        /* 重写绝对地址 */
    }, {
        "pattern": /(\w+:)?\/\/www\.google[.\w]+/g,
        "replacement": ""
        /* 重写绝对地址 */
    }],
    js: [{
        "pattern": /(\w+:)?\/\/www\.google[.\w]+/g,
        "replacement": ""
        /* 重写xjs,rs绝对地址 */
    }],
    json: [{
        "pattern": /https:\\\/\\\/www\.google[.\w]+/g,
        "replacement": ""
    }, {
        "pattern": /onmousedown\\\\x3d\\\\x22.+?\\\\x22/g,
        "replacement": "target\\\\x3d\\\\x22_blank\\\\x22"
    }]
};

var reCookieDomain = /;\s*domain=\.google[.\w]+/;

https.globalAgent.maxSockets = 65535;

var headerExcludes = {
    'host': true,
    'range': true
};

function copyHeaders(src, dest) {
    var _dest = dest || {};
    for (var key in src) {
        if (!headerExcludes[key] && !key.startsWith('x-')) { // 防止x-forwarded-*
            var val = src[key];
            if (key === 'set-cookie') { // 处理cookie中的domain含有google.com
                if (util.isArray(val)) {
                    for (var i = 0, len = val.length; i < len; i++) {
                        val[i] = val[i].replace(reCookieDomain, '');
                    }
                } else {
                    val = val.replace(reCookieDomain, '');
                }
            }
            _dest[key] = val;
        }
    }
    if (!dest) return _dest;
}

function processContent(obj) {
    var rules, contentType = obj.contentType || '';
    if (contentType.contains('html')) {
        rules = rulesDefine.html;
    } else if (contentType.contains('javas')) {
        rules = rulesDefine.js;
    } else if (contentType.contains('json')) {
        rules = rulesDefine.json;
    }
    if (rules && obj.content) {
        var str = obj.content.toString();
        for (var rule, i = 0, len = rules.length; i < len; i++) {
            rule = rules[i];
            if (rule.pathRegex && !rule.pathRegex.test(obj.path)) continue;
            str = str.replace(rule.pattern, rule.replacement);
        }
        return new Buffer(str);
    }
    return obj.content;
}

function buildReuqest(req) {
    var path = req.url,
        options = {
            hostname: 'www.google.com',
            path: path
        };
    if (path.startsWith('/!')) {
        var sp = path.indexOf('/', 1);
        options.hostname = path.substring(2, sp);
        options.path = path.substr(sp);
    }
    options.headers = copyHeaders(req.headers);
    return options;
}

function log(msg, req) {
    var client = req ? ((trust_proxy && req.headers['x-forwarded-for']) || req.connection.remoteAddress) : '*';
    if (msg.length > 120) {
        msg = msg.substr(0, 117) + '...';
    }
    util.log(client + ' - ' + msg);
}

/**
 * 请求会话
 */
function GSession(req) {
    this.req = req;
    this.path = req.url;
}

util.apply(GSession.prototype, {

    sendHeaders: function(response) {
        this.proxyContentType = response.headers['content-type'];
        var headers = copyHeaders(response.headers);
        if (/(text|json)/.test(this.proxyContentType)) {
            headers['Content-Encoding'] = 'deflate';
        }
        this.res.writeHead(response.statusCode, headers);
    },

    sendBody: function() {
        if (this.proxyContentType) {
            this.body = processContent({
                path: this.path,
                contentType: this.proxyContentType,
                content: this.body
            });
        }
        if (/(text|json)/.test(this.proxyContentType)) {
            zlib.deflateRaw(this.body, function(err, buf) {
                this.res.write(buf);
                this.res.end();
            }.bind(this));
        } else {
            this.res.write(this.body || '');
            this.res.end();
        }
    },

    doProxy: function(res) {
        this.res = res;
        https.request(buildReuqest(this.req), function(pxRes) {
            log(util.format('[%s] < %s', pxRes.statusCode, this.path), this.req);
            this.sendHeaders(pxRes);
            pxRes.on('end', this.sendBody.bind(this));
            pxRes.on('data', function(data) {
                this.body = Buffer.concat([this.body || new Buffer(0), data]);
            }.bind(this));
        }.bind(this)).on('error', function(e) {
            res.writeHead(e.statusCode, e.message);
            res.end(e.message);
        }).end();
    }
});


module.exports = function(req, res) {
    new GSession(req).doProxy(res);
};